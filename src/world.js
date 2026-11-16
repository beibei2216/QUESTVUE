import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createHarborLandmark } from './landmark-models.js';
import { createLighthouseIslandModel } from './lighthouse-island-model.js';

const TAU = Math.PI * 2;
const MARKER_RED = '#d73530';
const MARKER_RED_DARK = '#7c1717';
const MARKER_ICON = '#fff0cf';
const HARBOR_MODEL_URL = './models/island-house-boat-candidate.glb';
const HARBOR_SOURCE_FOOTPRINT = 0.97900390625;
const MAP_GROUP_HEIGHT = 0.16;
const BOARD_SEA_LEVEL = 0.332;
const MAP_DETAIL_SEA_LEVEL = BOARD_SEA_LEVEL - MAP_GROUP_HEIGHT;
const ISLAND_MARKET_MODEL_URL = './models/island-market-no-base.glb';
const COCONUT_PALM_MODEL_URL = './models/coconut-palm.glb';
const ICE_CREAM_TRUCK_MODEL_URL = './models/ice-cream-truck.glb';
const STONE_FOUNTAIN_MODEL_URL = './models/stone-fountain.glb';
const COASTAL_CABIN_MODEL_URL = './models/coastal-cabin.glb';
const WOOD_CABIN_MODEL_URL = './models/wood-cabin.glb';
const BLUE_HOUSE_MODEL_URL = './models/blue-house.glb';
const FISHING_BOAT_MODEL_URL = './models/fishing-boat.glb';
const PINK_SHOP_MODEL_URL = './models/pink-shop.glb';
const ISLAND_CABIN_444444_MODEL_URL = './models/island-cabin-444444.glb';
const WINDMILL_COTTAGE_MODEL_URL = './models/windmill-cottage.glb';
const ISLAND_MARKET_FOOTPRINT = 2.75;
const ISLAND_MARKET_POSITION = [0.82, 0.247, 1.75];
const ISLAND_MARKET_ROTATION = -Math.PI / 2;
const ICE_CREAM_TRUCK_FOOTPRINT = 1.5;
const ICE_CREAM_TRUCK_POSITION = [3.08, 0.231, 2.0];
// The source model's cab faces +X. This aims the nose toward the southeast shore.
const ICE_CREAM_TRUCK_ROTATION = -1.334;
const STONE_FOUNTAIN_FOOTPRINT = 2.55;
const STONE_FOUNTAIN_POSITION = [2.8, 0.337, 0.15];
const COASTAL_CABIN_FOOTPRINT = 1.35;
const COASTAL_CABIN_POSITION = [3.03, 0.228, -2.45];
const COASTAL_CABIN_ROTATION = -0.28;
const LAKE_MARKER_1_POSITION = [3.12, 0.34, -1.38];
const WOOD_CABIN_FOOTPRINT = 1.6;
const WOOD_CABIN_POSITION = [4.05, 0.247, -1.5];
// The source model's front faces +Z. Face it toward the lake marked 1.
const WOOD_CABIN_ROTATION = Math.atan2(
  LAKE_MARKER_1_POSITION[0] - WOOD_CABIN_POSITION[0],
  LAKE_MARKER_1_POSITION[2] - WOOD_CABIN_POSITION[2]
);
const BLUE_HOUSE_FOOTPRINT = 1.08;
const BLUE_HOUSE_POSITION = [5.64, 0.247, 0.52];
// The source model's main entrance faces +X. Aim it at the fountain.
const BLUE_HOUSE_ROTATION = Math.atan2(
  -(STONE_FOUNTAIN_POSITION[2] - BLUE_HOUSE_POSITION[2]),
  STONE_FOUNTAIN_POSITION[0] - BLUE_HOUSE_POSITION[0]
);
const FISHING_BOAT_FOOTPRINT = 2.05;
const FISHING_BOAT_POSITION = [5.08, MAP_DETAIL_SEA_LEVEL + 0.006, 2.28];
const FISHING_BOAT_FOCUS_TARGET_Y =
  MAP_GROUP_HEIGHT + FISHING_BOAT_POSITION[1] + 0.048;
// The source fishing-house facade faces +X. Aim it toward the open southern water.
const FISHING_BOAT_ROTATION = -Math.PI / 2;
const PINK_SHOP_FOOTPRINT = 1.04;
const PINK_SHOP_POSITION = [5.42, 0.247, -0.75];
// The source shop entrance faces +X. Aim it at the fountain.
const PINK_SHOP_ROTATION = Math.atan2(
  -(STONE_FOUNTAIN_POSITION[2] - PINK_SHOP_POSITION[2]),
  STONE_FOUNTAIN_POSITION[0] - PINK_SHOP_POSITION[0]
);
const ISLAND_CABIN_99999_FOOTPRINT = 1.5;
// Embed the baked sandy base slightly into the island surface to remove the contact seam.
const ISLAND_CABIN_99999_POSITION = [0.08, 0.218, -2.16];
// Preserve the cabin's existing anchor rotation while replacing its model.
const ISLAND_CABIN_99999_ROTATION = 0;
const LIGHTHOUSE_LANDMARK_POSITION = [-5.95, 0.246, -2.12];
const WINDMILL_COTTAGE_FOOTPRINT = 0.9;
const WINDMILL_COTTAGE_POSITION = [-1.18, 0.247, -2.16];
// The source model's door and blades face +X. Turn them toward the lighthouse.
const WINDMILL_COTTAGE_ROTATION = Math.atan2(
  -(LIGHTHOUSE_LANDMARK_POSITION[2] - WINDMILL_COTTAGE_POSITION[2]),
  LIGHTHOUSE_LANDMARK_POSITION[0] - WINDMILL_COTTAGE_POSITION[0]
);
const CANVAS_FONT_FAMILY = '"Howdy Party", "Microsoft YaHei", sans-serif';
const COCONUT_PALM_PLACEMENTS = [
  {
    position: [-5.62, 0.511, -1.65],
    height: 0.58,
    rotation: -0.68
  },
  {
    position: [5.08, 0.26, -1.55],
    height: 0.6,
    rotation: 0.18
  },
  {
    position: [6.05, 0.26, -0.38],
    height: 0.56,
    rotation: 1.04
  },
  {
    position: [5.72, 0.26, 1.32],
    height: 0.62,
    rotation: -0.72
  },
  {
    position: [-0.75, 0.26, -1.15],
    height: 0.42,
    rotation: 0.48
  },
  {
    // The palm circled beside the fountain is moved to marker 1 by the windmill.
    position: [-0.52, 0.26, -1.55],
    height: 0.48,
    rotation: -0.58
  },
  {
    position: [-0.55, 0.26, 0.05],
    height: 0.6,
    rotation: 0.86
  },
  {
    // Image 1, right-hand clearing in front of the red-roof cabin.
    position: [0.92, 0.26, -2.35],
    height: 0.46,
    rotation: 0.72
  },
  {
    // Image 2, left-hand clearing beside the windmill.
    position: [-1.35, 0.26, -1.68],
    height: 0.44,
    rotation: -0.26
  },
  {
    // Image 2, rear clearing between the windmill and red-roof cabin.
    position: [-0.62, 0.26, -2.6],
    height: 0.42,
    rotation: -1.04
  },
  {
    // Image marker 1: land between the windmill and the pond.
    position: [1.48, 0.26, -1.58],
    height: 0.46,
    rotation: -0.38
  },
  {
    // Image marker 2: land between the left marker and the pond rocks.
    position: [2.22, 0.26, -1.18],
    height: 0.44,
    rotation: 0.24
  },
  {
    // Additional palm in the clearing above the two marked positions.
    position: [1.9, 0.26, -1.88],
    height: 0.46,
    rotation: 0.12
  }
];
const COLORS = {
  paper: 0xf2e5c5,
  paperEdge: 0xd9c397,
  ink: 0x503f2f,
  water: 0x216f96,
  waterDeep: 0x175b81,
  waterLight: 0x59afc2,
  foam: 0xcdf2eb,
  sand: 0xeed9a4,
  sandShade: 0xd7bf82,
  grass: 0x7fb94e,
  grassLight: 0x9aca5c,
  grassDark: 0x4d8f43,
  road: 0xe8c978,
  stone: 0xb7aa8c,
  stoneLight: 0xd9cfb4,
  wood: 0x714f3b,
  woodLight: 0xa47451,
  roof: 0x8e4b39,
  roofBlue: 0x3d6a74,
  cream: 0xf7efd9,
  accent: 0xe98043,
  red: 0xd35b45,
  white: 0xfff9e8,
  leaf: 0x4b9a48,
  leafLight: 0x74bd5b
};

function seededRandom(seed) {
  let state = seed >>> 0;
  return function () {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function paperTexture(baseColor, fleckColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const rand = seededRandom(94);

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 4200; i += 1) {
    const alpha = 0.025 + rand() * 0.08;
    ctx.fillStyle = 'rgba(' + fleckColor + ',' + alpha + ')';
    const size = 0.4 + rand() * 1.4;
    ctx.fillRect(rand() * 512, rand() * 512, size, size);
  }

  ctx.strokeStyle = 'rgba(118,91,58,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 60; i += 1) {
    const y = rand() * 512;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(150, y + rand() * 5, 350, y - rand() * 5, 512, y);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.45, 1.45);
  texture.anisotropy = 4;
  return texture;
}

function waterTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const rand = seededRandom(118);

  ctx.fillStyle = '#26799c';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 130; i += 1) {
    const x = rand() * 512;
    const y = rand() * 512;
    const width = 14 + rand() * 38;
    ctx.strokeStyle = rand() > 0.38 ? 'rgba(112,196,204,.24)' : 'rgba(14,81,119,.24)';
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + width * 0.24, y - 4, x + width * 0.65, y + 4, x + width, y);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.4, 1.5);
  texture.anisotropy = 4;
  return texture;
}

function roundedRectShape(width, height, radius) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function flatMesh(geometry, material, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x || 0, y || 0, z || 0);
  mesh.receiveShadow = true;
  return mesh;
}

function standard(color, options) {
  return new THREE.MeshStandardMaterial(
    Object.assign(
      {
        color: color,
        roughness: 0.92,
        metalness: 0,
        flatShading: true
      },
      options || {}
    )
  );
}

function organicShape(width, height, seed, roughness) {
  const rand = seededRandom(seed);
  const shape = new THREE.Shape();
  const points = [];
  const count = 38;

  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * TAU;
    const wobble =
      1 +
      Math.sin(angle * 3 + seed) * roughness * 0.45 +
      Math.sin(angle * 7 + seed * 0.2) * roughness * 0.25 +
      (rand() - 0.5) * roughness;
    points.push([Math.cos(angle) * width * 0.5 * wobble, Math.sin(angle) * height * 0.5 * wobble]);
  }

  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();
  return shape;
}

function addIsland(group, centerX, centerZ, width, height, seed, palette) {
  const shoreShape = organicShape(width + 0.34, height + 0.34, seed + 4, 0.065);
  const sandShape = organicShape(width, height, seed, 0.07);
  const grassShape = organicShape(width * 0.82, height * 0.76, seed + 2, 0.09);

  const shore = flatMesh(
    new THREE.ShapeGeometry(shoreShape, 1),
    standard(COLORS.waterLight, { transparent: true, opacity: 0.82 }),
    centerX,
    0.198,
    centerZ
  );
  const sand = flatMesh(
    new THREE.ShapeGeometry(sandShape, 1),
    standard(palette && palette.sand ? palette.sand : COLORS.sand),
    centerX,
    0.226,
    centerZ
  );
  const grass = flatMesh(
    new THREE.ShapeGeometry(grassShape, 1),
    standard(palette && palette.grass ? palette.grass : COLORS.grass),
    centerX,
    0.246,
    centerZ
  );
  shore.castShadow = false;
  sand.castShadow = false;
  grass.castShadow = false;
  group.add(shore, sand, grass);
  return { shore: shore, sand: sand, grass: grass };
}

function addRoad(points, width, color, y) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(function (point) {
      return new THREE.Vector3(point[0], y || 0.32, point[1]);
    }),
    false,
    'catmullrom',
    0.35
  );
  const samples = curve.getPoints(72);
  const positions = [];
  const indices = [];

  for (let i = 0; i < samples.length; i += 1) {
    const point = samples[i];
    const before = samples[Math.max(0, i - 1)];
    const after = samples[Math.min(samples.length - 1, i + 1)];
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const length = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = (-dz / length) * width * 0.5;
    const nz = (dx / length) * width * 0.5;

    positions.push(point.x + nx, point.y, point.z + nz);
    positions.push(point.x - nx, point.y, point.z - nz);

    if (i < samples.length - 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const road = new THREE.Mesh(geometry, standard(color, { side: THREE.DoubleSide }));
  road.receiveShadow = true;
  return road;
}

function addRock(group, x, z, scale, color) {
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.18 * scale, 0),
    standard(color || COLORS.stone, { roughness: 1 })
  );
  rock.scale.set(1.3, 0.7, 0.9);
  rock.position.set(x, 0.24 + 0.08 * scale, z);
  rock.rotation.y = x * 2.3 + z;
  rock.castShadow = true;
  rock.receiveShadow = true;
  group.add(rock);
  return rock;
}

function addDock(group, points) {
  const dockMaterial = standard(COLORS.wood);
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.sqrt(dx * dx + dz * dz);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(length + 0.1, 0.1, 0.34), dockMaterial);
    plank.position.set((a[0] + b[0]) / 2, 0.33, (a[1] + b[1]) / 2);
    plank.rotation.y = -Math.atan2(dz, dx);
    plank.castShadow = true;
    plank.receiveShadow = true;
    group.add(plank);
  }

  for (let i = 0; i < points.length; i += 1) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.32, 6), dockMaterial);
    post.position.set(points[i][0], 0.37, points[i][1]);
    post.castShadow = true;
    group.add(post);
  }
}

function addHarborGlb(group) {
  const anchor = new THREE.Group();
  anchor.name = 'HarborLandmark_GLB';
  anchor.position.set(-3.12, 0.247, 0.95);
  anchor.rotation.y = 0.08;
  anchor.userData.loaded = false;
  group.add(anchor);

  const loader = new GLTFLoader();
  loader.load(
    HARBOR_MODEL_URL,
    function (gltf) {
      const model = gltf.scene;
      model.name = 'HarborLandmark_GLB_Source';
      model.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(model);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const footprint = HARBOR_SOURCE_FOOTPRINT;
      const scale = footprint > 0 ? 2.58 / footprint : 1;
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      model.position.y -= scaledBounds.min.y;
      model.traverse(function (child) {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.name = child.name || 'HarborLandmark_GLB_Mesh';
      });
      anchor.add(model);
      anchor.userData.loaded = true;
      anchor.userData.sourceSize = sourceSize.toArray();
      anchor.userData.appliedScale = scale;
    },
    undefined,
    function (error) {
      console.error('Unable to load harbor GLB:', error);
      const fallback = createHarborLandmark();
      group.add(fallback);
      anchor.userData.failed = true;
    }
  );
  return anchor;
}

function addIslandMarketGlb(group) {
  const anchor = new THREE.Group();
  anchor.name = 'IslandMarketLandmark_GLB';
  anchor.position.fromArray(ISLAND_MARKET_POSITION);
  anchor.rotation.y = ISLAND_MARKET_ROTATION;
  anchor.userData.loaded = false;
  group.add(anchor);

  const loader = new GLTFLoader();
  loader.load(
    ISLAND_MARKET_MODEL_URL,
    function (gltf) {
      const model = gltf.scene;
      model.name = 'IslandMarketLandmark_GLB_Source';
      model.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(model);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const footprint = Math.max(sourceSize.x, sourceSize.z);
      const scale = footprint > 0 ? ISLAND_MARKET_FOOTPRINT / footprint : 1;
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= scaledBounds.min.y;
      model.traverse(function (child) {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.name = child.name || 'IslandMarketLandmark_GLB_Mesh';
      });
      anchor.add(model);
      anchor.userData.loaded = true;
      anchor.userData.sourceSize = sourceSize.toArray();
      anchor.userData.appliedScale = scale;
    },
    undefined,
    function (error) {
      console.error('Unable to load island market GLB:', error);
      anchor.userData.failed = true;
    }
  );
  return anchor;
}

function addCoconutPalmTrees(group) {
  const anchor = new THREE.Group();
  anchor.name = 'CoconutPalmLandmarks_GLB';
  anchor.userData.loaded = false;
  group.add(anchor);

  const loader = new GLTFLoader();
  loader.load(
    COCONUT_PALM_MODEL_URL,
    function (gltf) {
      const model = gltf.scene;
      model.name = 'CoconutPalmLandmark_GLB_Source';
      model.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(model);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const scale = sourceSize.y > 0 ? 1 / sourceSize.y : 1;
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= scaledBounds.min.y;
      model.traverse(function (child) {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.name = child.name || 'CoconutPalmLandmark_GLB_Mesh';
      });

      COCONUT_PALM_PLACEMENTS.forEach(function (placement, index) {
        const palm = model.clone(true);
        palm.name = 'CoconutPalmLandmark_' + index;
        const instance = new THREE.Group();
        instance.name = 'CoconutPalmLandmark_Instance_' + index;
        instance.scale.setScalar(placement.height);
        instance.rotation.y = placement.rotation;
        instance.add(palm);

        const root = new THREE.Group();
        root.name = 'CoconutPalmLandmark_Anchor_' + index;
        root.position.fromArray(placement.position);
        root.add(instance);
        anchor.add(root);
      });

      anchor.userData.loaded = true;
      anchor.userData.sourceSize = sourceSize.toArray();
      anchor.userData.appliedScale = scale;
    },
    undefined,
    function (error) {
      console.error('Unable to load coconut palm GLB:', error);
      anchor.userData.failed = true;
    }
  );
  return anchor;
}

