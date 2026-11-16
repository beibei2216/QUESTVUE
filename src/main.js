import './styles.css';
import { createWorld } from './world.js';

const app = document.getElementById('app');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fontReady = document.fonts
  ? document.fonts.load('700 60px "Howdy Party"').catch(function () {
      return [];
    })
  : Promise.resolve([]);

app.innerHTML = [
  '<div class="game-shell">',
  '  <div class="scene-stage" id="scene-stage"></div>',
  '  <div class="grain" aria-hidden="true"></div>',
  '  <div class="vignette" aria-hidden="true"></div>',
  '  <section class="adventure-start" id="adventure-start" aria-label="丛林探险开始界面">',
  '    <img class="adventure-start__art" src="./media/jungle-start.png" alt="丛林中的女孩和伙伴，准备开始寻觅">',
  '    <video class="adventure-loading-video" id="loading-video" muted playsinline preload="auto" poster="./media/jungle-start.png" aria-hidden="true">',
  '      <source src="./media/jungle-loading.mp4" type="video/mp4">',
  '    </video>',
  '    <div class="adventure-loading-shade" aria-hidden="true"></div>',
  '    <button class="adventure-start__button" id="start-button" type="button" aria-label="开始寻觅">',
  '      <span class="sr-only">开始寻觅</span>',
  '    </button>',
  '    <div class="adventure-loading-status" id="loading-status" role="status" aria-live="polite" aria-hidden="true">',
  '      <span>正在进入群岛</span>',
  '      <i aria-hidden="true"><b id="loading-progress"></b></i>',
  '      <small>LOADING ADVENTURE</small>',
  '    </div>',
  '  </section>',
  '  <section class="map-interface" id="map-interface" aria-label="折纸群岛地图界面" aria-hidden="true">',
  '    <h1 class="map-questvue-title" id="map-questvue-title">QUESTVUE</h1>',
  '    <section class="questview" id="questview" aria-label="建筑设计特写" aria-hidden="true">',
  '      <aside class="quest-panel quest-panel--description">',
  '        <h3>DESCRIPTION</h3>',
  '        <div class="quest-media quest-media--photo" id="focus-place-photo-frame">',
  '          <img class="quest-media__photo" id="focus-place-photo" alt="" hidden>',
  '          <span>明信片照片</span>',
  '          <strong id="focus-place-name">守望灯塔</strong>',
  '        </div>',
  '        <p id="focus-place-body">建筑说明</p>',
  '        <div class="quest-lines" aria-hidden="true"><i></i><i></i><i></i></div>',
  '      </aside>',
  '      <aside class="quest-panel quest-panel--snapshot">',
  '        <h3>SNAPSHOT</h3>',
  '        <div class="quest-media quest-media--snapshot" id="focus-snapshot-frame">',
  '          <img class="quest-media__poster" id="focus-snapshot-poster" alt="" hidden>',
  '          <video class="quest-media__video" id="focus-snapshot-video" controls playsinline preload="auto" hidden></video>',
  '          <span id="focus-snapshot-label">拍立得视频</span>',
  '          <strong id="focus-snapshot-caption">现场记录</strong>',
  '        </div>',
  '        <button class="quest-shutter" id="focus-snapshot" type="button" aria-label="记录当前场景">',
  '          <svg class="quest-shutter__icon" viewBox="0 0 48 48" aria-hidden="true">',
  '            <rect class="quest-shutter__body" x="5" y="2" width="38" height="44" rx="12"></rect>',
  '            <rect class="quest-shutter__notch" x="0" y="20" width="9" height="8" rx="2"></rect>',
  '            <rect class="quest-shutter__notch" x="39" y="20" width="9" height="8" rx="2"></rect>',
  '            <circle class="quest-shutter__ring" cx="24" cy="24" r="10.5"></circle>',
  '            <circle class="quest-shutter__dot" cx="24" cy="24" r="5.5"></circle>',
  '          </svg>',
  '        </button>',
  '      </aside>',
  '      <div class="quest-controls" aria-label="特写控制，可拖拽场景并使用滚轮缩放">',
  '        <button class="quest-control" id="focus-zoom-in" type="button" aria-label="放大场景">+</button>',
  '        <button class="quest-control quest-control--map" id="focus-map-control" type="button">MAP</button>',
  '        <button class="quest-control" id="focus-zoom-out" type="button" aria-label="缩小场景">−</button>',
  '      </div>',
  '    </section>',
  '    <button class="trip-diary-toggle" id="trip-diary-toggle" type="button" aria-label="打开旅行日志" aria-expanded="false" aria-controls="trip-diary-panel">',
  '      <span>TRIP</span>',
  '      <span>DIARY</span>',
  '    </button>',
  '    <aside class="trip-diary-panel" id="trip-diary-panel" aria-label="旅行日志" aria-hidden="true">',
  '      <header class="trip-diary-panel__header">',
  '        <div>',
  '          <strong>TRIP DIARY</strong>',
  '          <small>旅行日志</small>',
  '        </div>',
  '        <button class="trip-diary-close" id="trip-diary-close" type="button" aria-label="关闭旅行日志">×</button>',
  '      </header>',
  '      <p class="trip-diary-summary" id="trip-diary-summary">已探索 0 / 10</p>',
  '      <ol class="trip-diary-list" id="trip-diary-list"></ol>',
  '    </aside>',
  '    <button class="photo-wall-toggle" id="photo-wall-toggle" type="button" aria-label="打开照片墙" aria-expanded="false" aria-controls="photo-wall-panel">',
  '      <svg class="photo-wall-toggle__icon" viewBox="0 0 32 32" aria-hidden="true">',
  '        <rect x="5" y="4" width="22" height="24" rx="4"></rect>',
  '        <circle cx="11" cy="10" r="2"></circle>',
  '        <path d="M8 23l6-7 4 4 3-3 3 6"></path>',
  '      </svg>',
  '      <span>PHOTO</span>',
  '      <span>WALL</span>',
  '    </button>',
  '    <div class="photo-wall-layer" id="photo-wall-layer" aria-hidden="true">',
  '      <aside class="photo-wall-panel" id="photo-wall-panel" role="dialog" aria-modal="true" aria-labelledby="photo-wall-title">',
  '        <header class="photo-wall-panel__header">',
  '          <button class="photo-wall-view-toggle" id="photo-wall-view-toggle" type="button" aria-label="切换到添加照片界面" aria-pressed="false" aria-controls="photo-wall-gallery photo-wall-add" title="切换到添加照片界面" tabindex="-1">',
  '            <span class="photo-wall-view-toggle__label" aria-hidden="true">CHECK-IN</span>',
  '          </button>',
  '          <h2 id="photo-wall-title">PHOTO WALL</h2>',
  '          <span class="sr-only" id="photo-wall-view-status" role="status" aria-live="polite">照片墙</span>',
  '          <button class="photo-wall-close" id="photo-wall-close" type="button" aria-label="关闭照片墙" tabindex="-1">×</button>',
  '        </header>',
  '        <div class="photo-wall-grid" id="photo-wall-gallery" role="list" aria-label="旅行照片墙">',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="星泉广场">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-star-spring-square.jpg" alt="星泉广场明信片" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="守望灯塔">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-watchlight-beacon.jpg" alt="守望灯塔明信片" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="泉畔木屋">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-springside-cabin.jpg" alt="泉畔木屋明信片" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="清涧栖屋">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-clearbrook-haven.jpg" alt="清涧栖屋明信片" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="蓝湾住宅">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-bluecove-residence.jpg" alt="蓝湾住宅明信片" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="红帆风舍">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-redsail-hut.jpg" alt="红帆风舍明信片" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="海鸥码头">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-gullhaven-wharf.jpg" alt="海鸥码头明信片" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="风信圩场">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-fengxin-wanchang.jpg" alt="风信圩场明信片" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="粉色海滨小店">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-pinkshore-boutique.jpg" alt="粉色海滨小店明信片" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="潮汐渔港">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-tidal-fishing-port.jpg" alt="潮汐渔港明信片" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '        </div>',
  '        <div class="photo-wall-grid photo-wall-grid--add" id="photo-wall-add" role="list" aria-label="新增照片墙" hidden>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="灯塔码头自拍合影">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-selfie-lighthouse-pier.jpg" alt="灯塔码头自拍合影" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="灯塔仰拍打卡合影">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-selfie-lighthouse-upward.jpg" alt="灯塔仰拍打卡合影" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="黄昏小岛自拍合影">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-selfie-sunset-island.jpg" alt="黄昏小岛自拍合影" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="捏耳朵打卡合影">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-selfie-ear-squeeze.jpg" alt="捏耳朵打卡合影" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="女孩小狗自拍合影">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-selfie-girl-dog.jpg" alt="女孩小狗自拍合影" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="趴肩背打卡合影">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-selfie-shoulder-back.jpg" alt="趴肩背打卡合影" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="贴脸倚靠打卡合影">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-selfie-cheek-lean.jpg" alt="贴脸倚靠打卡合影" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="小店趴卧打卡合影">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-selfie-shop-lie.jpg" alt="小店趴卧打卡合影" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="扬臂抬腿打卡合影">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-selfie-arm-leg-up.jpg" alt="扬臂抬腿打卡合影" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '          <div class="photo-wall-slot photo-wall-slot--filled" role="listitem" aria-label="坐姿张臂打卡合影">',
  '            <img class="photo-wall-slot__image" src="./media/photo-wall-selfie-seated-arms-wide.jpg" alt="坐姿张臂打卡合影" width="720" height="960" loading="lazy" decoding="async">',
  '          </div>',
  '        </div>',
  '      </aside>',
  '    </div>',
  '    <div class="map-control-stack" aria-label="地图缩放">',
  '      <button class="map-control" id="map-zoom-in" type="button" aria-label="放大地图"><span aria-hidden="true">+</span></button>',
  '      <button class="map-control" id="map-zoom-out" type="button" aria-label="缩小地图"><span aria-hidden="true">−</span></button>',
  '    </div>',
  '    <div class="map-bottom" aria-label="操作提示">',
  '      <strong>CLICK THE RED MARKER TO START EXPLORING.</strong>',
  '      <span>点击红色标记，开启探索。</span>',
  '    </div>',
  '  </section>',
  '  <div class="toast" id="toast" role="status" aria-live="polite"></div>',
  '  <p class="sr-only" id="scene-instructions">地图模式中，使用方向键移动视角，加减键缩放；按 Escape 返回桌面。</p>',
  '</div>'
].join('');

