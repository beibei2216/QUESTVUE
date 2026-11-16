import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chromePath =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9340 + (process.pid % 200);
const projectRoot = resolve('.');
const outputDir = resolve(projectRoot, 'qa', 'output');
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
    '--remote-debugging-port=' + port,
    '--remote-allow-origins=*',
    '--user-data-dir=' + (await mkdtemp(join(tmpdir(), 'azure-axis-review-'))),
    '--window-size=900,900',
    'about:blank'
  ],
  { stdio: 'ignore', windowsHide: true }
);

const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

let page;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    page = pages.find((item) => item.type === 'page');
    if (page) break;
  } catch (error) {
    // Chrome is still starting.
  }
  await sleep(150);
}
if (!page) throw new Error('Chrome DevTools page was not available.');

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

function send(method, parameters) {
  const id = ++nextId;
  return new Promise((resolveSend, rejectSend) => {
    pending.set(id, { resolve: resolveSend, reject: rejectSend });
    socket.send(JSON.stringify({ id, method, params: parameters || {} }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  return result.result.value;
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });

  for (const view of ['hero', 'plusZ', 'minusZ', 'plusX', 'minusX']) {
    await send('Page.navigate', {
      url:
        'http://127.0.0.1:4188/tools/model-review/glb-axis-review.html?view=' +
        view
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await sleep(200);
      ready = Boolean(await evaluate('window.__ready === true'));
      if (ready) break;
    }
    if (!ready) throw new Error('Model did not load for ' + view);
    await sleep(300);
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true
    });
    await writeFile(
      resolve(outputDir, 'windmill-' + view + '.png'),
      Buffer.from(screenshot.data, 'base64')
    );
  }

  process.stdout.write('captured\n');
} finally {
  try {
    await Promise.race([send('Browser.close'), sleep(1200)]);
  } catch (error) {
    // Chrome may close before acknowledging.
  }
  socket.close();
  browser.kill();
}
