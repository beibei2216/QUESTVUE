import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chromePath =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const projectRoot = resolve('.');
const outputDir = resolve(projectRoot, 'qa', 'output');
const baseUrl =
  process.argv[2] || 'http://127.0.0.1:5173/tools/model-review/model-preview.html';
const captureQuery = process.argv[3] || 'flat=1';
const filenamePrefix = captureQuery.indexOf('flat=0') >= 0 ? 'model-' : 'model-flat-';
const profileDir = await mkdtemp(join(tmpdir(), 'azure-model-qa-'));
const port = 9880 + (process.pid % 100);
const views = ['hero', 'front', 'right', 'back', 'left', 'top'];
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
  {
    stdio: 'ignore',
    windowsHide: true
  }
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
    const details = message.params.exceptionDetails;
    exceptions.push({
      text: details.text,
      description: details.exception ? details.exception.description : '',
      url: details.url,
      line: details.lineNumber
    });
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
    throw new Error(
      result.exceptionDetails.text +
        (result.exceptionDetails.exception
          ? ' :: ' + result.exceptionDetails.exception.description
          : '')
    );
  }
  return result.result.value;
}

async function capture(filename) {
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true
  });
  await writeFile(resolve(outputDir, filename), Buffer.from(screenshot.data, 'base64'));
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

  const captures = [];
  for (const view of views) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: view === 'top' ? 1004 : 1440,
      height: view === 'top' ? 700 : 1000,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send('Page.navigate', {
      url: baseUrl + '?view=' + view + '&' + captureQuery
    });
    await sleep(900);
    const state = await evaluate(`(function () {
      var island = window.__modelPreview ? window.__modelPreview.island : null;
      var grass = island ? island.getObjectByName("LighthouseIsland_GrassTerrace") : null;
      var base = island ? island.getObjectByName("LighthouseIsland_SandBase") : null;
      if (grass) grass.geometry.computeBoundingBox();
      if (base) base.geometry.computeBoundingBox();
      return {
        ready: window.__ready === true,
        view: window.__modelPreview ? window.__modelPreview.view : null,
        title: document.title,
        manifest: window.__modelPreview ? window.__modelPreview.manifest : null,
        grass: grass ? {
          visible: grass.visible,
          color: grass.material.color.getHexString(),
          position: grass.position.toArray(),
          localBox: grass.geometry.boundingBox ? [
            grass.geometry.boundingBox.min.toArray(),
            grass.geometry.boundingBox.max.toArray()
          ] : null
        } : null,
        base: base ? {
          color: base.material.color.getHexString(),
          position: base.position.toArray(),
          localBox: base.geometry.boundingBox ? [
            base.geometry.boundingBox.min.toArray(),
            base.geometry.boundingBox.max.toArray()
          ] : null
        } : null
      };
    })()`);
    if (!state.ready || state.view !== view) {
      throw new Error(
        'Model view did not become ready: ' +
          JSON.stringify({ state: state, exceptions: exceptions, consoleErrors: consoleErrors })
      );
    }
    const filename = filenamePrefix + view + '.png';
    await capture(filename);
    if (view === 'hero' && state.manifest) {
      await writeFile(
        resolve(projectRoot, '.img2threejs-lighthouse', 'parts.json'),
        JSON.stringify(state.manifest, null, 2) + '\n'
      );
    }
    delete state.manifest;
    captures.push({ view: view, file: filename, state: state });
  }

  process.stdout.write(
    JSON.stringify(
      {
        captures: captures,
        exceptions: exceptions,
        consoleErrors: consoleErrors
      },
      null,
      2
    ) + '\n'
  );
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