const sceneRoot = document.getElementById('scene-stage');
const startButton = document.getElementById('start-button');
const adventureStart = document.getElementById('adventure-start');
const loadingVideo = document.getElementById('loading-video');
const loadingStatus = document.getElementById('loading-status');
const loadingProgress = document.getElementById('loading-progress');
const mapInterface = document.getElementById('map-interface');
const questview = document.getElementById('questview');
const focusPlacePhotoFrame = document.getElementById('focus-place-photo-frame');
const focusPlacePhoto = document.getElementById('focus-place-photo');
const focusPlaceName = document.getElementById('focus-place-name');
const focusPlaceBody = document.getElementById('focus-place-body');
const focusMapControl = document.getElementById('focus-map-control');
const focusZoomIn = document.getElementById('focus-zoom-in');
const focusZoomOut = document.getElementById('focus-zoom-out');
const focusSnapshot = document.getElementById('focus-snapshot');
const focusSnapshotFrame = document.getElementById('focus-snapshot-frame');
const focusSnapshotPoster = document.getElementById('focus-snapshot-poster');
const focusSnapshotVideo = document.getElementById('focus-snapshot-video');
const focusSnapshotLabel = document.getElementById('focus-snapshot-label');
const focusSnapshotCaption = document.getElementById('focus-snapshot-caption');
const tripDiaryToggle = document.getElementById('trip-diary-toggle');
const tripDiaryPanel = document.getElementById('trip-diary-panel');
const tripDiaryClose = document.getElementById('trip-diary-close');
const tripDiarySummary = document.getElementById('trip-diary-summary');
const tripDiaryList = document.getElementById('trip-diary-list');
const photoWallToggle = document.getElementById('photo-wall-toggle');
const photoWallLayer = document.getElementById('photo-wall-layer');
const photoWallViewToggle = document.getElementById('photo-wall-view-toggle');
const photoWallViewStatus = document.getElementById('photo-wall-view-status');
const photoWallGallery = document.getElementById('photo-wall-gallery');
const photoWallAdd = document.getElementById('photo-wall-add');
const photoWallClose = document.getElementById('photo-wall-close');
const mapZoomIn = document.getElementById('map-zoom-in');
const mapZoomOut = document.getElementById('map-zoom-out');
const toast = document.getElementById('toast');

