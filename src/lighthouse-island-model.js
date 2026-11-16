import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import shoreProfile from './island-shore-profile.json';

const COTTAGE_MODEL_URL = './models/lighthouse-cottage.glb';
const COTTAGE_FOOTPRINT = 1.82;
const COTTAGE_BOAT_CUTOFF_X = 0.245;

const PALETTE = {
  grass: 0x3f7e2e,
  grassLight: 0x6dad48,
  grassDark: 0x326c34,
  sand: 0xd2b777,
  sandShade: 0xba9e63,
  chalk: 0xe1e7dd,
  chalkShade: 0xc1cec0,
  plaster: 0xeae5d8,
  plasterShade: 0xcdd0c4,
  coral: 0x9c2f24,
  coralDark: 0x76221b,
  turquoise: 0x2a7488,
  turquoiseDark: 0x225f72,
  cream: 0xeadcb9,
  timber: 0x7b4b2b,
  timberLight: 0xa87846,
  timberDark: 0x4e3524,
  metal: 0x4c4a40,
  leaf: 0x2d782f,
  leafLight: 0x4b9738,
  blossom: 0xf5f1e3,
  foam: 0xf1f1e7,
  waterline: 0x49b3b5
};

function material(color, options) {
  return new THREE.MeshStandardMaterial(
    Object.assign(
      {
        color,
        roughness: 0.88,
        metalness: 0,
        flatShading: true
      },
      options || {}
    )
  );
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return function () {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function organicShape(radiusX, radiusZ, seed, wobble) {
  const shape = new THREE.Shape();
  const count = 36;
  const random = seededRandom(seed);
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const radius =
      1 +
      Math.sin(angle * 3 + seed) * wobble +
      Math.sin(angle * 7 + seed * 0.4) * wobble * 0.52 +
      (random() - 0.5) * wobble * 0.34;
    const x = Math.cos(angle) * radiusX * radius;
    const y = Math.sin(angle) * radiusZ * radius;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function tracedShape(points, scale) {
  const shape = new THREE.Shape();
  points.forEach(function (point, index) {
    const x = point[0] * scale;
    const y = point[1] * scale;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  return shape;
}

function addMesh(parent, geometry, meshMaterial, position, rotation, name, shadow) {
  const object = new THREE.Mesh(geometry, meshMaterial);
  object.position.set(position[0], position[1], position[2]);
  if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2]);
  object.name = name;
  object.castShadow = shadow !== false;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function addBox(parent, size, meshMaterial, position, rotation, name, shadow) {
  return addMesh(
    parent,
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    meshMaterial,
    position,
    rotation,
    name,
    shadow
  );
}

function addCylinder(parent, radii, height, segments, meshMaterial, position, name, shadow) {
  return addMesh(
    parent,
    new THREE.CylinderGeometry(radii[0], radii[1], height, segments),
    meshMaterial,
    position,
    null,
    name,
    shadow
  );
}

function makeExtrudedLayer(shape, topY, depth, bevel, meshMaterial, name) {
  const mesh = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 1,
      curveSegments: 3
    }),
    meshMaterial
  );
  mesh.name = name;
  mesh.position.set(0, topY - depth - bevel, 0);
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeArchedPanel(width, height, depth, meshMaterial, name) {
  const shape = new THREE.Shape();
  const half = width * 0.5;
  const shoulder = height * 0.64;
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  shape.lineTo(half, shoulder);
  shape.quadraticCurveTo(half, height, 0, height);
  shape.quadraticCurveTo(-half, height, -half, shoulder);
  shape.closePath();
  const mesh = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSize: 0.008,
      bevelThickness: 0.006,
      bevelSegments: 1,
      curveSegments: 5
    }),
    meshMaterial
  );
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeBoatHullGeometry(length, width, depth) {
  const sectionCount = 10;
  const ringSize = 7;
  const positions = [];
  const indices = [];

  for (let section = 0; section < sectionCount; section += 1) {
    const t = section / (sectionCount - 1);
    const taper = Math.pow(Math.sin(Math.PI * t), 0.58);
    const halfWidth = Math.max(0.008, width * 0.5 * taper);
    const x = (t - 0.5) * length;
    const centerLift = Math.sin(Math.PI * t) * 0.018;
    const ring = [
      [x, 0.04 + centerLift, -halfWidth],
      [x, -0.015, -halfWidth * 0.98],
      [x, -0.09, -halfWidth * 0.65],
      [x, -depth, 0],
      [x, -0.09, halfWidth * 0.65],
      [x, -0.015, halfWidth * 0.98],
      [x, 0.04 + centerLift, halfWidth]
    ];
    ring.forEach(function (point) {
      positions.push(point[0], point[1], point[2]);
    });
  }

  for (let section = 0; section < sectionCount - 1; section += 1) {
    for (let point = 0; point < ringSize - 1; point += 1) {
      const a = section * ringSize + point;
      const b = a + 1;
      const c = a + ringSize;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addCliff(parent, x, z, scale, rotation) {
  const cliff = addMesh(
    parent,
    new THREE.DodecahedronGeometry(0.21 * scale, 0),
    material(PALETTE.chalk),
    [x, 0.1 + 0.08 * scale, z],
    [rotation || 0, (rotation || 0) * 1.7, 0.08],
    'LighthouseIsland_CliffRock_' + x + '_' + z
  );
  cliff.scale.set(1.64, 1.06, 0.92);
  return cliff;
}

function addDock(parent) {
  const dock = new THREE.Group();
  dock.name = 'LighthouseIsland_Dock';
  const plankMaterial = material(PALETTE.timber);
  for (let index = 0; index < 12; index += 1) {
    const z = 0.64 + index * 0.095;
    const drop = index * 0.0055;
    const plank = addBox(
      dock,
      [0.58 + (index % 3) * 0.012, 0.052, 0.088],
      plankMaterial,
      [Math.sin(index * 1.7) * 0.008, 0.218 - drop, z],
      [0, Math.sin(index * 0.8) * 0.025, 0],
      'LighthouseIsland_DockPlank_' + index
    );
    plank.userData.explodeWithParent = true;
  }

  const postMaterial = material(PALETTE.timberDark);
  const postGroups = [-0.28, 0.28].map(function (x, side) {
    const group = new THREE.Group();
    group.name = 'LighthouseIsland_DockPosts' + (side === 0 ? 'Left' : 'Right');
    dock.add(group);
    return group;
  });
  [-0.28, 0.28].forEach(function (x, side) {
    for (let index = 0; index < 3; index += 1) {
      const z = 0.73 + index * 0.4;
      addCylinder(
        postGroups[side],
        [0.033, 0.045],
        0.43,
        6,
        postMaterial,
        [x, 0.055 - index * 0.005, z],
        'LighthouseIsland_DockPost_' + side + '_' + index
      );
    }
  });

  [-0.22, 0.22].forEach(function (x, side) {
    addBox(
      dock,
      [0.055, 0.045, 1.16],
      material(PALETTE.timberDark),
      [x, 0.177, 1.18],
      null,
      'LighthouseIsland_DockStringer_' + side
    );
  });

  parent.add(dock);
  return dock;
}

function addBoat(parent) {
  const boat = new THREE.Group();
  boat.name = 'LighthouseIsland_Boat';

  const hull = addMesh(
    boat,
    makeBoatHullGeometry(1.02, 0.4, 0.13),
    material(PALETTE.cream, { side: THREE.DoubleSide }),
    [0, 0.02, 0],
    null,
    'LighthouseIsland_BoatHull'
  );
  hull.scale.set(1, 1, 1);

  const rimPoints = [];
  const rimCount = 24;
  for (let index = 0; index < rimCount; index += 1) {
    const angle = (index / rimCount) * Math.PI * 2;
    rimPoints.push(
      new THREE.Vector3(
        Math.cos(angle) * 0.495,
        0.075 + Math.abs(Math.sin(angle)) * 0.006,
        Math.sin(angle) * 0.198
      )
    );
  }
  addMesh(
    boat,
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPoints, true), 32, 0.014, 5, true),
    material(PALETTE.coralDark),
    [0, 0, 0],
    null,
    'LighthouseIsland_BoatRim'
  );

  addBox(
    boat,
    [0.66, 0.025, 0.24],
    material(PALETTE.turquoiseDark),
    [0, 0.05, 0],
    null,
    'LighthouseIsland_BoatInterior'
  );

  [-0.18, 0.13].forEach(function (x, index) {
    addBox(
      boat,
      [0.075, 0.035, 0.31],
      material(PALETTE.coral),
      [x, 0.1, 0],
      null,
      'LighthouseIsland_BoatSeat_' + index
    );
  });

  addMesh(
    boat,
    new THREE.ConeGeometry(0.075, 0.18, 5),
    material(PALETTE.cream),
    [0.5, 0.02, 0],
    [0, 0, -Math.PI / 2],
    'LighthouseIsland_BoatBow'
  );

  addBox(
    boat,
    [0.76, 0.018, 0.025],
    material(PALETTE.waterline),
    [0, -0.012, 0.185],
    null,
    'LighthouseIsland_BoatStripePort'
  );
  addBox(
    boat,
    [0.76, 0.018, 0.025],
    material(PALETTE.waterline),
    [0, -0.012, -0.185],
    null,
    'LighthouseIsland_BoatStripeStarboard'
  );

  boat.position.set(-0.82, 0.09, 1.78);
  boat.rotation.y = -0.4;
  parent.add(boat);
  return boat;
}

function addCottage(parent) {
  const cottage = new THREE.Group();
  cottage.name = 'LighthouseIsland_KeeperCottage';
  cottage.position.set(0.94, 0.255, 0.24);
  cottage.rotation.y = -0.08;
  cottage.userData.loaded = false;

  function createGeometrySubset(sourceGeometry, indices) {
    const geometry = new THREE.BufferGeometry();
    Object.keys(sourceGeometry.attributes).forEach(function (name) {
      geometry.setAttribute(name, sourceGeometry.getAttribute(name));
    });
    geometry.setIndex(indices);

    const position = sourceGeometry.getAttribute('position');
    const box = new THREE.Box3();
    const vertex = new THREE.Vector3();
    for (let index = 0; index < indices.length; index += 1) {
      vertex.fromBufferAttribute(position, indices[index]);
      box.expandByPoint(vertex);
    }
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    return geometry;
  }

  function createCottageMeshWithoutBoat(mesh) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    if (!position || !index) return null;

    const indices = [];
    for (let offset = 0; offset < index.count; offset += 3) {
      const a = index.getX(offset);
      const b = index.getX(offset + 1);
      const c = index.getX(offset + 2);
      const centerX =
        (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
      if (centerX <= COTTAGE_BOAT_CUTOFF_X) indices.push(a, b, c);
    }

    if (!indices.length) return null;
    const subset = new THREE.Mesh(createGeometrySubset(geometry, indices), mesh.material);
    subset.name = 'LighthouseIsland_KeeperCottage_HouseMesh';
    subset.position.copy(mesh.position);
    subset.quaternion.copy(mesh.quaternion);
    subset.scale.copy(mesh.scale);
    subset.castShadow = true;
    subset.receiveShadow = true;
    return subset;
  }

  function alignMeshToOrigin(mesh) {
    const bounds = mesh.geometry.boundingBox;
    const center = bounds.getCenter(new THREE.Vector3());
    mesh.position.x -= center.x;
    mesh.position.y -= bounds.min.y;
    mesh.position.z -= center.z;
    return bounds.getSize(new THREE.Vector3());
  }

  const loader = new GLTFLoader();
  loader.load(
    COTTAGE_MODEL_URL,
    function (gltf) {
      const model = gltf.scene;
      model.name = 'LighthouseIsland_KeeperCottage_GLB';
      model.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(model);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      let sourceMesh = null;
      model.traverse(function (child) {
        if (!child.isMesh) return;
        if (!sourceMesh) sourceMesh = child;
      });

      const cottageMesh = sourceMesh
        ? createCottageMeshWithoutBoat(sourceMesh)
        : null;
      if (!cottageMesh) {
        throw new Error('The lighthouse cottage GLB does not contain indexed mesh data.');
      }

      const meshParent = sourceMesh.parent;
      meshParent.remove(sourceMesh);
      const houseSize = alignMeshToOrigin(cottageMesh);

      const footprint = Math.max(houseSize.x, houseSize.z);
      const scale = footprint > 0 ? COTTAGE_FOOTPRINT / footprint : 1;
      const houseGroup = new THREE.Group();
      houseGroup.name = 'LighthouseIsland_KeeperCottage_House';
      houseGroup.scale.setScalar(scale);
      houseGroup.add(cottageMesh);
      cottage.add(houseGroup);

      cottage.userData.loaded = true;
      cottage.userData.sourceSize = sourceSize.toArray();
      cottage.userData.appliedScale = scale;
    },
    undefined,
    function (error) {
      console.error('Unable to load lighthouse cottage GLB:', error);
      cottage.userData.failed = true;
    }
  );

  parent.add(cottage);
  return cottage;
}

function addTower(parent) {
  const terrace = new THREE.Group();
  terrace.name = 'LighthouseIsland_TowerTerrace';
  addCylinder(
    terrace,
    [0.64, 0.78],
    0.2,
    14,
    material(PALETTE.chalk),
    [0, 0.1, 0],
    'LighthouseIsland_TowerPlatform'
  );
  addCylinder(
    terrace,
    [0.57, 0.61],
    0.05,
    14,
    material(PALETTE.grass),
    [0, 0.215, 0],
    'LighthouseIsland_TowerTerraceGrass'
  );

  const fenceMaterial = material(PALETTE.timberDark);
  for (let index = 0; index < 11; index += 1) {
    const angle = (index / 11) * Math.PI * 2;
    if (Math.cos(angle) > 0.72 && Math.sin(angle) > 0.15) continue;
    addCylinder(
      terrace,
      [0.012, 0.015],
      0.2,
      5,
      fenceMaterial,
      [Math.cos(angle) * 0.63, 0.3, Math.sin(angle) * 0.63],
      'LighthouseIsland_TerraceRailPost_' + index
    );
  }
  addMesh(
    terrace,
    new THREE.TorusGeometry(0.63, 0.012, 5, 30, Math.PI * 1.55),
    fenceMaterial,
    [0, 0.4, 0],
    [Math.PI / 2, 0, -0.28],
    'LighthouseIsland_TerraceRailTop'
  );
  terrace.position.set(-0.56, 0.255, -0.36);
  parent.add(terrace);

  const tower = new THREE.Group();
  tower.name = 'LighthouseIsland_Tower';
  tower.position.y = 0.395;

  addCylinder(
    tower,
    [0.52, 0.64],
    0.19,
    16,
    material(PALETTE.plaster),
    [0, 0.095, 0],
    'LighthouseIsland_TowerPlinth'
  );

  const stripeMaterials = [material(PALETTE.plaster), material(PALETTE.coral)];
  const bandHeights = [0.3, 0.3, 0.28, 0.26, 0.24];
  let height = 0.18;
  for (let index = 0; index < bandHeights.length; index += 1) {
    const bandHeight = bandHeights[index];
    const bottomRadius = 0.46 - index * 0.032;
    const topRadius = 0.428 - index * 0.032;
    addMesh(
      tower,
      new THREE.CylinderGeometry(topRadius, bottomRadius, bandHeight + 0.02, 16),
      stripeMaterials[index % 2],
      [0, height + bandHeight * 0.5, 0],
      null,
      'LighthouseIsland_TowerBand_' + index
    );
    height += bandHeight;
  }

  const door = makeArchedPanel(0.16, 0.29, 0.035, material(PALETTE.timberDark), 'LighthouseIsland_TowerDoor');
  door.position.set(0, 0.34, 0.445);
  tower.add(door);
  addBox(
    tower,
    [0.22, 0.03, 0.065],
    material(PALETTE.cream),
    [0, 0.64, 0.45],
    null,
    'LighthouseIsland_TowerDoorLintel'
  );

  const towerWindow = addBox(
    tower,
    [0.1, 0.15, 0.025],
    material(PALETTE.turquoiseDark),
    [0, 1.13, 0.385],
    null,
    'LighthouseIsland_TowerWindow'
  );
  towerWindow.userData.explodeWithParent = true;
  addBox(
    tower,
    [0.14, 0.025, 0.04],
    material(PALETTE.cream),
    [0, 1.08, 0.402],
    null,
    'LighthouseIsland_TowerWindowSill'
  );

  const ladder = new THREE.Group();
  ladder.name = 'LighthouseIsland_TowerLadder';
  [-0.085, 0.085].forEach(function (x, side) {
    addCylinder(
      ladder,
      [0.008, 0.009],
      0.62,
      5,
      material(PALETTE.timberDark),
      [x, 0, 0],
      'LighthouseIsland_LadderRail_' + side
    );
  });
  for (let index = 0; index < 7; index += 1) {
    addBox(
      ladder,
      [0.2, 0.013, 0.015],
      material(PALETTE.timberDark),
      [0, -0.24 + index * 0.08, 0],
      null,
      'LighthouseIsland_LadderRung_' + index
    );
  }
  ladder.position.set(-0.35, 0.31, 0.39);
  ladder.rotation.z = -0.1;
  tower.add(ladder);

  const galleryY = height + 0.07;
  addCylinder(
    tower,
    [0.49, 0.49],
    0.075,
    16,
    material(PALETTE.plaster),
    [0, galleryY, 0],
    'LighthouseIsland_GallerySlab'
  );
  addMesh(
    tower,
    new THREE.TorusGeometry(0.425, 0.014, 6, 28),
    material(PALETTE.metal),
    [0, galleryY + 0.21, 0],
    [Math.PI / 2, 0, 0],
    'LighthouseIsland_GalleryRailTop'
  );
  addMesh(
    tower,
    new THREE.TorusGeometry(0.425, 0.009, 5, 28),
    material(PALETTE.metal),
    [0, galleryY + 0.1, 0],
    [Math.PI / 2, 0, 0],
    'LighthouseIsland_GalleryRailMid'
  );
  const railMaterial = material(PALETTE.metal);
  const galleryPostAssembly = new THREE.Group();
  galleryPostAssembly.name = 'LighthouseIsland_GalleryPosts';
  tower.add(galleryPostAssembly);
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    addCylinder(
      galleryPostAssembly,
      [0.011, 0.014],
      0.28,
      5,
      railMaterial,
      [Math.cos(angle) * 0.425, galleryY + 0.1, Math.sin(angle) * 0.425],
      'LighthouseIsland_GalleryPost_' + index
    );
  }

  const lanternMaterial = material(0xb9dde0, {
    transparent: true,
    opacity: 0.68,
    roughness: 0.18,
    metalness: 0.04,
    emissive: 0xffc973,
    emissiveIntensity: 0.2,
    side: THREE.DoubleSide
  });
  const lantern = addCylinder(
    tower,
    [0.285, 0.285],
    0.31,
    12,
    lanternMaterial,
    [0, galleryY + 0.23, 0],
    'LighthouseIsland_LanternRoom'
  );
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    addBox(
      tower,
      [0.02, 0.29, 0.02],
      railMaterial,
      [Math.cos(angle) * 0.282, galleryY + 0.23, Math.sin(angle) * 0.282],
      [0, -angle, 0],
      'LighthouseIsland_LanternMullion_' + index
    );
  }

  addMesh(
    tower,
    new THREE.ConeGeometry(0.38, 0.38, 14),
    material(PALETTE.coralDark),
    [0, galleryY + 0.62, 0],
    null,
    'LighthouseIsland_Roof'
  );
  addCylinder(
    tower,
    [0.018, 0.023],
    0.31,
    6,
    material(PALETTE.metal),
    [0, galleryY + 0.96, 0],
    'LighthouseIsland_Finial'
  );

  const vane = new THREE.Group();
  vane.name = 'LighthouseIsland_WeatherVane';
  addBox(
    vane,
    [0.62, 0.02, 0.02],
    material(PALETTE.metal),
    [0, 0, 0],
    null,
    'LighthouseIsland_WeatherVaneRod'
  );
  addBox(
    vane,
    [0.02, 0.02, 0.3],
    material(PALETTE.metal),
    [0, 0, 0],
    null,
    'LighthouseIsland_WeatherVaneCrossbar'
  );
  addMesh(
    vane,
    new THREE.ConeGeometry(0.07, 0.2, 4),
    material(PALETTE.cream),
    [0.38, 0, 0],
    [0, 0, -Math.PI / 2],
    'LighthouseIsland_WeatherVaneArrow'
  );
  addMesh(
    vane,
    new THREE.ConeGeometry(0.055, 0.13, 4),
    material(PALETTE.coral),
    [-0.37, 0, 0],
    [0, 0, Math.PI / 2],
    'LighthouseIsland_WeatherVaneTail'
  );
  addMesh(
    vane,
    new THREE.ConeGeometry(0.04, 0.1, 4),
    material(PALETTE.turquoise),
    [0, 0, 0.19],
    [Math.PI / 2, 0, 0],
    'LighthouseIsland_WindGaugeTeal'
  );
  addMesh(
    vane,
    new THREE.ConeGeometry(0.036, 0.09, 4),
    material(0xf1c35c),
    [0, 0, -0.19],
    [-Math.PI / 2, 0, 0],
    'LighthouseIsland_WindGaugeGold'
  );
  vane.position.set(0, galleryY + 1.12, 0);
  tower.add(vane);

  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe4a0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const beamGroup = new THREE.Group();
  beamGroup.name = 'LighthouseIsland_BeaconBeams';
  [-1, 1].forEach(function (direction) {
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.95, 12, 1, true),
      beamMaterial
    );
    beam.rotation.z = (direction * Math.PI) / 2;
    beam.position.x = direction * 0.48;
    beamGroup.add(beam);
  });
  beamGroup.position.y = galleryY + 0.23;
  tower.add(beamGroup);

  const beaconLight = new THREE.PointLight(0xffd684, 0, 3.8, 2);
  beaconLight.position.y = galleryY + 0.23;
  tower.add(beaconLight);

  terrace.add(tower);
  return {
    group: tower,
    lantern: lantern,
    beamGroup: beamGroup,
    beamMaterial: beamMaterial,
    beaconLight: beaconLight,
    glow: 0,
    glowTarget: 0
  };
}

