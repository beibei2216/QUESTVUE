import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const chromePath =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const projectRoot = resolve('.');
const outputDir = resolve(projectRoot, 'qa', 'output');
const pageUrl = process.argv[2] || pathToFileURL(resolve(projectRoot, 'html/index.html')).href;
const profileDir = await mkdtemp(join(tmpdir(), 'azure-map-qa-'));
const port = 9480 + (process.pid % 400);
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

async function waitFor(expression, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(120);
  }
  throw new Error('Timed out waiting for: ' + expression);
}

async function pressKey(key, code) {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: key,
    code: code || key
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: key,
    code: code || key
  });
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
    'document.readyState === "complete" && document.getElementById("adventure-start") !== null',
    12000
  );
  await waitFor(
    '(function () { var image = document.querySelector(".adventure-start__art"); return image && image.complete && image.naturalWidth > 0; })()',
    12000
  );
  await sleep(350);

  const openingState = await evaluate(`(function () {
    var image = document.querySelector(".adventure-start__art");
    var button = document.getElementById("start-button");
    var canvas = document.querySelector("canvas");
    return {
      stage: document.getElementById("app").dataset.stage,
      canvas: canvas ? [canvas.width, canvas.height] : null,
      imageSize: [image.naturalWidth, image.naturalHeight],
      startVisible: !button.disabled && !document.getElementById("adventure-start").classList.contains("is-hidden"),
      buttonLabel: button.getAttribute("aria-label"),
      removedUi: !document.querySelector(".map-topbar") &&
        !document.querySelector(".zoom-stack") &&
        !document.querySelector(".round-tool") &&
        !document.getElementById("quest-notice"),
      title: document.title
    };
  })()`);
  await capture('qa-opening.png');

  const buttonCenter = await evaluate(`(function () {
    var rect = document.getElementById("start-button").getBoundingClientRect();
    return [rect.left + rect.width / 2, rect.top + rect.height / 2];
  })()`);
  await evaluate(`(function () {
    window.__qaFrameIntervals = [];
    var previous = 0;
    function sample(now) {
      if (previous > 0) window.__qaFrameIntervals.push(now - previous);
      previous = now;
      if (document.getElementById("app").dataset.stage === "loading") {
        window.requestAnimationFrame(sample);
      }
    }
    window.requestAnimationFrame(sample);
    return true;
  })()`);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: buttonCenter[0],
    y: buttonCenter[1],
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: buttonCenter[0],
    y: buttonCenter[1],
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor('document.getElementById("app").dataset.stage === "loading"', 2500);
  await waitFor(
    '(function () { var video = document.getElementById("loading-video"); return video.readyState >= 2 && video.duration > 0; })()',
    12000
  );
  await sleep(450);
  const loadingState = await evaluate(`(function () {
    var video = document.getElementById("loading-video");
    var status = document.getElementById("loading-status");
    return {
      stage: document.getElementById("app").dataset.stage,
      videoPlaying: !video.paused && !video.ended && video.currentTime > 0,
      videoDuration: video.duration,
      videoSize: [video.videoWidth, video.videoHeight],
      videoError: video.error ? video.error.code : null,
      loadingClass: document.getElementById("adventure-start").classList.contains("is-loading"),
      statusVisible: status.getAttribute("aria-hidden") === "false"
    };
  })()`);
  await capture('qa-loading.png');

  await waitFor('document.getElementById("app").dataset.stage === "explore"', 20000);
  await sleep(700);
  const cleanMapState = await evaluate(`(function () {
    var video = document.getElementById("loading-video");
    var quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    var intervals = window.__qaFrameIntervals || [];
    var sorted = intervals.slice().sort(function (a, b) { return a - b; });
    var p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;
    return {
      stage: document.getElementById("app").dataset.stage,
      uiHidden: document.getElementById("map-interface").getAttribute("aria-hidden"),
      introHidden: document.getElementById("adventure-start").getAttribute("aria-hidden"),
      videoCompleted: video.ended && Math.abs(video.duration - video.currentTime) < 0.12,
      videoTime: video.currentTime,
      videoDuration: video.duration,
      videoQuality: quality ? {
        totalFrames: quality.totalVideoFrames,
        droppedFrames: quality.droppedVideoFrames
      } : null,
      loadingFrames: intervals.length,
      loadingFrameP95: p95,
      loadingFrameMax: intervals.length ? Math.max.apply(Math, intervals) : null,
      scrollHeight: document.documentElement.scrollHeight,
      viewport: [window.innerWidth, window.innerHeight]
    };
  })()`);
  await capture('qa-map-clean.png');

  const exploreState = await evaluate(`(function () {
    var bottomNode = document.querySelector(".map-bottom");
    var bottom = bottomNode ? bottomNode.getBoundingClientRect() : null;
    var promptEnglish = bottomNode.querySelector("strong");
    var promptChinese = bottomNode.querySelector("span");
    return {
      stage: document.getElementById("app").dataset.stage,
      uiHidden: document.getElementById("map-interface").getAttribute("aria-hidden"),
      mapVisible: document.getElementById("map-interface").classList.contains("is-visible"),
      mapTitle: document.getElementById("map-questvue-title").textContent,
      mapTitleSize: getComputedStyle(document.getElementById("map-questvue-title")).fontSize,
      diaryVisible: (function () {
        var button = document.getElementById("trip-diary-toggle");
        var rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })(),
      zoomControls: document.querySelectorAll(".map-control").length,
      promptEnglish: {
        fontSize: getComputedStyle(promptEnglish).fontSize,
        lines: Math.round(promptEnglish.clientHeight / parseFloat(getComputedStyle(promptEnglish).lineHeight))
      },
      promptChinese: {
        fontSize: getComputedStyle(promptChinese).fontSize,
        fontFamily: getComputedStyle(promptChinese).fontFamily,
        fontLoaded: document.fonts.check('20pt "Shanhai Wanpi"'),
        lines: Math.round(promptChinese.clientHeight / parseFloat(getComputedStyle(promptChinese).lineHeight))
      },
      bottom: bottom ? [bottom.left, bottom.top, bottom.width, bottom.height] : null,
      viewport: [window.innerWidth, window.innerHeight]
    };
  })()`);
  await capture('qa-explore.png');

  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 723,
    y: 270,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 723,
    y: 270,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor(
    'document.getElementById("app").dataset.stage === "focus" && document.getElementById("focus-place-name").textContent === "红帆风舍"',
    3000
  );
  await sleep(500);
  const snapshotCoverState = await evaluate(`(function () {
    var poster = document.getElementById("focus-snapshot-poster");
    var frame = document.getElementById("focus-snapshot-frame");
    return {
      source: poster.currentSrc,
      hidden: poster.hidden,
      loaded: poster.complete && poster.naturalWidth > 0,
      size: [poster.naturalWidth, poster.naturalHeight],
      coverActive: frame.classList.contains("has-cover"),
      borderWidth: getComputedStyle(frame).borderTopWidth,
      videoHidden: document.getElementById("focus-snapshot-video").hidden
    };
  })()`);
  await capture('qa-redsail-snapshot-cover.png');
  const snapshotButtonCenter = await evaluate(`(function () {
    var rect = document.getElementById("focus-snapshot").getBoundingClientRect();
    return [rect.left + rect.width / 2, rect.top + rect.height / 2];
  })()`);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: snapshotButtonCenter[0],
    y: snapshotButtonCenter[1],
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: snapshotButtonCenter[0],
    y: snapshotButtonCenter[1],
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor(
    '(function () { var video = document.getElementById("focus-snapshot-video"); return !video.hidden && video.readyState >= 2 && !video.paused && video.currentTime > 0; })()',
    5000
  );
  await evaluate(`(function () {
    var video = document.getElementById("focus-snapshot-video");
    window.__qaSnapshotVideoFrames = [];
    window.__qaSnapshotVideoMediaTimes = [];
    window.__qaSnapshotRafFrames = [];
    var videoDeadline = performance.now() + 2000;
    var rafDeadline = videoDeadline;
    if (video.requestVideoFrameCallback) {
      function sampleVideo(now, metadata) {
        window.__qaSnapshotVideoFrames.push(now);
        window.__qaSnapshotVideoMediaTimes.push(metadata.mediaTime);
        if (performance.now() < videoDeadline) video.requestVideoFrameCallback(sampleVideo);
      }
      video.requestVideoFrameCallback(sampleVideo);
    }
    function sampleRaf(now) {
      window.__qaSnapshotRafFrames.push(now);
      if (performance.now() < rafDeadline) window.requestAnimationFrame(sampleRaf);
    }
    window.requestAnimationFrame(sampleRaf);
    return true;
  })()`);
  await sleep(2200);
  const snapshotVideoState = await evaluate(`(function () {
    var video = document.getElementById("focus-snapshot-video");
    var frame = document.getElementById("focus-snapshot-frame");
    var rect = frame.getBoundingClientRect();
    var quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    var videoFrames = window.__qaSnapshotVideoFrames || [];
    var mediaTimes = window.__qaSnapshotVideoMediaTimes || [];
    var rafFrames = window.__qaSnapshotRafFrames || [];
    function gaps(times) {
      var result = [];
      for (var index = 1; index < times.length; index += 1) {
        result.push(times[index] - times[index - 1]);
      }
      result.sort(function (a, b) { return a - b; });
      return result;
    }
    var videoGaps = gaps(videoFrames);
    var rafGaps = gaps(rafFrames);
    function percentile(values, ratio) {
      return values.length ? values[Math.min(values.length - 1, Math.floor(values.length * ratio))] : null;
    }
    return {
      place: document.getElementById("focus-place-name").textContent,
      source: video.currentSrc,
      hidden: video.hidden,
      paused: video.paused,
      muted: video.muted,
      volume: video.volume,
      duration: video.duration,
      currentTime: video.currentTime,
      videoSize: [video.videoWidth, video.videoHeight],
      audioDecodedBytes: video.webkitAudioDecodedByteCount,
      posterHidden: document.getElementById("focus-snapshot-poster").hidden,
      controls: video.controls,
      borderWidth: getComputedStyle(frame).borderTopWidth,
      frameRect: [rect.left, rect.top, rect.width, rect.height],
      buttonLabel: document.getElementById("focus-snapshot").getAttribute("aria-label"),
      playbackQuality: quality ? {
        totalVideoFrames: quality.totalVideoFrames,
        droppedVideoFrames: quality.droppedVideoFrames
      } : null,
      videoFrameCount: videoFrames.length,
      videoFramesPerSecond: videoFrames.length > 1
        ? (videoFrames.length - 1) * 1000 / (videoFrames[videoFrames.length - 1] - videoFrames[0])
        : null,
      videoGapP95: percentile(videoGaps, 0.95),
      videoGapMax: videoGaps.length ? videoGaps[videoGaps.length - 1] : null,
      mediaTimeAdvance: mediaTimes.length > 1 ? mediaTimes[mediaTimes.length - 1] - mediaTimes[0] : null,
      rafFramesPerSecond: rafFrames.length > 1
        ? (rafFrames.length - 1) * 1000 / (rafFrames[rafFrames.length - 1] - rafFrames[0])
        : null,
      rafGapP95: percentile(rafGaps, 0.95),
      rafGapMax: rafGaps.length ? rafGaps[rafGaps.length - 1] : null
    };
  })()`);
  await capture('qa-redsail-snapshot-video.png');

  await waitFor(
    `(function () {
      var video = document.getElementById("focus-snapshot-video");
      var poster = document.getElementById("focus-snapshot-poster");
      return video.ended &&
        !poster.hidden &&
        poster.currentSrc.endsWith("/media/redsail-hut-snapshot-ended.png") &&
        poster.complete &&
        poster.naturalWidth > 0;
    })()`,
    5000
  );
  const snapshotEndedPosterState = await evaluate(`(function () {
    var poster = document.getElementById("focus-snapshot-poster");
    var frame = document.getElementById("focus-snapshot-frame");
    return {
      source: poster.currentSrc,
      hidden: poster.hidden,
      loaded: poster.complete && poster.naturalWidth > 0,
      size: [poster.naturalWidth, poster.naturalHeight],
      coverActive: frame.classList.contains("has-cover"),
      videoHidden: document.getElementById("focus-snapshot-video").hidden,
      borderWidth: getComputedStyle(frame).borderTopWidth,
      buttonLabel: document.getElementById("focus-snapshot").getAttribute("aria-label")
    };
  })()`);
  await capture('qa-redsail-snapshot-ended.png');

  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: snapshotButtonCenter[0],
    y: snapshotButtonCenter[1],
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: snapshotButtonCenter[0],
    y: snapshotButtonCenter[1],
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor(
    '(function () { var video = document.getElementById("focus-snapshot-video"); return !video.hidden && !video.paused && video.currentTime > 0; })()',
    3000
  );
  const snapshotReplayState = await evaluate(`(function () {
    var video = document.getElementById("focus-snapshot-video");
    return {
      playing: !video.paused,
      currentTime: video.currentTime,
      muted: video.muted,
      volume: video.volume,
      posterHidden: document.getElementById("focus-snapshot-poster").hidden
    };
  })()`);
  await pressKey('Escape', 'Escape');
  await waitFor('document.getElementById("app").dataset.stage === "explore"', 2500);

  const diaryCenter = await evaluate(`(function () {
    var rect = document.getElementById("trip-diary-toggle").getBoundingClientRect();
    return [rect.left + rect.width / 2, rect.top + rect.height / 2];
  })()`);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: diaryCenter[0],
    y: diaryCenter[1],
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: diaryCenter[0],
    y: diaryCenter[1],
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor('document.getElementById("trip-diary-panel").classList.contains("is-open")', 1500);
  const diaryState = await evaluate(`(function () {
    var panel = document.getElementById("trip-diary-panel");
    return {
      open: panel.classList.contains("is-open"),
      ariaHidden: panel.getAttribute("aria-hidden"),
      summary: document.getElementById("trip-diary-summary").textContent,
      entries: document.querySelectorAll("#trip-diary-list li").length,
      closeFocusable: document.getElementById("trip-diary-close").tabIndex === 0
    };
  })()`);
  await capture('qa-trip-diary.png');
  await evaluate('document.getElementById("trip-diary-close").click()');
  await waitFor('!document.getElementById("trip-diary-panel").classList.contains("is-open")', 1500);

  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 477,
    y: 497,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 477,
    y: 497,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor(
    'document.getElementById("app").dataset.stage === "focus" && document.getElementById("focus-place-name").textContent === "海鸥码头"',
    3000
  );
  await sleep(500);
  const harborSnapshotCoverState = await evaluate(`(function () {
    var poster = document.getElementById("focus-snapshot-poster");
    var video = document.getElementById("focus-snapshot-video");
    var frame = document.getElementById("focus-snapshot-frame");
    var button = document.getElementById("focus-snapshot");
    var rect = button.getBoundingClientRect();
    return {
      source: poster.currentSrc,
      hidden: poster.hidden,
      loaded: poster.complete && poster.naturalWidth > 0,
      size: [poster.naturalWidth, poster.naturalHeight],
      coverActive: frame.classList.contains("has-cover"),
      videoHidden: video.hidden,
      borderWidth: getComputedStyle(frame).borderTopWidth,
      button: [rect.left + rect.width / 2, rect.top + rect.height / 2]
    };
  })()`);
  await capture('qa-gullhaven-snapshot-cover.png');
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: harborSnapshotCoverState.button[0],
    y: harborSnapshotCoverState.button[1],
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: harborSnapshotCoverState.button[0],
    y: harborSnapshotCoverState.button[1],
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor(
    '(function () { var video = document.getElementById("focus-snapshot-video"); return !video.hidden && video.readyState >= 2 && !video.paused && video.currentTime > 0; })()',
    5000
  );
  await sleep(700);
  const harborSnapshotVideoState = await evaluate(`(function () {
    var video = document.getElementById("focus-snapshot-video");
    var frame = document.getElementById("focus-snapshot-frame");
    return {
      source: video.currentSrc,
      playing: !video.paused,
      currentTime: video.currentTime,
      duration: video.duration,
      videoSize: [video.videoWidth, video.videoHeight],
      muted: video.muted,
      volume: video.volume,
      audioDecodedBytes: video.webkitAudioDecodedByteCount,
      borderWidth: getComputedStyle(frame).borderTopWidth,
      buttonLabel: document.getElementById("focus-snapshot").getAttribute("aria-label")
    };
  })()`);
  await capture('qa-gullhaven-snapshot-video.png');
  await waitFor(
    `(function () {
      var video = document.getElementById("focus-snapshot-video");
      var poster = document.getElementById("focus-snapshot-poster");
      return video.ended &&
        !poster.hidden &&
        poster.currentSrc.endsWith("/media/gullhaven-wharf-snapshot-ended.png") &&
        poster.complete &&
        poster.naturalWidth > 0;
    })()`,
    5000
  );
  const harborSnapshotEndedState = await evaluate(`(function () {
    var poster = document.getElementById("focus-snapshot-poster");
    var frame = document.getElementById("focus-snapshot-frame");
    return {
      source: poster.currentSrc,
      hidden: poster.hidden,
      loaded: poster.complete && poster.naturalWidth > 0,
      size: [poster.naturalWidth, poster.naturalHeight],
      coverActive: frame.classList.contains("has-cover"),
      videoHidden: document.getElementById("focus-snapshot-video").hidden,
      borderWidth: getComputedStyle(frame).borderTopWidth,
      buttonLabel: document.getElementById("focus-snapshot").getAttribute("aria-label")
    };
  })()`);
  await capture('qa-gullhaven-snapshot-ended.png');
  await pressKey('Escape', 'Escape');
  await waitFor('document.getElementById("app").dataset.stage === "explore"', 2500);
  await sleep(800);

  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 794,
    y: 612,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 794,
    y: 612,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor(
    'document.getElementById("app").dataset.stage === "focus" && document.getElementById("focus-place-name").textContent === "风信圩场"',
    3000
  );
  await sleep(500);
  const windbellSnapshotCoverState = await evaluate(`(function () {
    var poster = document.getElementById("focus-snapshot-poster");
    var video = document.getElementById("focus-snapshot-video");
    var frame = document.getElementById("focus-snapshot-frame");
    var button = document.getElementById("focus-snapshot");
    var rect = button.getBoundingClientRect();
    return {
      source: poster.currentSrc,
      hidden: poster.hidden,
      loaded: poster.complete && poster.naturalWidth > 0,
      size: [poster.naturalWidth, poster.naturalHeight],
      coverActive: frame.classList.contains("has-cover"),
      videoHidden: video.hidden,
      borderWidth: getComputedStyle(frame).borderTopWidth,
      button: [rect.left + rect.width / 2, rect.top + rect.height / 2]
    };
  })()`);
  await capture('qa-windbell-snapshot-cover.png');
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: windbellSnapshotCoverState.button[0],
    y: windbellSnapshotCoverState.button[1],
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: windbellSnapshotCoverState.button[0],
    y: windbellSnapshotCoverState.button[1],
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor(
    '(function () { var video = document.getElementById("focus-snapshot-video"); return !video.hidden && video.readyState >= 2 && !video.paused && video.currentTime > 0; })()',
    5000
  );
  await sleep(700);
  const windbellSnapshotVideoState = await evaluate(`(function () {
    var video = document.getElementById("focus-snapshot-video");
    var frame = document.getElementById("focus-snapshot-frame");
    return {
      source: video.currentSrc,
      playing: !video.paused,
      currentTime: video.currentTime,
      duration: video.duration,
      videoSize: [video.videoWidth, video.videoHeight],
      muted: video.muted,
      volume: video.volume,
      audioDecodedBytes: video.webkitAudioDecodedByteCount,
      borderWidth: getComputedStyle(frame).borderTopWidth,
      buttonLabel: document.getElementById("focus-snapshot").getAttribute("aria-label")
    };
  })()`);
  await capture('qa-windbell-snapshot-video.png');
  await waitFor(
    `(function () {
      var video = document.getElementById("focus-snapshot-video");
      var poster = document.getElementById("focus-snapshot-poster");
      return video.ended &&
        !poster.hidden &&
        poster.currentSrc.endsWith("/media/windbell-market-snapshot-ended.png") &&
        poster.complete &&
        poster.naturalWidth > 0;
    })()`,
    5000
  );
  const windbellSnapshotEndedState = await evaluate(`(function () {
    var poster = document.getElementById("focus-snapshot-poster");
    var frame = document.getElementById("focus-snapshot-frame");
    return {
      source: poster.currentSrc,
      hidden: poster.hidden,
      loaded: poster.complete && poster.naturalWidth > 0,
      size: [poster.naturalWidth, poster.naturalHeight],
      coverActive: frame.classList.contains("has-cover"),
      videoHidden: document.getElementById("focus-snapshot-video").hidden,
      borderWidth: getComputedStyle(frame).borderTopWidth,
      buttonLabel: document.getElementById("focus-snapshot").getAttribute("aria-label")
    };
  })()`);
  await capture('qa-windbell-snapshot-ended.png');
  await pressKey('Escape', 'Escape');
  await waitFor('document.getElementById("app").dataset.stage === "explore"', 2500);
  await sleep(800);

  const springsideMarkerCandidates = [
    [991, 250],
    [1004, 254],
    [980, 260],
    [1018, 260]
  ];
  for (const [x, y] of springsideMarkerCandidates) {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: x,
      y: y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: x,
      y: y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    });
    await sleep(180);
    if (
      await evaluate(
        'document.getElementById("app").dataset.stage === "focus" && document.getElementById("focus-place-name").textContent === "泉畔木屋"'
      )
    ) {
      break;
    }
  }
  await waitFor(
    'document.getElementById("app").dataset.stage === "focus" && document.getElementById("focus-place-name").textContent === "泉畔木屋"',
    3000
  );
  await sleep(500);
  const springsideSnapshotCoverState = await evaluate(`(function () {
    var poster = document.getElementById("focus-snapshot-poster");
    var video = document.getElementById("focus-snapshot-video");
    var frame = document.getElementById("focus-snapshot-frame");
    var button = document.getElementById("focus-snapshot");
    var rect = button.getBoundingClientRect();
    return {
      source: poster.currentSrc,
      hidden: poster.hidden,
      loaded: poster.complete && poster.naturalWidth > 0,
      size: [poster.naturalWidth, poster.naturalHeight],
      coverActive: frame.classList.contains("has-cover"),
      videoHidden: video.hidden,
      borderWidth: getComputedStyle(frame).borderTopWidth,
      button: [rect.left + rect.width / 2, rect.top + rect.height / 2]
    };
  })()`);
  await capture('qa-springside-snapshot-cover.png');
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: springsideSnapshotCoverState.button[0],
    y: springsideSnapshotCoverState.button[1],
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: springsideSnapshotCoverState.button[0],
    y: springsideSnapshotCoverState.button[1],
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor(
    '(function () { var video = document.getElementById("focus-snapshot-video"); return !video.hidden && video.readyState >= 2 && !video.paused && video.currentTime > 0; })()',
    5000
  );
  await sleep(700);
  const springsideSnapshotVideoState = await evaluate(`(function () {
    var video = document.getElementById("focus-snapshot-video");
    var frame = document.getElementById("focus-snapshot-frame");
    return {
      source: video.currentSrc,
      playing: !video.paused,
      currentTime: video.currentTime,
      duration: video.duration,
      videoSize: [video.videoWidth, video.videoHeight],
      muted: video.muted,
      volume: video.volume,
      audioDecodedBytes: video.webkitAudioDecodedByteCount,
      borderWidth: getComputedStyle(frame).borderTopWidth,
      buttonLabel: document.getElementById("focus-snapshot").getAttribute("aria-label")
    };
  })()`);
  await capture('qa-springside-snapshot-video.png');
  await waitFor(
    `(function () {
      var video = document.getElementById("focus-snapshot-video");
      var poster = document.getElementById("focus-snapshot-poster");
      return video.ended &&
        !poster.hidden &&
        poster.currentSrc.endsWith("/media/springside-cabin-snapshot-ended.png") &&
        poster.complete &&
        poster.naturalWidth > 0;
    })()`,
    5000
  );
  const springsideSnapshotEndedState = await evaluate(`(function () {
    var poster = document.getElementById("focus-snapshot-poster");
    var frame = document.getElementById("focus-snapshot-frame");
    return {
      source: poster.currentSrc,
      hidden: poster.hidden,
      loaded: poster.complete && poster.naturalWidth > 0,
      size: [poster.naturalWidth, poster.naturalHeight],
      coverActive: frame.classList.contains("has-cover"),
      videoHidden: document.getElementById("focus-snapshot-video").hidden,
      borderWidth: getComputedStyle(frame).borderTopWidth,
      buttonLabel: document.getElementById("focus-snapshot").getAttribute("aria-label")
    };
  })()`);
  await capture('qa-springside-snapshot-ended.png');
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: springsideSnapshotCoverState.button[0],
    y: springsideSnapshotCoverState.button[1],
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: springsideSnapshotCoverState.button[0],
    y: springsideSnapshotCoverState.button[1],
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor(
    '(function () { var video = document.getElementById("focus-snapshot-video"); return !video.hidden && !video.paused && video.currentTime > 0; })()',
    3000
  );
  const springsideSnapshotReplayState = await evaluate(`(function () {
    var video = document.getElementById("focus-snapshot-video");
    return {
      playing: !video.paused,
      currentTime: video.currentTime,
      muted: video.muted,
      volume: video.volume,
      posterHidden: document.getElementById("focus-snapshot-poster").hidden
    };
  })()`);
  await pressKey('Escape', 'Escape');
  await waitFor('document.getElementById("app").dataset.stage === "explore"', 2500);
  const springsideSnapshotResetState = await evaluate(`(function () {
    var poster = document.getElementById("focus-snapshot-poster");
    var video = document.getElementById("focus-snapshot-video");
    var frame = document.getElementById("focus-snapshot-frame");
    return {
      videoPaused: video.paused,
      videoHidden: video.hidden,
      videoSourceRemoved: !video.getAttribute("src"),
      posterHidden: poster.hidden,
      posterSourceRemoved: !poster.getAttribute("src"),
      videoClassRemoved: !frame.classList.contains("has-video"),
      coverClassRemoved: !frame.classList.contains("has-cover"),
      buttonLabel: document.getElementById("focus-snapshot").getAttribute("aria-label")
    };
  })()`);
  await sleep(800);

  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 720,
    y: 500,
    deltaX: 0,
    deltaY: -160
  });
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
    x: 790,
    y: 540,
    button: 'left',
    buttons: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 790,
    y: 540,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await sleep(350);
  const interactionState = await evaluate(`(function () {
    return {
      stage: document.getElementById("app").dataset.stage,
      mapVisible: document.getElementById("map-interface").classList.contains("is-visible"),
      canvasFocused: document.activeElement === document.querySelector("canvas")
    };
  })()`);
  await capture('qa-interaction.png');

  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 186,
    y: 295,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 186,
    y: 295,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor('document.getElementById("app").dataset.stage === "focus"', 3000);
  await sleep(700);
  await capture('qa-harbor-focus.png');
  const focusState = await evaluate(`(function () {
    return {
      stage: document.getElementById("app").dataset.stage,
      place: document.getElementById("focus-place-name").textContent,
      mapTitle: (function () {
        var title = document.getElementById("map-questvue-title");
        var rect = title.getBoundingClientRect();
        return {
          text: title.textContent,
          fontSize: getComputedStyle(title).fontSize,
          rect: [rect.left, rect.top, rect.width, rect.height],
          visible: rect.width > 0 && rect.height > 0 && getComputedStyle(title).opacity !== "0"
        };
      })(),
      photoLoaded: (function () {
        var image = document.getElementById("focus-place-photo");
        return !image.hidden && image.complete && image.naturalWidth > 0;
      })(),
      photo: (function () {
        var frame = document.getElementById("focus-place-photo-frame").getBoundingClientRect();
        var image = document.getElementById("focus-place-photo");
        return {
          frame: [frame.width, frame.height],
          frameRatio: frame.width / frame.height,
          sourceRatio: image.naturalWidth / image.naturalHeight
        };
      })(),
      photoOverlaysHidden: (function () {
        var frame = document.getElementById("focus-place-photo-frame");
        return getComputedStyle(frame.querySelector("span")).display === "none" &&
          getComputedStyle(frame.querySelector("strong")).display === "none";
      })(),
      story: (function () {
        var body = document.getElementById("focus-place-body");
        return {
          text: body.textContent,
          fontFamily: getComputedStyle(body).fontFamily,
          fontLoaded: document.fonts.check('16px "Shanhai Wanpi"'),
          bodySize: [body.clientWidth, body.clientHeight, body.scrollWidth, body.scrollHeight]
        };
      })(),
      shutterIcon: (function () {
        var button = document.getElementById("focus-snapshot");
        var icon = button.querySelector(".quest-shutter__icon");
        var body = button.querySelector(".quest-shutter__body");
        return {
          exists: Boolean(icon),
          color: body ? getComputedStyle(body).fill : null,
          size: icon ? [icon.clientWidth, icon.clientHeight] : null
        };
      })(),
      focused: document.getElementById("map-interface").classList.contains("is-focused")
    };
  })()`);
  const lighthouseSnapshotButton = await evaluate(`(function () {
    var poster = document.getElementById("focus-snapshot-poster");
    var video = document.getElementById("focus-snapshot-video");
    var button = document.getElementById("focus-snapshot");
    var frame = document.getElementById("focus-snapshot-frame");
    var rect = button.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      source: video.getAttribute("src"),
      videoHidden: video.hidden,
      coverSource: poster.currentSrc,
      coverHidden: poster.hidden,
      coverLoaded: poster.complete && poster.naturalWidth > 0,
      coverSize: [poster.naturalWidth, poster.naturalHeight],
      coverActive: frame.classList.contains("has-cover"),
      borderWidth: getComputedStyle(frame).borderTopWidth
    };
  })()`);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: lighthouseSnapshotButton.x,
    y: lighthouseSnapshotButton.y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: lighthouseSnapshotButton.x,
    y: lighthouseSnapshotButton.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor(
    '(function () { var video = document.getElementById("focus-snapshot-video"); return !video.hidden && video.readyState >= 2 && !video.paused && video.currentTime > 0; })()',
    5000
  );
  await sleep(700);
  const lighthouseSnapshotState = await evaluate(`(function () {
    var video = document.getElementById("focus-snapshot-video");
    var frame = document.getElementById("focus-snapshot-frame");
    return {
      source: video.currentSrc,
      playing: !video.paused,
      currentTime: video.currentTime,
      duration: video.duration,
      videoSize: [video.videoWidth, video.videoHeight],
      muted: video.muted,
      volume: video.volume,
      audioDecodedBytes: video.webkitAudioDecodedByteCount,
      borderWidth: getComputedStyle(frame).borderTopWidth,
      ariaLabel: document.getElementById("focus-snapshot").getAttribute("aria-label")
    };
  })()`);
  await capture('qa-lighthouse-snapshot-video.png');
  await waitFor(
    `(function () {
      var video = document.getElementById("focus-snapshot-video");
      var poster = document.getElementById("focus-snapshot-poster");
      return video.ended &&
        !poster.hidden &&
        poster.currentSrc.endsWith("/media/watchlight-beacon-snapshot-ended.png") &&
        poster.complete &&
        poster.naturalWidth > 0;
    })()`,
    5000
  );
  const lighthouseSnapshotEndedState = await evaluate(`(function () {
    var poster = document.getElementById("focus-snapshot-poster");
    var frame = document.getElementById("focus-snapshot-frame");
    return {
      source: poster.currentSrc,
      hidden: poster.hidden,
      loaded: poster.complete && poster.naturalWidth > 0,
      size: [poster.naturalWidth, poster.naturalHeight],
      coverActive: frame.classList.contains("has-cover"),
      videoHidden: document.getElementById("focus-snapshot-video").hidden,
      borderWidth: getComputedStyle(frame).borderTopWidth,
      buttonLabel: document.getElementById("focus-snapshot").getAttribute("aria-label")
    };
  })()`);
  await capture('qa-lighthouse-snapshot-ended.png');
  await pressKey('Escape', 'Escape');
  await waitFor('document.getElementById("app").dataset.stage === "explore"', 2500);

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await sleep(800);
  await capture('qa-mobile.png');
  const mobileMapState = await evaluate(`(function () {
    var controls = Array.from(document.querySelectorAll(".map-control")).map(function (button) {
      var rect = button.getBoundingClientRect();
      return [rect.left, rect.top, rect.width, rect.height];
    });
    var diary = document.getElementById("trip-diary-toggle").getBoundingClientRect();
    var bottom = document.querySelector(".map-bottom").getBoundingClientRect();
    var title = document.getElementById("map-questvue-title");
    var titleRect = title.getBoundingClientRect();
    return {
      stage: document.getElementById("app").dataset.stage,
      title: document.getElementById("map-questvue-title").textContent,
      titleSize: getComputedStyle(title).fontSize,
      titleRect: [titleRect.left, titleRect.top, titleRect.width, titleRect.height],
      diary: [diary.left, diary.top, diary.width, diary.height],
      controls: controls,
      bottom: [bottom.left, bottom.top, bottom.width, bottom.height],
      viewport: [window.innerWidth, window.innerHeight],
      overlapsViewport: [
        diary.left < 0 || diary.right > window.innerWidth ||
          bottom.left < 0 || bottom.right > window.innerWidth
      ]
    };
  })()`);
  await evaluate('document.getElementById("trip-diary-toggle").click()');
  await waitFor('document.getElementById("trip-diary-panel").classList.contains("is-open")', 1500);
  await capture('qa-mobile-trip-diary.png');
  await evaluate('document.getElementById("trip-diary-close").click()');
  await waitFor('!document.getElementById("trip-diary-panel").classList.contains("is-open")', 1500);

  await pressKey('Escape', 'Escape');
  await waitFor('document.getElementById("app").dataset.stage === "intro"', 2500);
  const returnState = await evaluate(`(function () {
    var button = document.getElementById("start-button");
    return {
      stage: document.getElementById("app").dataset.stage,
      startVisible: !button.disabled &&
        !document.getElementById("adventure-start").classList.contains("is-hidden"),
      mapHidden: document.getElementById("map-interface").getAttribute("aria-hidden"),
      introVisible: document.getElementById("adventure-start").getAttribute("aria-hidden")
    };
  })()`);

  process.stdout.write(
    JSON.stringify(
      {
        openingState: openingState,
        loadingState: loadingState,
        cleanMapState: cleanMapState,
        exploreState: exploreState,
        diaryState: diaryState,
        harborSnapshotCoverState: harborSnapshotCoverState,
        harborSnapshotVideoState: harborSnapshotVideoState,
        harborSnapshotEndedState: harborSnapshotEndedState,
        windbellSnapshotCoverState: windbellSnapshotCoverState,
        windbellSnapshotVideoState: windbellSnapshotVideoState,
        windbellSnapshotEndedState: windbellSnapshotEndedState,
        springsideSnapshotCoverState: springsideSnapshotCoverState,
        springsideSnapshotVideoState: springsideSnapshotVideoState,
        springsideSnapshotEndedState: springsideSnapshotEndedState,
        springsideSnapshotReplayState: springsideSnapshotReplayState,
        springsideSnapshotResetState: springsideSnapshotResetState,
        interactionState: interactionState,
        focusState: focusState,
        lighthouseSnapshotButton: lighthouseSnapshotButton,
        lighthouseSnapshotState: lighthouseSnapshotState,
        lighthouseSnapshotEndedState: lighthouseSnapshotEndedState,
        snapshotCoverState: snapshotCoverState,
        snapshotVideoState: snapshotVideoState,
        snapshotEndedPosterState: snapshotEndedPosterState,
        snapshotReplayState: snapshotReplayState,
        mobileMapState: mobileMapState,
        returnState: returnState,
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