let world = null;
let canvas = null;
let worldStarted = false;

let stage = 'intro';
let uiReady = false;
let diveStartedAt = 0;
let diveDuration = reducedMotion ? 420 : 2550;
let revealTimer = 0;
let toastTimer = 0;
let lastTime = performance.now();
let targetFound = {};
let foundCount = 0;
let panX = 0;
let panZ = 0;
let zoom = 0;
let drag = null;
let focusedIndex = -1;
let focusZoom = 0;
let diaryOpen = false;
let photoWallOpen = false;
let photoWallView = 'gallery';

app.dataset.stage = stage;

function setMapUiVisible(visible) {
  mapInterface.classList.toggle('is-visible', visible);
  mapInterface.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (canvas) canvas.classList.toggle('is-map', visible);
  if (!visible) {
    mapInterface.classList.remove('is-focused');
  }
  uiReady = visible;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(function () {
    toast.classList.remove('is-visible');
  }, 2100);
}

function updateLoadingProgress() {
  if (stage !== 'loading') return;
  const duration = Number.isFinite(loadingVideo.duration) && loadingVideo.duration > 0
    ? loadingVideo.duration
    : 4;
  const progress = Math.max(0, Math.min(1, loadingVideo.currentTime / duration));
  loadingProgress.style.transform = 'scaleX(' + progress + ')';
}

