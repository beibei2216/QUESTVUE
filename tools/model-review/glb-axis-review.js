import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const views = {
  hero: { position: [4.6, 3.8, 5.8], label: 'HERO 3/4' },
  plusZ: { position: [0, 2.8, 7.4], label: 'CAMERA AT +Z' },
  minusZ: { position: [0, 2.8, -7.4], label: 'CAMERA AT -Z' },
  plusX: { position: [7.4, 2.8, 0], label: 'CAMERA AT +X' },
  minusX: { position: [-7.4, 2.8, 0], label: 'CAMERA AT -X' }
};

const requested = new URLSearchParams(window.location.search).get('view') || 'hero';
const view = views[requested] || views.hero;
const label = document.getElementById('label');
label.textContent = view.label;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd8e2cf);
scene.add(new THREE.HemisphereLight(0xfff5df, 0x617157, 1.35));
const sun = new THREE.DirectionalLight(0xffffff, 2.15);
sun.position.set(-4, 7, 5);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.05, 40);
camera.position.fromArray(view.position);
camera.lookAt(0, 0.75, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
document.body.insertBefore(renderer.domElement, document.body.firstChild);
scene.add(new THREE.GridHelper(8, 16, 0x617157, 0xa8b59d));
scene.add(new THREE.AxesHelper(2.2));

new GLTFLoader().load(
  '/models/windmill-cottage.glb',
  function (gltf) {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 3.2 / Math.max(size.x, size.z);
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(model);
    model.position.x -= center.x * scale;
    model.position.z -= center.z * scale;
    model.position.y -= scaled.min.y;
    scene.add(model);
    label.textContent +=
      '\n' + size.x.toFixed(3) + ' x ' + size.y.toFixed(3) + ' x ' + size.z.toFixed(3);
    renderer.render(scene, camera);
    window.__ready = true;
  },
  undefined,
  function (error) {
    label.textContent = 'LOAD ERROR';
    console.error(error);
  }
);

renderer.render(scene, camera);
