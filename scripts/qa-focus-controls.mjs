import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chromePath =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const projectRoot = resolve('.');
const outputDir = resolve(projectRoot, 'qa', 'output');
const pageUrl = process.argv[2] || 'http://127.0.0.1:4187/';
const focusX = Number(process.env.QA_FOCUS_X || 723);
const focusY = Number(process.env.QA_FOCUS_Y || 270);
const focusName = process.env.QA_FOCUS_NAME || '红帆风舍';
const screenshotPrefix = process.env.QA_FOCUS_PREFIX || 'qa-focus-controls';
const profileDir = await mkdtemp(join(tmpdir(), 'azure-focus-controls-qa-'));
const port = 9780 + (process.pid % 100);
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
    '--user-data-dir=' + profileDir,
    '--window-size=1440,1000',
    'about:blank'
  ],
  { stdio: 'ignore', windowsHide: true }
);

function sleep(milliseconds) {
  return new Promise(function (resolveSleep) {
    setTimeout(resolveSleep, milliseconds);
  });
}

async function findPage() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/list');
      const pages = await response.json();
      const page = pages.find(function (item) {
        return item.type === 'page';
      });
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
await new Promise(function (resolveOpen, rejectOpen) {
  socket.addEventListener('open', resolveOpen, { once: true });
  socket.addEventListener('error', rejectOpen, { once: true });
});

let nextId = 0;
const pending = new Map();
const exceptions = [];
const consoleErrors = [];

socket.addEventListener('message', function (event) {
  const message = JSON.parse(event.data);

  if (message.method === 'Runtime.exceptionThrown') {
    exceptions.push(message.params.exceptionDetails);
  }

  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(
      message.params.args
        .map(function (argument) {
          return argument.value || argument.description;
        })
        .join(' ')
    );
  }

  if (!message.id || !pending.has(message.id)) return;
  const handlers = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) handlers.reject(new Error(JSON.stringify(message.error)));
  else handlers.resolve(message.result);
});

function send(method, parameters) {
  const id = ++nextId;
  return new Promise(function (resolveSend, rejectSend) {
    pending.set(id, { resolve: resolveSend, reject: rejectSend });
    socket.send(JSON.stringify({ id: id, method: method, params: parameters || {} }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression: expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(expression, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(120);
  }
  throw new Error('Timed out waiting for: ' + expression);
}

async function capture(filename) {
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true
  });
  const buffer = Buffer.from(screenshot.data, 'base64');
  await writeFile(resolve(outputDir, filename), buffer);
  return createHash('sha256').update(buffer).digest('hex');
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send('Page.navigate', { url: pageUrl });
  await waitFor(
    'document.readyState === "complete" && document.getElementById("start-button") !== null',
    12000
  );
  await evaluate('document.getElementById("start-button").click()');
  await waitFor('document.getElementById("app").dataset.stage === "explore"', 25000);
  await sleep(1200);
  await capture(screenshotPrefix + '-map.png');

  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: focusX,
    y: focusY,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: focusX,
    y: focusY,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor(
    `document.getElementById("app").dataset.stage === "focus" && document.getElementById("focus-place-name").textContent === ${JSON.stringify(focusName)}`,
    4000
  );
  await sleep(900);

  const startHash = await capture(screenshotPrefix + '-start.png');

  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 720,
    y: 500,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 900,
    y: 445,
    button: 'left',
    buttons: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 900,
    y: 445,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await sleep(900);

  const orbitHash = await capture(screenshotPrefix + '-orbit.png');

  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 720,
    y: 500,
    deltaX: 0,
    deltaY: -360,
    button: 'none',
    buttons: 0
  });
  await sleep(900);

  const zoomHash = await capture(screenshotPrefix + '-zoom.png');
  const state = await evaluate(`(function () {
    var canvas = document.querySelector(".scene-stage canvas");
    var style = getComputedStyle(canvas);
    return {
      stage: document.getElementById("app").dataset.stage,
      place: document.getElementById("focus-place-name").textContent,
      canvasLabel: canvas.getAttribute("aria-label"),
      cursor: style.cursor,
      label: document.querySelector(".quest-controls").getAttribute("aria-label")
    };
  })()`);

  const result = {
    state: state,
    hashes: {
      start: startHash,
      orbit: orbitHash,
      zoom: zoomHash
    },
    orbitChangedCamera: startHash !== orbitHash,
    wheelChangedCamera: orbitHash !== zoomHash,
    exceptions: exceptions,
    consoleErrors: consoleErrors
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');

  if (!result.orbitChangedCamera || !result.wheelChangedCamera) {
    throw new Error('Focus camera did not respond to drag and wheel input.');
  }
} finally {
  try {
    await Promise.race([send('Browser.close'), sleep(1200)]);
  } catch (error) {
    // The browser can close the socket before acknowledging.
  }
  socket.close();
  browser.kill();
  await new Promise(function (resolveClose) {
    browser.once('close', resolveClose);
    setTimeout(resolveClose, 800);
  });
  try {
    await rm(profileDir, { recursive: true, force: true });
  } catch (error) {
    // This profile is disposable QA data.
  }
}
