import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chromePath =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const projectRoot = resolve('.');
const outputDir = resolve(projectRoot, 'qa', 'output');
const pageUrl = process.argv[2] || 'http://127.0.0.1:4187/';
const profileDir = await mkdtemp(join(tmpdir(), 'azure-photo-wall-qa-'));
const port = 9880 + (process.pid % 100);
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
      message.params.args.map(function (argument) {
        return argument.value || argument.description;
      }).join(' ')
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
    throw new Error(
      result.exceptionDetails.text +
        (result.exceptionDetails.exception
          ? ' :: ' + result.exceptionDetails.exception.description
          : '')
    );
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
  await writeFile(resolve(outputDir, filename), Buffer.from(screenshot.data, 'base64'));
}

async function readPhotoWallState() {
  return evaluate(`(function () {
    var panel = document.getElementById("photo-wall-panel");
    var grid = document.getElementById("photo-wall-add");
    var panelRect = panel.getBoundingClientRect();
    var slots = Array.from(grid.querySelectorAll(".photo-wall-slot"));
    var images = slots.slice(0, 10).map(function (slot) {
      var image = slot.querySelector("img");
      var slotRect = slot.getBoundingClientRect();
      var imageRect = image ? image.getBoundingClientRect() : null;
      return {
        label: slot.getAttribute("aria-label"),
        alt: image ? image.alt : null,
        source: image ? new URL(image.currentSrc).pathname : null,
        loaded: Boolean(image && image.complete && image.naturalWidth > 0),
        naturalSize: image ? [image.naturalWidth, image.naturalHeight] : null,
        slotRect: [slotRect.left, slotRect.top, slotRect.width, slotRect.height],
        imageRect: imageRect ? [imageRect.left, imageRect.top, imageRect.width, imageRect.height] : null,
        imageFitsSlot: Boolean(imageRect &&
          imageRect.left >= slotRect.left - 1 &&
          imageRect.top >= slotRect.top - 1 &&
          imageRect.right <= slotRect.right + 1 &&
          imageRect.bottom <= slotRect.bottom + 1)
      };
    });
    return {
      viewport: [window.innerWidth, window.innerHeight],
      panel: [panelRect.left, panelRect.top, panelRect.width, panelRect.height],
      grid: (function () {
        var rect = grid.getBoundingClientRect();
        return [rect.left, rect.top, rect.width, rect.height];
      })(),
      images: images,
      emptySlots: slots.slice(10).filter(function (slot) {
        return !slot.querySelector("img");
      }).map(function (slot) {
        return slot.getAttribute("aria-label");
      }),
      allImagesFit: images.every(function (image) { return image.imageFitsSlot; }),
      panelFitsViewport: panelRect.left >= -1 &&
        panelRect.top >= -1 &&
        panelRect.right <= window.innerWidth + 1 &&
        panelRect.bottom <= window.innerHeight + 1
    };
  })()`);
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
  await evaluate('document.getElementById("photo-wall-toggle").click()');
  await waitFor('document.getElementById("photo-wall-layer").classList.contains("is-open")', 3000);
  await evaluate('document.getElementById("photo-wall-view-toggle").click()');
  await waitFor(
    '(function () { var grid = document.getElementById("photo-wall-add"); return !grid.hidden; })()',
    3000
  );
  await waitFor(
    'Array.from(document.querySelectorAll("#photo-wall-add img")).every(function (image) { return image.complete && image.naturalWidth > 0; })',
    10000
  );
  await sleep(500);
  const desktop = await readPhotoWallState();
  await capture('qa-photo-wall-add-desktop.png');

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await sleep(700);
  const mobile = await readPhotoWallState();
  await capture('qa-photo-wall-add-mobile.png');

  process.stdout.write(JSON.stringify({
    desktop: desktop,
    mobile: mobile,
    exceptions: exceptions,
    consoleErrors: consoleErrors
  }, null, 2) + '\n');
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
