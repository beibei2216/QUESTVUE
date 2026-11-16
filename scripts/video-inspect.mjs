import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const chromePath =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const projectRoot = resolve('.');
const outputDir = resolve(projectRoot, 'qa', 'output');
if (!process.argv[2]) {
  throw new Error('Usage: node scripts/video-inspect.mjs <path-to-video>');
}
const videoPath = resolve(process.argv[2]);
const videoUrl = pathToFileURL(videoPath).href;
const profileDir = resolve(projectRoot, '.chrome-video-cdp-' + process.pid);
const port = 9860 + (process.pid % 120);
await mkdir(outputDir, { recursive: true });

const browser = spawn(
  chromePath,
  [
    '--headless',
    '--hide-scrollbars',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-gpu-sandbox',
    '--use-angle=swiftshader',
    '--allow-file-access-from-files',
    '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=' + port,
    '--remote-allow-origins=*',
    '--user-data-dir=' + profileDir,
    '--window-size=1280,800',
    'about:blank'
  ],
  { stdio: 'ignore', windowsHide: true }
);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function findPage() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/list');
      const pages = await response.json();
      const page = pages.find((item) => item.type === 'page');
      if (page) return page;
    } catch (error) {
      // Chrome is still starting.
    }
    await sleep(150);
  }
  throw new Error('Chrome DevTools page was not available.');
}

const page = await findPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener('open', resolveOpen, { once: true });
  socket.addEventListener('error', rejectOpen, { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const handlers = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) handlers.reject(new Error(JSON.stringify(message.error)));
  else handlers.resolve(message.result);
});

function send(method, params) {
  const id = ++nextId;
  return new Promise((resolveSend, rejectSend) => {
    pending.set(id, { resolve: resolveSend, reject: rejectSend });
    socket.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return result.result.value;
}

async function capture(filename) {
  const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(resolve(outputDir, filename), Buffer.from(result.data, 'base64'));
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: videoUrl });
  await sleep(1200);
  const metadata = await evaluate(`(function () {
    const video = document.querySelector("video");
    if (!video) return null;
    video.controls = false;
    video.pause();
    video.style.width = "100vw";
    video.style.height = "100vh";
    video.style.objectFit = "contain";
    document.body.style.margin = "0";
    document.body.style.background = "#111";
    return {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight
    };
  })()`);
  process.stdout.write(JSON.stringify(metadata) + '\n');

  const duration = metadata && Number.isFinite(metadata.duration) ? metadata.duration : 8;
  const times = [0.08, 0.22, 0.38, 0.54, 0.7, 0.86].map((ratio) => duration * ratio);
  for (let index = 0; index < times.length; index += 1) {
    await evaluate(`(function () {
      const video = document.querySelector("video");
      video.currentTime = ${times[index]};
      video.pause();
    })()`);
    await sleep(260);
    await capture('video-frame-' + index + '.png');
  }
} finally {
  try {
    await Promise.race([send('Browser.close'), sleep(1000)]);
  } catch (error) {
    // The browser can close the socket before acknowledging.
  }
  socket.close();
  browser.kill();
  await new Promise((resolveClose) => {
    browser.once('close', resolveClose);
    setTimeout(resolveClose, 700);
  });
  try {
    await rm(profileDir, { recursive: true, force: true });
  } catch (error) {
    // This profile is disposable QA data.
  }
}