function finishLoading() {
  if (stage !== 'loading') return;
  loadingVideo.pause();
  loadingProgress.style.transform = 'scaleX(1)';
  loadingStatus.querySelector('span').textContent = '正在搭建群岛';
  stage = 'preparing';
  app.dataset.stage = stage;

  // Let the final video frame and custom font paint before creating the WebGL
  // world and starting the large GLB downloads.
  fontReady.then(function () {
    if (stage !== 'preparing') return;
    window.requestAnimationFrame(function () {
      window.setTimeout(createAdventureWorld, 0);
    });
  });
}

function handleLoadingError() {
  if (stage !== 'loading') return;
  loadingVideo.pause();
  loadingVideo.currentTime = 0;
  loadingProgress.style.transform = 'scaleX(0)';
  loadingStatus.setAttribute('aria-hidden', 'true');
  adventureStart.classList.remove('is-loading');
  startButton.disabled = false;
  stage = 'intro';
  app.dataset.stage = stage;
  startButton.focus();
}

function createAdventureWorld() {
  if (stage !== 'preparing' || worldStarted) return;
  worldStarted = true;
  world = createWorld(sceneRoot);
  canvas = world.renderer.domElement;
  canvas.setAttribute('aria-describedby', 'scene-instructions');

  attachWorldInteractions();
  world.resize();
  window.requestAnimationFrame(beginDive);
}

function startAdventure() {
  if (stage !== 'intro') return;

  stage = 'loading';
  app.dataset.stage = stage;
  startButton.disabled = true;
  adventureStart.classList.add('is-loading');
  loadingStatus.setAttribute('aria-hidden', 'false');
  loadingStatus.querySelector('span').textContent = '正在进入群岛';
  loadingProgress.style.transform = 'scaleX(0)';
  loadingVideo.currentTime = 0;

  const playAttempt = loadingVideo.play();
  if (playAttempt && typeof playAttempt.catch === 'function') {
    playAttempt.catch(handleLoadingError);
  }
}