function addFlag(parent) {
  const flag = new THREE.Group();
  flag.name = 'LighthouseIsland_Flag';
  addCylinder(
    flag,
    [0.011, 0.014],
    0.72,
    6,
    material(PALETTE.metal),
    [0, 0.36, 0],
    'LighthouseIsland_FlagPole'
  );
  addBox(
    flag,
    [0.3, 0.08, 0.012],
    material(0xf2c75a, { side: THREE.DoubleSide }),
    [0.16, 0.58, 0],
    [0, 0, -0.05],
    'LighthouseIsland_FlagGold'
  );
  addBox(
    flag,
    [0.3, 0.08, 0.013],
    material(PALETTE.coral, { side: THREE.DoubleSide }),
    [0.16, 0.66, 0],
    [0, 0, -0.05],
    'LighthouseIsland_FlagCoral'
  );
  flag.position.set(-1.08, 0.255, -0.24);
  parent.add(flag);
  return flag;
}

function addIslandEdgeDetails(parent) {
  const cliffs = new THREE.Group();
  cliffs.name = 'LighthouseIsland_CliffSkirt';
  [
    [-1.5, 0.76, 1.15, 0.18],
    [-1.27, -0.72, 1.0, 0.34],
    [-0.55, -1.06, 1.08, 0.62],
    [0.54, -1.0, 1.12, 0.5],
    [1.32, -0.55, 1.04, 0.22],
    [1.48, 0.12, 0.92, -0.14],
    [1.12, 0.82, 0.84, -0.34],
    [-0.78, 0.94, 0.8, -0.08]
  ].forEach(function (item) {
    const cliff = addCliff(cliffs, item[0], item[1], item[2], item[3]);
    cliff.userData.explodeWithParent = true;
  });
  parent.add(cliffs);

  const foam = new THREE.Group();
  foam.name = 'LighthouseIsland_ShoreFoam';
  const foamMaterial = material(PALETTE.foam, {
    transparent: true,
    opacity: 0.82,
    roughness: 1
  });
  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * Math.PI * 2 + 0.13;
    const radiusX = 1.72 + (index % 3) * 0.08;
    const radiusZ = 1.23 + (index % 4) * 0.045;
    const patch = addMesh(
      foam,
      new THREE.IcosahedronGeometry(0.045 + (index % 4) * 0.011, 1),
      foamMaterial,
      [Math.cos(angle) * radiusX, 0.015, Math.sin(angle) * radiusZ],
      [0, angle, 0],
      'LighthouseIsland_Foam_' + index,
      false
    );
    patch.scale.set(1.7, 0.22, 0.65);
  }
  parent.add(foam);
  return { cliffs: cliffs, foam: foam };
}