function addIslandCabin99999Glb(group) {
  const anchor = new THREE.Group();
  anchor.name = 'IslandCabin99999Landmark_GLB';
  anchor.position.fromArray(ISLAND_CABIN_99999_POSITION);
  anchor.rotation.y = ISLAND_CABIN_99999_ROTATION;
  anchor.userData.loaded = false;
  group.add(anchor);

  const loader = new GLTFLoader();
  loader.load(
    ISLAND_CABIN_444444_MODEL_URL,
    function (gltf) {
      const model = gltf.scene;
      model.name = 'IslandCabin99999Landmark_GLB_Source';
      model.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(model);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const footprint = Math.max(sourceSize.x, sourceSize.z);
      const scale = footprint > 0 ? ISLAND_CABIN_99999_FOOTPRINT / footprint : 1;
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= scaledBounds.min.y;
      model.traverse(function (child) {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.name = child.name || 'IslandCabin99999Landmark_GLB_Mesh';
      });
      anchor.add(model);
      anchor.userData.loaded = true;
      anchor.userData.sourceSize = sourceSize.toArray();
      anchor.userData.appliedScale = scale;
      anchor.userData.frontAxis = '+Z';
    },
    undefined,
    function (error) {
      console.error('Unable to load 99999 island cabin GLB:', error);
      anchor.userData.failed = true;
    }
  );
  return anchor;
}

function addWindmillCottageGlb(group) {
  const anchor = new THREE.Group();
  anchor.name = 'WindmillCottageLandmark_GLB';
  anchor.position.fromArray(WINDMILL_COTTAGE_POSITION);
  anchor.rotation.y = WINDMILL_COTTAGE_ROTATION;
  anchor.userData.loaded = false;
  group.add(anchor);

  const loader = new GLTFLoader();
  loader.load(
    WINDMILL_COTTAGE_MODEL_URL,
    function (gltf) {
      const model = gltf.scene;
      model.name = 'WindmillCottageLandmark_GLB_Source';
      model.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(model);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const footprint = Math.max(sourceSize.x, sourceSize.z);
      const scale = footprint > 0 ? WINDMILL_COTTAGE_FOOTPRINT / footprint : 1;
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= scaledBounds.min.y;
      model.traverse(function (child) {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.name = child.name || 'WindmillCottageLandmark_GLB_Mesh';
      });
      anchor.add(model);
      anchor.userData.loaded = true;
      anchor.userData.sourceSize = sourceSize.toArray();
      anchor.userData.appliedScale = scale;
      anchor.userData.frontAxis = '+X';
    },
    undefined,
    function (error) {
      console.error('Unable to load windmill cottage GLB:', error);
      anchor.userData.failed = true;
    }
  );
  return anchor;
}

function addIceCreamTruckGlb(group) {
  const anchor = new THREE.Group();
  anchor.name = 'IceCreamTruckLandmark_GLB';
  anchor.position.fromArray(ICE_CREAM_TRUCK_POSITION);
  anchor.rotation.y = ICE_CREAM_TRUCK_ROTATION;
  anchor.userData.loaded = false;
  group.add(anchor);

  const loader = new GLTFLoader();
  loader.load(
    ICE_CREAM_TRUCK_MODEL_URL,
    function (gltf) {
      const model = gltf.scene;
      model.name = 'IceCreamTruckLandmark_GLB_Source';
      model.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(model);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const footprint = Math.max(sourceSize.x, sourceSize.z);
      const scale = footprint > 0 ? ICE_CREAM_TRUCK_FOOTPRINT / footprint : 1;
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= scaledBounds.min.y;
      model.traverse(function (child) {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.name = child.name || 'IceCreamTruckLandmark_GLB_Mesh';
      });
      anchor.add(model);
      anchor.userData.loaded = true;
      anchor.userData.sourceSize = sourceSize.toArray();
      anchor.userData.appliedScale = scale;
      anchor.userData.frontAxis = '+X';
    },
    undefined,
    function (error) {
      console.error('Unable to load ice cream truck GLB:', error);
      anchor.userData.failed = true;
    }
  );
  return anchor;
}

function addCoastalCabinGlb(group) {
  const anchor = new THREE.Group();
  anchor.name = 'CoastalCabinLandmark_GLB';
  anchor.position.fromArray(COASTAL_CABIN_POSITION);
  anchor.rotation.y = COASTAL_CABIN_ROTATION;
  anchor.userData.loaded = false;
  group.add(anchor);

  const loader = new GLTFLoader();
  loader.load(
    COASTAL_CABIN_MODEL_URL,
    function (gltf) {
      const model = gltf.scene;
      model.name = 'CoastalCabinLandmark_GLB_Source';
      model.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(model);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const footprint = Math.max(sourceSize.x, sourceSize.z);
      const scale = footprint > 0 ? COASTAL_CABIN_FOOTPRINT / footprint : 1;
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= scaledBounds.min.y;
      model.traverse(function (child) {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.name = child.name || 'CoastalCabinLandmark_GLB_Mesh';
      });
      anchor.add(model);
      anchor.userData.loaded = true;
      anchor.userData.sourceSize = sourceSize.toArray();
      anchor.userData.appliedScale = scale;
    },
    undefined,
    function (error) {
      console.error('Unable to load coastal cabin GLB:', error);
      anchor.userData.failed = true;
    }
  );
  return anchor;
}

function addWoodCabinGlb(group) {
  const anchor = new THREE.Group();
  anchor.name = 'WoodCabinLandmark_GLB';
  anchor.position.fromArray(WOOD_CABIN_POSITION);
  anchor.rotation.y = WOOD_CABIN_ROTATION;
  anchor.userData.loaded = false;
  group.add(anchor);

  const loader = new GLTFLoader();
  loader.load(
    WOOD_CABIN_MODEL_URL,
    function (gltf) {
      const model = gltf.scene;
      model.name = 'WoodCabinLandmark_GLB_Source';
      model.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(model);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const footprint = Math.max(sourceSize.x, sourceSize.z);
      const scale = footprint > 0 ? WOOD_CABIN_FOOTPRINT / footprint : 1;
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= scaledBounds.min.y;
      model.traverse(function (child) {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.name = child.name || 'WoodCabinLandmark_GLB_Mesh';
      });
      anchor.add(model);
      anchor.userData.loaded = true;
      anchor.userData.sourceSize = sourceSize.toArray();
      anchor.userData.appliedScale = scale;
      anchor.userData.frontAxis = '+Z';
    },
    undefined,
    function (error) {
      console.error('Unable to load wood cabin GLB:', error);
      anchor.userData.failed = true;
    }
  );
  return anchor;
}

function addBlueHouseGlb(group) {
  const anchor = new THREE.Group();
  anchor.name = 'BlueHouseLandmark_GLB';
  anchor.position.fromArray(BLUE_HOUSE_POSITION);
  anchor.rotation.y = BLUE_HOUSE_ROTATION;
  anchor.userData.loaded = false;
  group.add(anchor);

  const loader = new GLTFLoader();
  loader.load(
    BLUE_HOUSE_MODEL_URL,
    function (gltf) {
      const model = gltf.scene;
      model.name = 'BlueHouseLandmark_GLB_Source';
      model.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(model);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const footprint = Math.max(sourceSize.x, sourceSize.z);
      const scale = footprint > 0 ? BLUE_HOUSE_FOOTPRINT / footprint : 1;
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= scaledBounds.min.y;
      model.traverse(function (child) {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.name = child.name || 'BlueHouseLandmark_GLB_Mesh';
      });
      anchor.add(model);
      anchor.userData.loaded = true;
      anchor.userData.sourceSize = sourceSize.toArray();
      anchor.userData.appliedScale = scale;
      anchor.userData.frontAxis = '+X';
    },
    undefined,
    function (error) {
      console.error('Unable to load blue house GLB:', error);
      anchor.userData.failed = true;
    }
  );
  return anchor;
}

function addFishingBoatGlb(group) {
  const anchor = new THREE.Group();
  anchor.name = 'FishingBoatLandmark_GLB';
  anchor.position.fromArray(FISHING_BOAT_POSITION);
  anchor.rotation.y = FISHING_BOAT_ROTATION;
  anchor.userData.loaded = false;
  group.add(anchor);

  const loader = new GLTFLoader();
  loader.load(
    FISHING_BOAT_MODEL_URL,
    function (gltf) {
      const model = gltf.scene;
      model.name = 'FishingBoatLandmark_GLB_Source';
      model.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(model);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const footprint = Math.max(sourceSize.x, sourceSize.z);
      const scale = footprint > 0 ? FISHING_BOAT_FOOTPRINT / footprint : 1;
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= scaledBounds.min.y;
      model.traverse(function (child) {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.name = child.name || 'FishingBoatLandmark_GLB_Mesh';
      });
      anchor.add(model);
      anchor.userData.loaded = true;
      anchor.userData.sourceSize = sourceSize.toArray();
      anchor.userData.appliedScale = scale;
      anchor.userData.frontAxis = '+X';
    },
    undefined,
    function (error) {
      console.error('Unable to load fishing boat GLB:', error);
      anchor.userData.failed = true;
    }
  );
  return anchor;
}