function beginDive() {
  if (stage !== 'preparing' || !world || !canvas) return;

  stage = 'dive';
  app.dataset.stage = stage;
  diveStartedAt = performance.now();
  world.setPresentation(0);
  world.setMapMode(false);
  world.resetView();
  panX = 0;
  panZ = 0;
  zoom = 0;
  adventureStart.classList.add('is-hidden');
  adventureStart.setAttribute('aria-hidden', 'true');
  canvas.focus();
}

function revealMapInterface() {
  if (stage !== 'map') return;
  stage = 'explore';
  app.dataset.stage = stage;
  setMapUiVisible(true);
  world.setMapMode(true);
  world.resetView();
}

function finishDive() {
  stage = 'map';
  app.dataset.stage = stage;
  world.setPresentation(1);
  world.setMapMode(true);
  revealTimer = window.setTimeout(revealMapInterface, reducedMotion ? 80 : 620);
}

function returnToIntro() {
  window.clearTimeout(revealTimer);
  window.clearTimeout(toastTimer);
  stage = 'intro';
  app.dataset.stage = stage;
  uiReady = false;
  setMapUiVisible(false);
  questview.setAttribute('aria-hidden', 'true');
  toast.classList.remove('is-visible');
  if (world) {
    world.setPresentation(0);
    world.setMapMode(false);
    world.clearFocus();
    world.resetView();
  }
  closeTripDiary();
  closePhotoWall();
  focusedIndex = -1;
  focusZoom = 0;
  panX = 0;
  panZ = 0;
  zoom = 0;
  loadingVideo.pause();
  loadingVideo.currentTime = 0;
  loadingProgress.style.transform = 'scaleX(0)';
  loadingStatus.setAttribute('aria-hidden', 'true');
  startButton.disabled = false;
  resetFocusSnapshot();
  adventureStart.classList.remove('is-hidden', 'is-loading');
  adventureStart.setAttribute('aria-hidden', 'false');
  startButton.focus();
}

function announceFound(index) {
  const marker = world.markers[index];
  const isNew = !targetFound[index];
  targetFound[index] = true;

  if (isNew) {
    foundCount += 1;
  }

  if (foundCount === world.markers.length) {
    showToast('全部探索印章已集齐 · 航海日志完成');
  } else if (isNew) {
    showToast('获得「' + marker.title + '」探索印章');
  }

  renderTripDiary();
}

function focusPlace(index) {
  const marker = world.markers[index];
  if (!marker) return;

  closeTripDiary();
  closePhotoWall();
  tripDiaryToggle.tabIndex = -1;
  mapZoomIn.tabIndex = -1;
  mapZoomOut.tabIndex = -1;
  focusedIndex = index;
  focusZoom = 0;
  stage = 'focus';
  app.dataset.stage = stage;
  world.focusMarker(index);
  mapInterface.classList.add('is-focused');
  canvas.setAttribute(
    'aria-label',
    marker.title + '建筑特写，可拖拽旋转视角，使用鼠标滚轮缩放'
  );
  focusPlaceName.textContent = marker.title;
  focusPlaceBody.textContent = marker.body;
  focusPlaceBody.classList.toggle('is-story-text', Boolean(marker.storyFont));
  focusPlacePhotoFrame.classList.toggle('has-photo', Boolean(marker.postcard));
  focusPlacePhoto.hidden = !marker.postcard;
  if (marker.postcard) {
    focusPlacePhoto.src = marker.postcard;
    focusPlacePhoto.alt = marker.title + ' 明信片';
  } else {
    focusPlacePhoto.removeAttribute('src');
    focusPlacePhoto.alt = '';
  }
  configureFocusSnapshot(marker);
  questview.setAttribute('aria-hidden', 'false');
  window.setTimeout(function () {
    focusMapControl.focus();
  }, reducedMotion ? 30 : 280);
}

function returnToMap() {
  if (stage !== 'focus') return;
  stage = 'explore';
  app.dataset.stage = stage;
  focusedIndex = -1;
  focusZoom = 0;
  resetFocusSnapshot();
  world.clearFocus();
  mapInterface.classList.remove('is-focused');
  canvas.setAttribute('aria-label', '可拖拽漫游的折纸群岛三维地图');
  questview.setAttribute('aria-hidden', 'true');
  tripDiaryToggle.tabIndex = 0;
  mapZoomIn.tabIndex = 0;
  mapZoomOut.tabIndex = 0;
  canvas.focus();
}