function registerRuntime(root, parts) {
  const nodes = { root: root };
  const meshes = {};
  const colliders = {};
  let generatedDetailIndex = 0;
  root.traverse(function (object) {
    if (!object.isMesh || object.name) return;
    object.name = 'LighthouseIsland_Detail_' + String(generatedDetailIndex).padStart(2, '0');
    generatedDetailIndex += 1;
  });
  root.traverse(function (object) {
    if (object.name && object !== root) nodes[object.name] = object;
    if (object.isMesh && object.name) {
      meshes[object.name] = object;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      colliders[object.name] = {
        type: 'box',
        bounds: {
          min: object.geometry.boundingBox.min.toArray(),
          max: object.geometry.boundingBox.max.toArray()
        }
      };
    }
  });

  const sockets = {
    boatMooring: new THREE.Object3D(),
    lampFocus: new THREE.Object3D(),
    cottageDoor: new THREE.Object3D()
  };
  sockets.boatMooring.name = 'LighthouseIsland_Socket_BoatMooring';
  sockets.boatMooring.position.set(-0.55, 0.12, 1.22);
  sockets.lampFocus.name = 'LighthouseIsland_Socket_LampFocus';
  sockets.lampFocus.position.set(-0.56, 2.23, -0.36);
  sockets.cottageDoor.name = 'LighthouseIsland_Socket_CottageDoor';
  sockets.cottageDoor.position.set(0.56, 0.48, 0.86);
  Object.keys(sockets).forEach(function (key) {
    root.add(sockets[key]);
  });

  root.userData.sculptRuntime = {
    nodes: nodes,
    meshes: meshes,
    sockets: sockets,
    colliders: colliders,
    destructionGroups: parts
  };
  root.userData.explodable = true;
  root.userData.clickable = true;
}