function addPinkShopGlb(group) {
  const anchor = new THREE.Group();
  anchor.name = 'PinkShopLandmark_GLB';
  anchor.position.fromArray(PINK_SHOP_POSITION);
  anchor.rotation.y = PINK_SHOP_ROTATION;
  anchor.userData.loaded = false;
  group.add(anchor);

  const loader = new GLTFLoader();
  loader.load(
    PINK_SHOP_MODEL_URL,
    function (gltf) {
      const model = gltf.scene;
      model.name = 'PinkShopLandmark_GLB_Source';
      model.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(model);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const footprint = Math.max(sourceSize.x, sourceSize.z);
      const scale = footprint > 0 ? PINK_SHOP_FOOTPRINT / footprint : 1;
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= scaledBounds.min.y;
      model.traverse(function (child) {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.name = child.name || 'PinkShopLandmark_GLB_Mesh';
      });
      anchor.add(model);
      anchor.userData.loaded = true;
      anchor.userData.sourceSize = sourceSize.toArray();
      anchor.userData.appliedScale = scale;
      anchor.userData.frontAxis = '+X';
    },
    undefined,
    function (error) {
      console.error('Unable to load pink shop GLB:', error);
      anchor.userData.failed = true;
    }
  );
  return anchor;
}

function addFountain(group) {
  const anchor = new THREE.Group();
  anchor.name = 'StarFountainLandmark_GLB';
  anchor.position.fromArray(STONE_FOUNTAIN_POSITION);
  anchor.userData.loaded = false;
  group.add(anchor);

  const loader = new GLTFLoader();
  loader.load(
    STONE_FOUNTAIN_MODEL_URL,
    function (gltf) {
      const model = gltf.scene;
      model.name = 'StoneFountainLandmark_GLB_Source';
      model.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(model);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const footprint = Math.max(sourceSize.x, sourceSize.z);
      const scale = footprint > 0 ? STONE_FOUNTAIN_FOOTPRINT / footprint : 1;
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= scaledBounds.min.y;
      model.traverse(function (child) {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.name = child.name || 'StoneFountainLandmark_GLB_Mesh';
      });
      anchor.add(model);
      anchor.userData.loaded = true;
      anchor.userData.sourceSize = sourceSize.toArray();
      anchor.userData.appliedScale = scale;
    },
    undefined,
    function (error) {
      console.error('Unable to load stone fountain GLB:', error);
      anchor.userData.failed = true;
    }
  );
  return anchor;
}

function addLighthouse(group) {
  const lighthouse = new THREE.Group();
  const stripeMaterials = [standard(COLORS.cream), standard(COLORS.red)];
  let y = 0;
  for (let i = 0; i < 5; i += 1) {
    const radiusBottom = 0.3 - i * 0.025;
    const radiusTop = 0.265 - i * 0.025;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(radiusTop, radiusBottom, 0.26, 12),
      stripeMaterials[i % 2]
    );
    band.position.y = y + 0.13;
    band.castShadow = true;
    lighthouse.add(band);
    y += 0.25;
  }

  const lantern = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.19, 0.18, 10),
    standard(0x8fd7df, {
      emissive: new THREE.Color(0x4d999d),
      emissiveIntensity: 0.55
    })
  );
  lantern.position.y = 1.32;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.25, 12), standard(COLORS.roof));
  cap.position.y = 1.54;
  cap.castShadow = true;

  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe4a0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const beamGroup = new THREE.Group();
  [-1, 1].forEach(function (direction) {
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.98, 12, 1, true),
      beamMaterial
    );
    beam.rotation.z = direction * Math.PI * 0.5;
    beam.position.x = direction * 0.5;
    beamGroup.add(beam);
  });
  beamGroup.position.y = lantern.position.y;

  const beaconLight = new THREE.PointLight(0xffd684, 0, 4.2, 2);
  beaconLight.position.y = lantern.position.y;
  beaconLight.castShadow = false;

  lighthouse.add(lantern, cap, beamGroup, beaconLight);
  lighthouse.position.set(-5.95, 0.246, -2.12);
  group.add(lighthouse);
  return {
    group: lighthouse,
    lantern: lantern,
    beamGroup: beamGroup,
    beamMaterial: beamMaterial,
    beaconLight: beaconLight,
    glow: 0,
    glowTarget: 0
  };
}

function addCloud(group, x, z, scale, seed) {
  const cloud = new THREE.Group();
  const material = standard(0xfff9e7, {
    emissive: new THREE.Color(0xc6d7c8),
    emissiveIntensity: 0.08,
    roughness: 1
  });
  const rand = seededRandom(seed);
  for (let i = 0; i < 5; i += 1) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.28 + rand() * 0.13, 10, 7), material);
    puff.position.set((i - 2) * 0.26, rand() * 0.08, (rand() - 0.5) * 0.12);
    puff.scale.y = 0.56;
    cloud.add(puff);
  }
  cloud.position.set(x, 3.2, z);
  cloud.scale.setScalar(scale);
  group.add(cloud);
  return cloud;
}

function drawMarkerIcon(ctx, kind) {
  ctx.strokeStyle = MARKER_ICON;
  ctx.fillStyle = MARKER_ICON;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'diner') {
    ctx.beginPath();
    ctx.moveTo(54, 28);
    ctx.lineTo(54, 80);
    ctx.moveTo(46, 28);
    ctx.lineTo(46, 52);
    ctx.quadraticCurveTo(46, 59, 54, 59);
    ctx.moveTo(62, 28);
    ctx.lineTo(62, 52);
    ctx.quadraticCurveTo(62, 59, 54, 59);
    ctx.moveTo(79, 28);
    ctx.quadraticCurveTo(72, 43, 80, 58);
    ctx.lineTo(80, 80);
    ctx.stroke();
  } else if (kind === 'windmill') {
    ctx.beginPath();
    ctx.moveTo(54, 57);
    ctx.lineTo(54, 85);
    ctx.moveTo(54, 57);
    ctx.lineTo(54, 25);
    ctx.moveTo(54, 57);
    ctx.lineTo(26, 57);
    ctx.moveTo(54, 57);
    ctx.lineTo(82, 57);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(54, 57, 7, 0, TAU);
    ctx.fill();
  } else if (kind === 'harbor') {
    ctx.beginPath();
    ctx.moveTo(54, 24);
    ctx.lineTo(54, 72);
    ctx.moveTo(36, 66);
    ctx.quadraticCurveTo(54, 89, 72, 66);
    ctx.moveTo(38, 42);
    ctx.lineTo(70, 42);
    ctx.stroke();
  } else if (kind === 'farm') {
    ctx.beginPath();
    ctx.moveTo(54, 84);
    ctx.quadraticCurveTo(30, 65, 40, 35);
    ctx.quadraticCurveTo(64, 36, 69, 58);
    ctx.quadraticCurveTo(76, 42, 83, 44);
    ctx.quadraticCurveTo(82, 73, 54, 84);
    ctx.stroke();
  } else if (kind === 'lighthouse') {
    ctx.beginPath();
    ctx.moveTo(43, 82);
    ctx.lineTo(48, 40);
    ctx.lineTo(60, 40);
    ctx.lineTo(65, 82);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(41, 40);
    ctx.lineTo(67, 40);
    ctx.moveTo(44, 58);
    ctx.lineTo(64, 58);
    ctx.moveTo(46, 72);
    ctx.lineTo(62, 72);
    ctx.moveTo(54, 22);
    ctx.lineTo(54, 34);
    ctx.moveTo(44, 13);
    ctx.lineTo(54, 22);
    ctx.lineTo(64, 13);
    ctx.stroke();
  } else if (kind === 'cabin') {
    ctx.beginPath();
    ctx.moveTo(30, 55);
    ctx.lineTo(54, 32);
    ctx.lineTo(78, 55);
    ctx.moveTo(38, 53);
    ctx.lineTo(38, 82);
    ctx.lineTo(70, 82);
    ctx.lineTo(70, 53);
    ctx.moveTo(49, 82);
    ctx.lineTo(49, 65);
    ctx.lineTo(59, 65);
    ctx.lineTo(59, 82);
    ctx.stroke();
  } else {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI / 2 + (i / 10) * TAU;
      const radius = i % 2 ? 22 : 43;
      const px = 54 + Math.cos(angle) * radius;
      const py = 56 + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

function markerTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 108;
  canvas.height = 126;
  const ctx = canvas.getContext('2d');

  ctx.save();
  ctx.shadowColor = 'rgba(94,10,10,.3)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = MARKER_RED;
  ctx.strokeStyle = MARKER_RED_DARK;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(54, 120);
  ctx.bezierCurveTo(47, 106, 19, 86, 19, 53);
  ctx.bezierCurveTo(19, 27, 35, 10, 54, 10);
  ctx.bezierCurveTo(73, 10, 89, 27, 89, 53);
  ctx.bezierCurveTo(89, 86, 61, 106, 54, 120);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  drawMarkerIcon(ctx, kind);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

function addMarker(group, marker, index) {
  const wrapper = new THREE.Group();
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x295168,
    transparent: true,
    opacity: 0.2,
    depthWrite: false
  });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: markerTexture(marker.kind),
      transparent: true,
      depthWrite: false,
      depthTest: false
    })
  );
  sprite.scale.set(0.7, 0.82, 1);
  sprite.position.y = 1.02;
  sprite.renderOrder = 20;
  sprite.userData.markerIndex = index;

  const pulseMaterial = new THREE.MeshBasicMaterial({
    color: 0xd73530,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.18, 24), pulseMaterial);
  pulse.rotation.x = -Math.PI / 2;
  pulse.position.y = 0.035;

  wrapper.add(shadow, pulse, sprite);
  wrapper.position.set(marker.x, 0.32, marker.z);
  group.add(wrapper);

  return {
    wrapper: wrapper,
    sprite: sprite,
    pulse: pulse,
    phase: index * 0.74
  };
}