function selectMarkerAt(clientX, clientY) {
  const index = world.pickMarker(clientX, clientY);
  if (index >= 0) {
    announceFound(index);
    focusPlace(index);
  }
}

function setPan(nextX, nextZ) {
  panX = Math.max(-2.1, Math.min(2.1, nextX));
  panZ = Math.max(-1.15, Math.min(1.15, nextZ));
  world.setView(panX, panZ, zoom);
}

function setZoom(nextZoom) {
  zoom = Math.max(-2.4, Math.min(3.1, nextZoom));
  world.setView(panX, panZ, zoom);
}

function renderTripDiary() {
  if (!world || !tripDiaryList) return;

  tripDiarySummary.textContent = '已探索 ' + foundCount + ' / ' + world.markers.length;
  tripDiaryList.innerHTML = world.markers.map(function (marker, index) {
    const found = Boolean(targetFound[index]);
    return [
      '<li class="' + (found ? 'is-found' : '') + '">',
      '  <span>' + String(index + 1).padStart(2, '0') + '</span>',
      '  <strong>' + marker.title + '</strong>',
      '  <small>' + (found ? '已到访' : '待探索') + '</small>',
      '</li>'
    ].join('');
  }).join('');
}

function setTripDiary(open) {
  diaryOpen = Boolean(open);
  if (diaryOpen) renderTripDiary();
  tripDiaryToggle.classList.toggle('is-active', diaryOpen);
  tripDiaryToggle.setAttribute('aria-expanded', diaryOpen ? 'true' : 'false');
  tripDiaryToggle.setAttribute('aria-label', diaryOpen ? '关闭旅行日志' : '打开旅行日志');
  tripDiaryPanel.classList.toggle('is-open', diaryOpen);
  tripDiaryPanel.setAttribute('aria-hidden', diaryOpen ? 'false' : 'true');
  tripDiaryClose.tabIndex = diaryOpen ? 0 : -1;
}

function closeTripDiary() {
  if (diaryOpen) setTripDiary(false);
}

function setPhotoWallView(view) {
  const addView = view === 'add';
  photoWallView = addView ? 'add' : 'gallery';
  photoWallGallery.hidden = addView;
  photoWallAdd.hidden = !addView;

  const actionLabel = addView ? '返回照片墙' : '切换到添加照片界面';
  photoWallViewToggle.setAttribute('aria-pressed', addView ? 'true' : 'false');
  photoWallViewToggle.setAttribute('aria-label', actionLabel);
  photoWallViewToggle.setAttribute('title', actionLabel);
  photoWallViewStatus.textContent = addView ? '已切换到添加照片界面' : '已返回照片墙';
}

function setPhotoWall(open) {
  if (open && stage !== 'explore') return;

  if (open) {
    closeTripDiary();
  }

  photoWallOpen = Boolean(open);
  mapInterface.classList.toggle('is-photo-wall-open', photoWallOpen);
  photoWallToggle.classList.toggle('is-active', photoWallOpen);
  photoWallToggle.setAttribute('aria-expanded', photoWallOpen ? 'true' : 'false');
  photoWallToggle.setAttribute('aria-label', photoWallOpen ? '关闭照片墙' : '打开照片墙');
  photoWallLayer.classList.toggle('is-open', photoWallOpen);
  photoWallLayer.setAttribute('aria-hidden', photoWallOpen ? 'false' : 'true');
  photoWallViewToggle.tabIndex = photoWallOpen ? 0 : -1;
  photoWallClose.tabIndex = photoWallOpen ? 0 : -1;

  if (photoWallOpen) {
    setPhotoWallView('gallery');
    window.setTimeout(function () {
      photoWallClose.focus();
    }, reducedMotion ? 20 : 180);
  } else if (stage === 'explore') {
    photoWallToggle.focus();
  }
}

function closePhotoWall() {
  if (photoWallOpen) setPhotoWall(false);
}

function adjustFocusZoom(delta) {
  if (stage !== 'focus') return;
  focusZoom = world.setFocusZoom(focusZoom + delta);
}