function makeRuntimeManifest(root, specParts) {
  const parts = Object.keys(specParts).map(function (id) {
    const object = specParts[id];
    let triangles = 0;
    if (object) {
      object.traverse(function (child) {
        if (!child.isMesh) return;
        const geometry = child.geometry;
        const position = geometry.attributes ? geometry.attributes.position : null;
        const count = geometry.index ? geometry.index.count : position ? position.count : 0;
        triangles += Math.floor(count / 3);
      });
    }
    return {
      name: id,
      kind: object && object.isMesh ? 'mesh' : 'part',
      module: object ? object.name : null,
      triangles: triangles,
      built: Boolean(object)
    };
  });

  let unnamedMeshes = 0;
  let integralMeshes = 0;
  root.traverse(function (object) {
    if (!object.isMesh) return;
    integralMeshes += 1;
    if (!object.name) unnamedMeshes += 1;
  });

  return {
    model: 'Azure Isle Lighthouse Island',
    parts: parts.filter(function (part) {
      return part.built;
    }),
    unnamedMeshes: unnamedMeshes,
    integralMeshes: integralMeshes
  };
}

export function createLighthouseIslandModel() {
  const root = new THREE.Group();
  root.name = 'LighthouseIsland';
  root.userData.modelSource = 'procedural-code-from-reference';

  const wetShore = makeExtrudedLayer(
    tracedShape(shoreProfile.points, 1.04),
    0.06,
    0.035,
    0.006,
    material(PALETTE.timberDark),
    'LighthouseIsland_WetShore'
  );
  root.add(wetShore);

  const sandBase = makeExtrudedLayer(
    tracedShape(shoreProfile.points, 1),
    0.2,
    0.15,
    0.03,
    material(PALETTE.sand),
    'LighthouseIsland_SandBase'
  );
  root.add(sandBase);

  const grass = makeExtrudedLayer(
    tracedShape(shoreProfile.points, 0.84),
    0.265,
    0.044,
    0.012,
    material(PALETTE.grass),
    'LighthouseIsland_GrassTerrace'
  );
  root.add(grass);

  const edgeDetails = addIslandEdgeDetails(root);
  const cottage = addCottage(root);
  const tower = addTower(root);
  const dock = addDock(root);
  const boat = addBoat(root);
  const flag = addFlag(root);

  const markerAnchor = new THREE.Object3D();
  markerAnchor.name = 'LighthouseIsland_MarkerAnchor';
  markerAnchor.position.set(0, 1.5, -0.16);
  root.add(markerAnchor);

  const parts = {
    island: grass,
    towerTerrace: root.getObjectByName('LighthouseIsland_TowerTerrace'),
    tower: tower.group,
    cottage: cottage,
    dock: dock,
    boat: boat,
    flag: flag,
    cliffs: edgeDetails.cliffs,
    foam: edgeDetails.foam
  };

  const specParts = {
    'cliff-skirt': edgeDetails.cliffs,
    'sand-ledge': sandBase,
    'tower-assembly': parts.towerTerrace,
    'cottage-assembly': cottage,
    'tower-white-base': root.getObjectByName('LighthouseIsland_TowerBand_0'),
    'tower-coral-base': root.getObjectByName('LighthouseIsland_TowerBand_1'),
    'tower-white-mid': root.getObjectByName('LighthouseIsland_TowerBand_2'),
    'tower-coral-mid': root.getObjectByName('LighthouseIsland_TowerBand_3'),
    'tower-white-top': root.getObjectByName('LighthouseIsland_TowerBand_4'),
    'gallery-slab': root.getObjectByName('LighthouseIsland_GallerySlab'),
    'gallery-post': root.getObjectByName('LighthouseIsland_GalleryPosts'),
    'lantern-room': root.getObjectByName('LighthouseIsland_LanternRoom'),
    roof: root.getObjectByName('LighthouseIsland_Roof'),
    finial: root.getObjectByName('LighthouseIsland_Finial'),
    'weather-vane-rod': root.getObjectByName('LighthouseIsland_WeatherVaneRod'),
    'weather-vane-arrow': root.getObjectByName('LighthouseIsland_WeatherVaneArrow'),
    'dock-walkway': dock,
    'dock-post-left': root.getObjectByName('LighthouseIsland_DockPostsLeft'),
    'dock-post-right': root.getObjectByName('LighthouseIsland_DockPostsRight'),
    'boat-hull': root.getObjectByName('LighthouseIsland_BoatHull'),
    'boat-bow': root.getObjectByName('LighthouseIsland_BoatBow'),
    'boat-seat': root.getObjectByName('LighthouseIsland_BoatSeat_0'),
    'cliff-west': root.getObjectByName('LighthouseIsland_CliffRock_-1.5_0.76'),
    'cliff-east': root.getObjectByName('LighthouseIsland_CliffRock_1.48_0.12')
  };

  root.userData.parts = parts;
  root.userData.specParts = specParts;
  registerRuntime(root, parts);
  root.userData.runtimeManifest = makeRuntimeManifest(root, specParts);
  return Object.assign({ root: root, markerAnchor: markerAnchor }, tower);
}