function addCrayon(scene, x, z, rotation, color, length, castShadow) {
  const crayon = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.115, 0.115, length || 2.3, 18),
    standard(color, { roughness: 0.75 })
  );
  body.rotation.z = Math.PI / 2;
  body.castShadow = castShadow === true;

  const paper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.121, 0.121, (length || 2.3) * 0.72, 18, 1, true),
    standard(0xf2dfa4, { side: THREE.DoubleSide, roughness: 0.95 })
  );
  paper.rotation.z = Math.PI / 2;
  paper.position.x = 0.15;

  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.113, 0.23, 18),
    standard(color, { roughness: 0.75 })
  );
  tip.rotation.z = -Math.PI / 2;
  tip.position.x = -(length || 2.3) * 0.5 - 0.1;
  tip.castShadow = castShadow === true;

  crayon.add(body, paper, tip);
  crayon.position.set(x, 0.13, z);
  crayon.rotation.y = rotation || 0;
  scene.add(crayon);
  return crayon;
}

function addDeskProps(scene) {
  const props = new THREE.Group();

  const box = new THREE.Group();
  const boxBase = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.6, 1.35), standard(0xead9b7));
  boxBase.position.y = 0.32;
  boxBase.rotation.y = -0.12;
  boxBase.castShadow = true;
  boxBase.receiveShadow = true;

  const boxLid = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.16, 1.45), standard(0xf2e3c5));
  boxLid.position.set(0, 0.67, 0);
  boxLid.rotation.y = -0.12;
  boxLid.castShadow = true;
  box.add(boxBase, boxLid);
  box.position.set(6.0, 0, -4.55);
  props.add(box);

  [0xda5f4b, 0xd9a63b, 0x74a958, 0x487b86].forEach(function (color, index) {
    const crayon = addCrayon(props, 5.05 + index * 0.46, -4.58, 0.12, color, 1.45, true);
    crayon.position.y = 0.78;
  });

  const scatteredCrayons = [
    addCrayon(props, -4.55, 4.62, 0.7, 0xe45e4e, 2.45, false),
    addCrayon(props, -4.15, 4.32, -0.18, 0xe2bd45, 2.35, false),
    addCrayon(props, -3.95, 4.62, 1.08, 0x4f9aa2, 2.3, false)
  ];
  scatteredCrayons.forEach(function (crayon) {
    crayon.position.y = 0.44;
  });

  const note = new THREE.Group();
  const noteCanvas = document.createElement('canvas');
  noteCanvas.width = 768;
  noteCanvas.height = 512;
  const ctx = noteCanvas.getContext('2d');
  ctx.fillStyle = '#f0e0ba';
  ctx.fillRect(0, 0, 768, 512);
  ctx.strokeStyle = '#d2bb8b';
  ctx.lineWidth = 5;
  ctx.strokeRect(22, 22, 724, 468);
  ctx.fillStyle = '#79684c';
  ctx.font = '700 60px ' + CANVAS_FONT_FAMILY;
  ctx.fillText('FIELD NOTES', 70, 112);
  ctx.font = '500 31px ' + CANVAS_FONT_FAMILY;
  ctx.fillText('VOL. 07 · THE TIDELINE', 72, 162);
  ctx.strokeStyle = '#caa96a';
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.moveTo(76, 235 + i * 42);
    ctx.lineTo(680, 235 + i * 42);
    ctx.stroke();
  }
  ctx.fillStyle = '#d27349';
  ctx.beginPath();
  ctx.arc(600, 360, 58, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#f5e6c5';
  ctx.font = '700 42px ' + CANVAS_FONT_FAMILY;
  ctx.fillText('07', 568, 375);
  const noteTexture = new THREE.CanvasTexture(noteCanvas);
  const notePaper = new THREE.Mesh(
    new THREE.PlaneGeometry(2.75, 1.82),
    new THREE.MeshStandardMaterial({
      map: noteTexture,
      roughness: 1,
      side: THREE.DoubleSide
    })
  );
  notePaper.rotation.x = -Math.PI / 2;
  notePaper.rotation.z = 0.13;
  notePaper.position.set(-7.1, 0.06, 4.12);
  notePaper.receiveShadow = true;
  note.add(notePaper);
  props.add(note);

  const notebook = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.14, 1.55), standard(0x668f6a));
  cover.position.y = 0.03;
  cover.rotation.y = -0.18;
  cover.castShadow = true;
  const page = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.1, 1.42), standard(0xeee1c3));
  page.position.y = 0.13;
  page.rotation.y = -0.18;
  notebook.add(cover, page);

  const flower = new THREE.Group();
  const petalMaterial = standard(0xe8c85d);
  for (let i = 0; i < 6; i += 1) {
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), petalMaterial);
    const angle = (i / 6) * TAU;
    petal.position.set(Math.cos(angle) * 0.18, 0.25, Math.sin(angle) * 0.18);
    petal.scale.y = 0.6;
    flower.add(petal);
  }
  const center = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), standard(0x8c673c));
  center.position.y = 0.26;
  flower.add(center);
  flower.position.set(0.55, 0.17, 0.08);
  notebook.add(flower);
  notebook.position.set(7.3, 0.52, 4.08);
  props.add(notebook);

  scene.add(props);
  return props;
}

function addBoard(scene) {
  const board = new THREE.Group();
  board.name = 'paper-map-board';

  const boardShape = roundedRectShape(15.7, 7.7, 0.34);
  const boardGeometry = new THREE.ExtrudeGeometry(boardShape, {
    depth: 0.24,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.08,
    bevelThickness: 0.06,
    curveSegments: 4
  });
  const paperMap = paperTexture('#f0e2c4', '104,81,52');
  const paperMaterials = [
    new THREE.MeshStandardMaterial({
      color: 0xf0e2c4,
      map: paperMap,
      roughness: 1,
      metalness: 0
    }),
    standard(COLORS.paperEdge)
  ];
  const boardBase = new THREE.Mesh(boardGeometry, paperMaterials);
  boardBase.rotation.x = -Math.PI / 2;
  boardBase.position.y = 0;
  boardBase.receiveShadow = true;
  boardBase.castShadow = true;
  board.add(boardBase);

  const innerShape = roundedRectShape(14.85, 6.84, 0.22);
  const innerPanel = flatMesh(
    new THREE.ShapeGeometry(innerShape, 1),
    standard(COLORS.paperEdge),
    0,
    0.322,
    0
  );
  board.add(innerPanel);

  const waterShape = roundedRectShape(14.62, 6.61, 0.16);
  const waterMap = waterTexture();
  const water = flatMesh(
    new THREE.ShapeGeometry(waterShape, 1),
    new THREE.MeshStandardMaterial({
      color: 0x247a9b,
      map: waterMap,
      roughness: 0.9,
      metalness: 0
    }),
    0,
    BOARD_SEA_LEVEL,
    0
  );
  water.castShadow = false;
  board.add(water);

  const dashedPoints = [];
  const corner = 0.6;
  function dashLine(a, b, steps) {
    for (let i = 0; i < steps; i += 1) {
      if (i % 2 === 0) {
        const t0 = i / steps;
        const t1 = (i + 0.55) / steps;
        dashedPoints.push(
          THREE.MathUtils.lerp(a[0], b[0], t0),
          0.37,
          THREE.MathUtils.lerp(a[1], b[1], t0),
          THREE.MathUtils.lerp(a[0], b[0], t1),
          0.37,
          THREE.MathUtils.lerp(a[1], b[1], t1)
        );
      }
    }
  }
  dashLine([-6.3, -3.12], [6.3, -3.12], 64);
  dashLine([6.3, -3.12], [6.3, 3.12], 34);
  dashLine([6.3, 3.12], [-6.3, 3.12], 64);
  dashLine([-6.3, 3.12], [-6.3, -3.12], 34);
  const dashedGeometry = new THREE.BufferGeometry();
  dashedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dashedPoints, 3));
  const dashes = new THREE.LineSegments(
    dashedGeometry,
    new THREE.LineBasicMaterial({
      color: 0xcab789,
      transparent: true,
      opacity: 0.8
    })
  );
  board.add(dashes);

  scene.add(board);
  return board;
}

function addRoute(group) {
  const points = [
    [-5.55, -1.72],
    [-4.95, -0.82],
    [-3.95, -0.18],
    [-2.85, -0.25],
    [-1.65, -0.57],
    [-0.8, -0.94]
  ];
  const curve = new THREE.CatmullRomCurve3(
    points.map(function (point) {
      return new THREE.Vector3(point[0], 0.34, point[1]);
    })
  );
  const samples = curve.getPoints(52);
  const material = new THREE.MeshBasicMaterial({
    color: 0xcde2d9,
    transparent: true,
    opacity: 0.76
  });
  for (let i = 0; i < samples.length; i += 3) {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.055, 10), material);
    dot.rotation.x = -Math.PI / 2;
    dot.position.copy(samples[i]);
    group.add(dot);
  }
}