function resetFocusSnapshot() {
  focusSnapshotVideo.pause();
  focusSnapshotVideo.hidden = true;
  focusSnapshotVideo.removeAttribute('src');
  focusSnapshotVideo.load();
  focusSnapshotFrame.classList.remove('has-video');
  focusSnapshotFrame.classList.remove('has-cover');
  focusSnapshotPoster.hidden = true;
  focusSnapshotPoster.removeAttribute('src');
  focusSnapshotPoster.alt = '';
  focusSnapshotLabel.hidden = false;
  focusSnapshotCaption.hidden = false;
  focusSnapshotCaption.textContent = '现场记录';
  focusSnapshot.setAttribute('aria-label', '记录当前场景');
}

function configureFocusSnapshot(marker) {
  resetFocusSnapshot();
  if (!marker.snapshotVideo) return;

  focusSnapshotVideo.src = marker.snapshotVideo;
  focusSnapshotVideo.muted = false;
  focusSnapshotVideo.defaultMuted = false;
  focusSnapshotVideo.volume = 1;
  focusSnapshotVideo.setAttribute('aria-label', marker.title + ' 拍立得视频');
  focusSnapshotCaption.textContent = '点击播放现场视频';
  focusSnapshot.setAttribute('aria-label', '播放' + marker.title + '拍立得视频');

  if (marker.snapshotPoster) {
    focusSnapshotPoster.src = marker.snapshotPoster;
    focusSnapshotPoster.alt = marker.title + ' 拍立得视频待机封面';
    focusSnapshotPoster.hidden = false;
    focusSnapshotFrame.classList.add('has-cover');
  }
}

function playFocusSnapshot() {
  const marker = world.markers[focusedIndex];
  if (!marker) return;

  if (!marker.snapshotVideo) {
    showToast('已记录「' + marker.title + '」现场快照');
    return;
  }

  focusSnapshotFrame.classList.add('has-video');
  focusSnapshotFrame.classList.remove('has-cover');
  focusSnapshotPoster.hidden = true;
  focusSnapshotVideo.hidden = false;
  focusSnapshotVideo.muted = false;
  focusSnapshotVideo.defaultMuted = false;
  focusSnapshotVideo.volume = 1;
  if (focusSnapshotVideo.ended) {
    focusSnapshotVideo.currentTime = 0;
  }

  const playAttempt = focusSnapshotVideo.play();
  if (playAttempt && typeof playAttempt.catch === 'function') {
    playAttempt.catch(function () {
      showToast('视频播放失败，请再次点击');
    });
  }
}

function finishFocusSnapshotVideo() {
  const marker = world.markers[focusedIndex];
  if (!marker || !marker.snapshotEndedPoster) return;

  focusSnapshotVideo.hidden = true;
  focusSnapshotFrame.classList.remove('has-video');
  focusSnapshotFrame.classList.add('has-cover');
  focusSnapshotPoster.src = marker.snapshotEndedPoster;
  focusSnapshotPoster.alt = marker.title + ' 拍立得视频播放完成合影';
  focusSnapshotPoster.hidden = false;
  focusSnapshot.setAttribute('aria-label', '重播' + marker.title + '拍立得视频');
}

startButton.addEventListener('click', startAdventure);
tripDiaryToggle.addEventListener('click', function () {
  setTripDiary(!diaryOpen);
});
tripDiaryClose.addEventListener('click', function () {
  closeTripDiary();
  if (canvas && stage === 'explore') canvas.focus();
});
photoWallToggle.addEventListener('click', function () {
  setPhotoWall(!photoWallOpen);
});
photoWallViewToggle.addEventListener('click', function () {
  setPhotoWallView(photoWallView === 'gallery' ? 'add' : 'gallery');
});
photoWallClose.addEventListener('click', function () {
  closePhotoWall();
});
photoWallLayer.addEventListener('click', function (event) {
  if (event.target === photoWallLayer) closePhotoWall();
});
mapZoomIn.addEventListener('click', function () {
  if (stage === 'explore') setZoom(zoom - 0.5);
});
mapZoomOut.addEventListener('click', function () {
  if (stage === 'explore') setZoom(zoom + 0.5);
});
focusMapControl.addEventListener('click', returnToMap);
focusZoomIn.addEventListener('click', function () {
  adjustFocusZoom(0.35);
});
focusZoomOut.addEventListener('click', function () {
  adjustFocusZoom(-0.35);
});
focusSnapshot.addEventListener('click', function () {
  playFocusSnapshot();
});
focusSnapshotVideo.addEventListener('ended', finishFocusSnapshotVideo);
loadingVideo.addEventListener('ended', finishLoading);
loadingVideo.addEventListener('error', handleLoadingError);
loadingVideo.addEventListener('timeupdate', updateLoadingProgress);

