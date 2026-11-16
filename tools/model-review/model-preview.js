import * as THREE from 'three';
import { createLighthouseIslandModel } from '../../src/lighthouse-island-model.js';

const VIEWS = {
  hero: {
    position: [4.0, 3.7, 7.15],
    target: [0.04, 1.2, 0.08],
    label: 'HERO 3/4'
  },
  front: {
    position: [0.15, 3.15, 7.65],
    target: [0.04, 1.18, 0.08],
    label: 'FRONT'
  },
  right: {
    position: [7.55, 3.15, 0.15],
    target: [0.04, 1.18, 0.08],
    label: 'RIGHT'
  },
  back: {
    position: [-0.12, 3.15, -7.55],
    target: [0.04, 1.18, 0.08],
    label: 'BACK'
  },
  left: {
    position: [-7.55, 3.15, 0.15],
    target: [0.04, 1.18, 0.08],
    label: 'LEFT'
  },
  top: {
    position: [0.01, 9.4, 0.02],
    target: [0, 0.34, 0],
    label: 'TOP'
  }
};

const params = new URLSearchParams(window.location.search);
const requestedView = params.get('view') || 'hero';
const flatReview = params.get('flat') === '1';
const materialQc = params.get('materialQc') === '1';
const backgroundOverride = Number.parseInt(params.get('bg') || '', 16);
const view = VIEWS[requestedView] || VIEWS.hero;
document.getElementById('view-label').textContent = view.label;
if (materialQc) {
  document.getElementById('view-label').style.display = 'none';
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(
  Number.isFinite(backgroundOverride)
    ? backgroundOverride
    : flatReview
      ? 0xd8d5c8
      : requestedView === 'top'
        ? materialQc
          ? 0xf3f3f3
          : 0x334f4f
        : 0xb7c5ad
);
if (!flatReview) {
  scene.fog = new THREE.Fog(0xb7c5ad, 10, 18);
}

const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.05, 40);
camera.position.fromArray(view.position);
camera.lookAt(new THREE.Vector3().fromArray(view.target));

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.LinearToneMapping;
renderer.toneMappingExposure = 0.78;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.insertBefore(renderer.domElement, document.body.firstChild);

scene.add(new THREE.HemisphereLight(0xf0f4df, 0x52604d, 0.46));

const sun = new THREE.DirectionalLight(0xfff0ce, 0.98);
sun.position.set(-4.8, 8.5, 5.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -5;
sun.shadow.camera.right = 5;
sun.shadow.camera.top = 5;
sun.shadow.camera.bottom = -5;
sun.shadow.camera.near = 0.1;
sun.shadow.camera.far = 20;
sun.shadow.bias = -0.0003;
scene.add(sun);

const fill = new THREE.DirectionalLight(0x93d5dc, 0.18);
fill.position.set(6, 3.5, -4);
scene.add(fill);

const water = new THREE.Mesh(
  new THREE.CircleGeometry(9, 96),
  new THREE.MeshStandardMaterial({
    color: 0x1b8293,
    roughness: 0.88,
    metalness: 0
  })
);
water.rotation.x = -Math.PI / 2;
water.position.y = 0.005;
water.receiveShadow = true;
water.visible = !flatReview && requestedView !== 'top';
scene.add(water);

const island = createLighthouseIslandModel();
island.root.position.y = 0.035;
island.root.rotation.y = Number.parseFloat(params.get('rot') || '0') || 0;
scene.add(island.root);

if (materialQc) {
  renderer.outputEncoding = THREE.sRGBEncoding;
  const qualityPalette = {
    green: 0x69b548,
    coral: 0xd95643,
    cream: 0xe8dbc2,
    turquoise: 0x69b9c4,
    dark: 0x287297
  };
  island.root.traverse(function (object) {
    if (!object.isMesh) return;
    const source = object.material;
    const hex = source.color ? source.color.getHex() : 0xe8dbc2;
    const red = (hex >> 16) & 255;
    const green = (hex >> 8) & 255;
    const blue = hex & 255;
    const maxChannel = Math.max(red, green, blue) / 255;
    const darkDetail = /(Dock|Door|TreeTrunk|Gallery|Finial|WeatherVane|Ladder|FlagPole|Post|Rail|Mullion|Stringer)/i.test(
      object.name
    );
    let color = qualityPalette.cream;
    if (darkDetail || maxChannel < 0.4) color = qualityPalette.dark;
    else if (green > red * 1.2 && green > blue * 1.25) color = qualityPalette.green;
    else if (red > green * 1.22 && red > blue * 1.32) color = qualityPalette.coral;
    else if (blue > red * 1.18 && green > red * 1.12) color = qualityPalette.turquoise;
    const displayColor = new THREE.Color(color).convertSRGBToLinear();
    object.material = new THREE.MeshBasicMaterial({
      color: displayColor,
      transparent: Boolean(source.transparent),
      opacity: source.opacity,
      side: source.side,
      depthWrite: source.depthWrite
    });
  });
}

window.__interactive = false;
window.__modelPreview = {
  island: island.root,
  view: requestedView,
  manifest: island.root.userData.runtimeManifest
};

function render() {
  renderer.render(scene, camera);
  window.__ready = true;
}

render();

window.addEventListener('resize', function () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  render();
});