function addMapDetails(group) {
  const mainIsland = addIsland(group, 2.55, 0.15, 8.35, 5.72, 26, {
    sand: 0xefdaa7,
    grass: 0x80ba50
  });
  addIsland(group, -2.55, 0.95, 3.2, 2.15, 48, {
    sand: 0xead2a2,
    grass: 0x7aaf4c
  });
  addIsland(group, -4.35, 1.33, 3.05, 2.05, 63, {
    sand: 0xf1dba9,
    grass: 0x8fbf56
  });
  addIsland(group, -0.28, -2.16, 3.52, 1.8, 91, {
    sand: 0xe9d39f,
    grass: 0x78ad4a
  });

  addRoad(
    [
      [0.15, 0.15],
      [1.4, 0.55],
      [2.55, 0.5],
      [3.45, 0.22],
      [4.25, 0.1],
      [5.2, 0.38],
      [6.15, -0.32]
    ],
    0.46,
    COLORS.road,
    0.34
  );
  addRoad(
    [
      [1.4, 0.55],
      [1.35, -0.45],
      [1.1, -1.35],
      [0.98, -1.95]
    ],
    0.36,
    COLORS.road,
    0.345
  );
  addRoad(
    [
      [2.55, 0.5],
      [2.45, 1.35],
      [1.58, 1.76],
      [0.74, 1.68]
    ],
    0.36,
    COLORS.road,
    0.345
  );
  addRoad(
    [
      [4.25, 0.1],
      [5.15, 0.32],
      [5.72, 1.22]
    ],
    0.32,
    COLORS.road,
    0.345
  );

  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(1.18, 28),
    standard(COLORS.stoneLight, { roughness: 1 })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(2.8, 0.331, 0.15);
  plaza.receiveShadow = true;
  group.add(plaza);
  const fountain = addFountain(group);

  const harbor = addHarborGlb(group);
  const market = addIslandMarketGlb(group);
  const islandCabin99999 = addIslandCabin99999Glb(group);
  const windmillCottage = addWindmillCottageGlb(group);
  addCoconutPalmTrees(group);
  const iceCreamTruck = addIceCreamTruckGlb(group);
  const coastalCabin = addCoastalCabinGlb(group);
  const woodCabin = addWoodCabinGlb(group);
  const blueHouse = addBlueHouseGlb(group);
  const fishingBoat = addFishingBoatGlb(group);
  const pinkShop = addPinkShopGlb(group);
  const lighthouse = createLighthouseIslandModel();
  lighthouse.root.position.fromArray(LIGHTHOUSE_LANDMARK_POSITION);
  group.add(lighthouse.root);

  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(0.66, 28),
    standard(0x61c3d0, { transparent: true, opacity: 0.75 })
  );
  pond.rotation.x = -Math.PI / 2;
  pond.scale.z = 0.63;
  pond.position.fromArray(LAKE_MARKER_1_POSITION);
  group.add(pond);

  const smallPool = pond.clone();
  smallPool.position.set(-4.18, 0.34, 1.4);
  smallPool.scale.set(0.61, 0.61, 0.4);
  group.add(smallPool);

  addDock(group, [
    [-1.22, 0.72],
    [-1.72, 0.58],
    [-2.18, 0.48],
    [-2.57, 0.65]
  ]);
  addDock(group, [
    [-1.76, 0.58],
    [-1.52, -0.08],
    [-1.08, -0.48]
  ]);
  addDock(group, [
    [-4.34, 1.57],
    [-4.05, 1.05],
    [-3.7, 0.68]
  ]);

  addRoute(group);

  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * TAU + 0.2;
    addRock(
      group,
      -4.35 + Math.cos(angle) * (1.31 + (i % 3) * 0.11),
      1.33 + Math.sin(angle) * (0.85 + (i % 2) * 0.12),
      0.6 + (i % 4) * 0.12,
      i % 2 ? 0xb4a78d : 0x9a9e91
    );
  }

  const flowerColors = [0xf1cf69, 0xe58b79, 0xf5e5d2];
  for (let i = 0; i < 28; i += 1) {
    const flower = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.04 + (i % 3) * 0.012, 0),
      standard(flowerColors[i % flowerColors.length])
    );
    const angle = i * 2.1;
    flower.position.set(
      3.1 + Math.cos(angle) * (1.3 + (i % 5) * 0.15),
      0.37,
      -0.95 + Math.sin(angle) * (0.65 + (i % 4) * 0.1)
    );
    flower.castShadow = true;
    group.add(flower);
  }

  const clouds = [
    addCloud(group, -3.3, -1.55, 0.95, 2),
    addCloud(group, -0.65, -0.42, 0.72, 4),
    addCloud(group, 4.9, -2.72, 0.9, 9),
    addCloud(group, -6.4, -0.42, 0.7, 10)
  ];

  return {
    fountain: fountain,
    harbor: harbor,
    market: market,
    islandCabin99999: islandCabin99999,
    windmillCottage: windmillCottage,
    iceCreamTruck: iceCreamTruck,
    coastalCabin: coastalCabin,
    woodCabin: woodCabin,
    blueHouse: blueHouse,
    fishingBoat: fishingBoat,
    pinkShop: pinkShop,
    lighthouse: lighthouse,
    clouds: clouds,
    mainIsland: mainIsland
  };
}