function attachWorldInteractions() {
  canvas.addEventListener('click', function () {
    if (stage === 'intro') {
      startAdventure();
    }
  });

  canvas.addEventListener('pointerdown', function (event) {
    if (
      (stage !== 'explore' && stage !== 'focus') ||
      !uiReady ||
      event.button !== 0
    ) {
      return;
    }
    drag = {
      mode: stage,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false
    };
    if (canvas.setPointerCapture) {
      canvas.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
  });

  canvas.addEventListener('pointermove', function (event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;

    if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 5) {
      drag.moved = true;
    }

    if (drag.moved) {
      if (drag.mode === 'focus') {
        world.orbitFocus(-dx * 0.0055, -dy * 0.0042);
      } else {
        setPan(panX - dx * 0.0042, panZ - dy * 0.0042);
      }
    }

    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    event.preventDefault();
  });

  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasMoved = drag.moved;
    if (canvas.releasePointerCapture && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    drag = null;
    if (!wasMoved && stage === 'explore' && uiReady) {
      selectMarkerAt(event.clientX, event.clientY);
    }
  }

  canvas.addEventListener('pointerup', finishDrag);
  canvas.addEventListener('pointercancel', function () {
    drag = null;
  });

  canvas.addEventListener(
    'wheel',
    function (event) {
      if (!uiReady) return;
      if (stage === 'explore') {
        setZoom(zoom + event.deltaY * 0.0018);
        event.preventDefault();
      } else if (stage === 'focus') {
        adjustFocusZoom(-event.deltaY * 0.0018);
        event.preventDefault();
      }
    },
    { passive: false }
  );

  canvas.addEventListener('keydown', function (event) {
    if (stage === 'intro' && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      startAdventure();
      return;
    }

    if (stage !== 'explore') return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setPan(panX - 0.2, panZ);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setPan(panX + 0.2, panZ);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPan(panX, panZ - 0.16);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPan(panX, panZ + 0.16);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setZoom(zoom - 0.5);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      setZoom(zoom + 0.5);
    }
  });
}

window.addEventListener('keydown', function (event) {
  if (photoWallOpen && event.key === 'Tab') {
    event.preventDefault();
    const nextFocus = document.activeElement === photoWallViewToggle
      ? photoWallClose
      : photoWallViewToggle;
    nextFocus.focus();
    return;
  }

  if (event.key === 'Escape') {
    if (photoWallOpen) {
      closePhotoWall();
    } else if (diaryOpen) {
      closeTripDiary();
    } else if (stage === 'focus') {
      returnToMap();
    } else if (stage === 'map' || stage === 'explore') {
      returnToIntro();
    }
  }
});

window.addEventListener('resize', function () {
  if (world) world.resize();
});

function animate(now) {
  const delta = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (stage === 'dive' && world) {
    const raw = Math.min(1, (now - diveStartedAt) / diveDuration);
    world.setPresentation(raw * raw * (3 - 2 * raw));
    if (raw >= 1) {
      finishDive();
    }
  }

  const snapshotVideoPlaying =
    stage === 'focus' &&
    !focusSnapshotVideo.hidden &&
    !focusSnapshotVideo.paused &&
    !focusSnapshotVideo.ended;

  if (world && stage !== 'intro' && stage !== 'loading' && !snapshotVideoPlaying) {
    world.update(delta, now);
  }
  window.requestAnimationFrame(animate);
}

window.requestAnimationFrame(animate);
startButton.focus();