export function createWorld(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x667a55);
  scene.fog = new THREE.Fog(0x667a55, 22, 34);

  const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.05, 80);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', '可拖拽漫游的折纸群岛三维地图');
  renderer.domElement.setAttribute('role', 'application');
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);

  const hemisphere = new THREE.HemisphereLight(0xe6f1de, 0x5b4d37, 0.57);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xfff1cf, 0.95);
  sun.position.set(-7, 15, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 10;
  sun.shadow.camera.bottom = -10;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 35;
  sun.shadow.bias = -0.00035;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x8cc8d4, 0.18);
  fill.position.set(8, 8, -6);
  scene.add(fill);

  const desk = new THREE.Mesh(new THREE.PlaneGeometry(28, 18), standard(0x75875b, { roughness: 1 }));
  desk.rotation.x = -Math.PI / 2;
  desk.position.y = -0.62;
  desk.receiveShadow = true;
  scene.add(desk);

  for (let i = 0; i < 26; i += 1) {
    const fleck = new THREE.Mesh(
      new THREE.CircleGeometry(0.02 + (i % 4) * 0.007, 5),
      standard(i % 2 ? 0x90a16e : 0x586d4d)
    );
    fleck.rotation.x = -Math.PI / 2;
    fleck.position.set(-13 + (i * 4.7) % 26, -0.61, -8 + (i * 3.2) % 16);
    scene.add(fleck);
  }

  const board = addBoard(scene);
  const mapGroup = new THREE.Group();
  mapGroup.position.y = MAP_GROUP_HEIGHT;
  board.add(mapGroup);

  const details = addMapDetails(mapGroup);
  addDeskProps(scene);

  const markers = [
    {
      x: -2.45,
      z: 0.55,
      kind: 'harbor',
      kicker: '潮汐港 · 探索点 01',
      title: '海鸥码头',
      body: '海鸥码头 Gullhaven Wharf：海岛主要停靠码头，成群海鸥常年在此盘旋。木栈道被海风反复打磨，远道而来的探险者，大多从这里踏上这座神秘海岛。',
      storyFont: true,
      postcard: 'media/gullhaven-wharf.jpg',
      snapshotPoster: 'media/gullhaven-wharf-snapshot-cover.png',
      snapshotEndedPoster: 'media/gullhaven-wharf-snapshot-ended.png',
      snapshotVideo: 'media/gullhaven-wharf-snapshot.mp4',
      focusCamera: [1.2, 3.0, 5.0],
      focusTarget: [-3.12, 0.92, 0.95],
      task: {
        key: 'harbor',
        title: '补全潮汐账簿',
        acceptedBody: '海风把最后一页潮汐记录吹进了货箱。清点木箱，把缺漏的时刻补回账簿。',
        completeBody: '潮汐时刻已经重新写好。船长把这一页夹进航线图，港口重新恢复了秩序。',
        activeAction: '清点潮汐木箱',
        completeAction: '账簿已补全'
      }
    },
    {
      // Keep the task pin centered over the island cabin.
      x: 0.08,
      z: -2.16,
      kind: 'windmill',
      kicker: '红帆风舍 · 探索点 02',
      title: '红帆风舍',
      body: '红帆风舍 Redsail Hut：挂着褪色红帆的海边小屋，属于一位老航海家。红帆见过无数风暴与晚霞，屋里存放海图，藏着他走遍大洋的冒险故事。',
      storyFont: true,
      postcard: 'media/redsail-hut.jpg',
      snapshotPoster: 'media/redsail-hut-snapshot-cover.png',
      snapshotEndedPoster: 'media/redsail-hut-snapshot-ended.png',
      snapshotVideo: 'media/redsail-hut-snapshot.mp4',
      focusCamera: [3.1, 3.2, 2.8],
      focusTarget: [0.2, 1.0, -1.75],
      task: {
        key: 'windmill',
        title: '校准海风风向标',
        acceptedBody: '风向标卡在东南和西南之间。等一阵稳定的风，再把叶片对准航路。',
        completeBody: '风向标重新指向海面。风车的节奏变得平稳，草坡上的白线也不再摇摆。',
        activeAction: '校准风向标',
        completeAction: '风向标已校准'
      }
    },
    {
      x: 2.8,
      z: 0.15,
      kind: 'fountain',
      kicker: '中央广场 · 探索点 03',
      title: '星泉广场',
      body: '星泉广场 Star Spring Square：岛上的中心空地，一眼就能看见汩汩涌冒的星泉。传说泉水夜里会泛着微光，早期岛民在此聚会祈福，也是探险者交换情报的地方。',
      storyFont: true,
      postcard: 'media/star-spring-square.jpg',
      snapshotPoster: 'media/star-spring-square-snapshot-cover.png',
      snapshotEndedPoster: 'media/star-spring-square-snapshot-ended.png',
      snapshotVideo: 'media/star-spring-square-snapshot.mp4',
      focusCamera: [2.8, 3.2, 5.65],
      focusTarget: [2.8, 0.78, 0.15],
      task: {
        key: 'fountain',
        title: '打捞沉底许愿星',
        acceptedBody: '星泉的排水口被一枚旧许愿星卡住了。把它捞起来，铃声就会恢复。',
        completeBody: '许愿星在掌心亮了一下。泉水重新流动，广场上的人都听见了清脆的铃声。',
        activeAction: '打捞许愿星',
        completeAction: '愿望已归档'
      }
    },
    {
      x: 0.82,
      z: 1.75,
      kind: 'farm',
      kicker: '青苗田 · 探索点 04',
      title: '风信圩场',
      body: '风信圩场 Windbell Market：海岛独有的露天集市，摊位挂着海风铃。从前岛民在这里交换海货、手作，风一吹铃音四起，也会捎来远方航船带来的消息。',
      storyFont: true,
      postcard: 'media/windbell-market.jpg',
      snapshotPoster: 'media/windbell-market-snapshot-cover.png',
      snapshotEndedPoster: 'media/windbell-market-snapshot-ended.png',
      snapshotVideo: 'media/windbell-market-snapshot.mp4',
      focusCamera: [0.2, 3.1, 5.85],
      focusTarget: [0.82, 0.68, 1.75],
      task: {
        key: 'farm',
        title: '整理周末菜篮',
        acceptedBody: '三份订单贴着不同颜色的便签。把番茄、南瓜和香草按顺序装进菜篮。',
        completeBody: '每一篮蔬菜都放上了小木牌。农夫把最大的一篮留给了今晚的灯塔晚餐。',
        activeAction: '装好集市菜篮',
        completeAction: '菜篮已备好'
      }
    },
    {
      x: -5.95,
      z: -2.12,
      kind: 'lighthouse',
      kicker: '西岬灯塔 · 探索点 05',
      title: '守望灯塔',
      body: '守望灯塔 Watchlight Beacon：伫立礁石高处的灯塔，曾经为茫茫大海上的航船指引方向。如今灯火不再长明，但塔身静静伫立，日复一日守望着这片海湾。',
      storyFont: true,
      postcard: 'media/watchlight-beacon.jpg',
      snapshotPoster: 'media/watchlight-beacon-snapshot-cover.png',
      snapshotEndedPoster: 'media/watchlight-beacon-snapshot-ended.png',
      snapshotVideo: 'media/watchlight-beacon-snapshot.mp4',
      focusCamera: [-1.0, 6.2, 5.8],
      focusTarget: [-5.95, 1.55, -2.12],
      task: {
        key: 'lighthouse',
        title: '点亮灯塔航标',
        acceptedBody: '潮声正在转向。值守员把控制杆交给你，确认灯室后就可以让航标重新亮起。',
        completeBody: '暖光已经重新扫过海面，归航的小船能看见这条安全的金色水道了。',
        activeAction: '点亮灯塔航标',
        completeAction: '航标已点亮'
      }
    },
    {
      x: 3.03,
      z: -2.45,
      kind: 'cabin',
      kicker: '泉畔木屋 · 探索点 06',
      title: '泉畔木屋',
      body: '泉畔木屋 Springside Cabin：紧挨着星泉搭建的原木小屋，从前是守泉人的居所。屋内留存着旧日记与工具，伴着泉水叮咚，藏着不少关于海岛起源的细碎传闻。',
      storyFont: true,
      postcard: 'media/springside-cabin.jpg',
      snapshotPoster: 'media/springside-cabin-snapshot-cover.png',
      snapshotEndedPoster: 'media/springside-cabin-snapshot-ended.png',
      snapshotVideo: 'media/springside-cabin-snapshot.mp4',
      focusCamera: [4.05, 2.25, 0.85],
      focusTarget: [3.03, 0.82, -2.45],
      task: {
        key: 'cabin',
        title: '整理泉畔木屋',
        acceptedBody: '涨潮前要把散落在门口的箱子和工具收进屋里，再检查靠海一侧的窗板。',
        completeBody: '箱子和工具都已经归位，窗板也重新扣好。泉畔木屋可以安心迎接今晚的潮声。',
        activeAction: '整理小屋物资',
        completeAction: '小屋已整理'
      }
    },
    {
      x: 4.05,
      z: -1.5,
      kind: 'cabin',
      kicker: '清涧栖屋 · 探索点 07',
      title: '清涧栖屋',
      body: '清涧栖屋 Clearbrook Haven：藏在山林溪流旁的小屋，被绿荫环绕。清冽山涧从屋侧流过，适合躲避燥热，很多探险者在此休整，聆听山林与流水的声音。',
      storyFont: true,
      postcard: 'media/clearbrook-haven.jpg',
      snapshotPoster: 'media/clearbrook-haven-snapshot-cover.png',
      snapshotEndedPoster: 'media/clearbrook-haven-snapshot-ended.png',
      snapshotVideo: 'media/clearbrook-haven-snapshot.mp4',
      focusCamera: [2.95, 2.3, 0.95],
      focusTarget: [4.05, 0.78, -1.5],
      task: {
        key: 'wood-cabin',
        title: '整理清涧栖屋',
        acceptedBody: '先把门廊边的行李搬进屋里，再把面向山涧的窗台擦拭干净，让小木屋准备好迎接客人。',
        completeBody: '门廊已经收拾整齐，窗台也重新亮了起来。从栖屋里望出去，正好能看到清涧的水花。',
        activeAction: '整理栖屋门廊',
        completeAction: '栖屋已整理'
      }
    },
    {
      x: 5.64,
      z: 0.52,
      kind: 'cabin',
      kicker: '蓝湾住宅 · 探索点 08',
      title: '蓝湾住宅',
      body: '蓝湾住宅 Bluecove Residence：坐落安静内湾的民居，被蔚蓝海面环抱。这里住着久居海岛的人家，屋前种满耐盐花草，是整片小岛最安逸温柔的一隅。',
      storyFont: true,
      postcard: 'media/bluecove-residence.jpg',
      snapshotPoster: 'media/bluecove-residence-snapshot-cover.png',
      snapshotEndedPoster: 'media/bluecove-residence-snapshot-ended.png',
      snapshotVideo: 'media/bluecove-residence-snapshot.mp4',
      focusCamera: [3.55, 2.45, 1.45],
      focusTarget: [5.64, 0.8, 0.52],
      task: {
        key: 'blue-house',
        title: '探访蓝湾住宅',
        acceptedBody: '沿着木栈道走到蓝湾住宅，看看面向内湾的主门廊和蓝色屋顶。',
        completeBody: '蓝湾住宅的门廊已经检查完毕，从阳台可以同时望见安静内湾和岸边的耐盐花草。',
        activeAction: '查看蓝湾门廊',
        completeAction: '住宅已探访'
      }
    },
    {
      x: 5.08,
      z: 2.28,
      kind: 'harbor',
      kicker: '潮汐渔港 · 探索点 09',
      title: '潮汐渔港',
      body: '潮汐渔港 Tidehaven：依海湾而建的小渔港，潮起时渔船归岸，潮落露出滩涂。世代渔民在此出海捕捞，海浪年年往复，记录着海岛与大海相伴的日常。',
      storyFont: true,
      postcard: 'media/tidal-fishing-port.png',
      snapshotPoster: 'media/tidal-fishing-port-snapshot-cover.png',
      snapshotEndedPoster: 'media/tidal-fishing-port-snapshot-ended.png',
      snapshotVideo: 'media/tidal-fishing-port-snapshot.mp4',
      focusCamera: [5.08, FISHING_BOAT_FOCUS_TARGET_Y + 2.1, 4.95],
      focusTarget: [5.08, FISHING_BOAT_FOCUS_TARGET_Y, 2.2],
      task: {
        key: 'fishing-dock',
        title: '查看海边渔船',
        acceptedBody: '登上近岸木码头，查看归港渔船和面向海面的蓝色渔屋。',
        completeBody: '渔船与码头已经记录进航海册，下一次潮汐到来前可以准备再次出海。',
        activeAction: '查看渔船码头',
        completeAction: '渔港已记录'
      }
    },
    {
      x: 5.42,
      z: -0.75,
      kind: 'cabin',
      kicker: '粉色海滨小店 · 探索点 10',
      title: '粉色海滨小店',
      body: '粉色海滨小店 Pinkshore Boutique：沙滩边柔和的粉色小店，售卖贝壳饰品、海盐伴手礼。店主收集各地航海小物，不少旅人会在此停下，挑一件纪念品带走大海的浪漫。',
      storyFont: true,
      postcard: 'media/pinkshore-boutique.jpg',
      snapshotPoster: 'media/pinkshore-boutique-snapshot-cover.png',
      snapshotEndedPoster: 'media/pinkshore-boutique-snapshot-ended.png',
      snapshotVideo: 'media/pinkshore-boutique-snapshot.mp4',
      focusCamera: [2.72, 2.5, 0.15],
      focusTarget: [5.42, 0.82, -0.75],
      task: {
        key: 'pink-shop',
        title: '探访粉色海滨小店',
        acceptedBody: '沿着喷泉东侧的小路走到粉色海滨小店，看看面向喷泉的彩色门廊与橱窗。',
        completeBody: '粉色海滨小店已经记入岛屿地图，门口的冲浪板和暖色橱窗成了新的路标。',
        activeAction: '逛逛粉色海滨小店',
        completeAction: '小店已探访'
      }
    }
  ];

  const markerObjects = markers.map(function (marker, index) {
    return addMarker(mapGroup, marker, index);
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const view = {
    panX: 0,
    panZ: 0,
    zoom: 0
  };
  const targetView = {
    panX: 0,
    panZ: 0,
    zoom: 0
  };
  const introPosition = new THREE.Vector3(0, 14.2, 10.9);
  const introTarget = new THREE.Vector3(0, 0, 0.1);
  const mapPosition = new THREE.Vector3(0, 18.3, 4.8);
  const mapTarget = new THREE.Vector3(0, 0, 0.1);
  const currentLook = mapTarget.clone();
  const focusPosition = new THREE.Vector3();
  const focusTarget = new THREE.Vector3();
  const focusCameraPosition = new THREE.Vector3();
  const focusOrbitAxis = new THREE.Vector3();
  const focusVerticalAxis = new THREE.Vector3(0, 1, 0);
  let presentation = 0;
  let mapMode = false;
  let focusActive = false;
  let focusIndex = -1;
  let focusZoom = 0;
  const focusOrbit = {
    yaw: 0,
    pitch: 0
  };
  let elapsed = 0;

  camera.position.copy(introPosition);
  camera.lookAt(introTarget);

  function resize() {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
  }

  function setPresentation(value) {
    presentation = Math.max(0, Math.min(1, value));
    mapMode = presentation >= 0.995;
  }

  function setMapMode(enabled) {
    mapMode = enabled;
  }

  function setView(nextPanX, nextPanZ, nextZoom) {
    targetView.panX = THREE.MathUtils.clamp(nextPanX, -2.1, 2.1);
    targetView.panZ = THREE.MathUtils.clamp(nextPanZ, -1.15, 1.15);
    targetView.zoom = THREE.MathUtils.clamp(nextZoom, -2.4, 3.1);
  }

  function resetView() {
    targetView.panX = 0;
    targetView.panZ = 0;
    targetView.zoom = 0;
  }

  function focusMarker(index) {
    const marker = markers[index];
    if (!marker || !marker.focusCamera || !marker.focusTarget) return;
    focusActive = true;
    focusIndex = index;
    mapMode = true;
    focusPosition.fromArray(marker.focusCamera);
    focusTarget.fromArray(marker.focusTarget);
    focusZoom = 0;
    focusOrbit.yaw = 0;
    focusOrbit.pitch = 0;
  }

  function clearFocus() {
    focusActive = false;
    focusIndex = -1;
    focusZoom = 0;
    focusOrbit.yaw = 0;
    focusOrbit.pitch = 0;
  }

  function setFocusZoom(value) {
    focusZoom = THREE.MathUtils.clamp(value, -1.4, 2.4);
    return focusZoom;
  }

  function orbitFocus(deltaYaw, deltaPitch) {
    focusOrbit.yaw = THREE.MathUtils.clamp(
      focusOrbit.yaw + deltaYaw,
      -0.72,
      0.72
    );
    focusOrbit.pitch = THREE.MathUtils.clamp(
      focusOrbit.pitch + deltaPitch,
      -0.28,
      0.34
    );
  }

  function setBeaconLit(lit) {
    details.lighthouse.glowTarget = lit ? 1 : 0;
  }

  function pickMarker(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(
      markerObjects.map(function (item) {
        return item.sprite;
      }),
      false
    );
    if (!hits.length) return -1;
    return hits[0].object.userData.markerIndex;
  }

  function update(delta, time) {
    elapsed += delta;

    if (!mapMode) {
      const eased = presentation * presentation * (3 - 2 * presentation);
      camera.position.lerpVectors(introPosition, mapPosition, eased);
      const look = new THREE.Vector3().lerpVectors(introTarget, mapTarget, eased);
      currentLook.copy(look);
      camera.lookAt(currentLook);
    } else if (focusActive) {
      focusCameraPosition
        .copy(focusPosition)
        .sub(focusTarget)
        .multiplyScalar(Math.pow(0.86, focusZoom))
        .applyAxisAngle(focusVerticalAxis, focusOrbit.yaw);
      focusOrbitAxis
        .set(1, 0, 0)
        .applyAxisAngle(focusVerticalAxis, focusOrbit.yaw);
      focusCameraPosition
        .applyAxisAngle(focusOrbitAxis, focusOrbit.pitch)
        .add(focusTarget);
      camera.position.lerp(focusCameraPosition, Math.min(1, delta * 3.6));
      currentLook.lerp(focusTarget, Math.min(1, delta * 4.2));
      camera.lookAt(currentLook);
    } else {
      view.panX += (targetView.panX - view.panX) * Math.min(1, delta * 7);
      view.panZ += (targetView.panZ - view.panZ) * Math.min(1, delta * 7);
      view.zoom += (targetView.zoom - view.zoom) * Math.min(1, delta * 7);
      const destination = new THREE.Vector3(
        view.panX * 1.25,
        18.3 - view.zoom * 0.7,
        4.65 + view.panZ * 0.9
      );
      camera.position.lerp(destination, Math.min(1, delta * 5.5));
      currentLook.lerp(
        new THREE.Vector3(view.panX * 0.55, 0, 0.1 + view.panZ * 0.3),
        Math.min(1, delta * 5.5)
      );
      camera.lookAt(currentLook);
    }

    const harborAnimation = details.harbor.userData.animation;
    if (harborAnimation) {
      harborAnimation.birds.forEach(function (bird, index) {
        bird.position.y = bird.userData.baseY + Math.sin(elapsed * 1.8 + index) * 0.012;
      });
      harborAnimation.boat.position.y =
        harborAnimation.boat.userData.baseY + Math.sin(elapsed * 1.5) * 0.014;
      harborAnimation.flags.forEach(function (flag, index) {
        flag.rotation.z = -0.08 + Math.sin(elapsed * 2.2 + index * 0.7) * 0.025;
      });
    }
    details.clouds.forEach(function (cloud, index) {
      cloud.position.x += Math.sin(time * 0.00018 + index) * 0.0003;
    });

    markerObjects.forEach(function (item, index) {
      const bob = Math.sin(elapsed * 2.1 + item.phase) * 0.045;
      item.wrapper.visible = !focusActive;
      item.sprite.position.y = 0.77 + bob;
      item.pulse.scale.setScalar(1 + ((elapsed * 0.7 + index * 0.1) % 1) * 0.65);
      item.pulse.material.opacity = 0.34 * (1 - ((elapsed * 0.7 + index * 0.1) % 1));
    });

    const lighthouse = details.lighthouse;
    lighthouse.glow += (lighthouse.glowTarget - lighthouse.glow) * Math.min(1, delta * 3.2);
    lighthouse.beamMaterial.opacity = lighthouse.glow * 0.24;
    lighthouse.beamGroup.rotation.y += delta * (0.28 + lighthouse.glow * 0.5);
    lighthouse.beaconLight.intensity = lighthouse.glow * 1.25;
    lighthouse.lantern.material.emissiveIntensity = 0.55 + lighthouse.glow * 2.2;

    renderer.render(scene, camera);
  }

  return {
    resize: resize,
    update: update,
    setPresentation: setPresentation,
    setMapMode: setMapMode,
    setView: setView,
    resetView: resetView,
    focusMarker: focusMarker,
    clearFocus: clearFocus,
    setFocusZoom: setFocusZoom,
    orbitFocus: orbitFocus,
    setBeaconLit: setBeaconLit,
    pickMarker: pickMarker,
    markers: markers,
    renderer: renderer
  };
}
