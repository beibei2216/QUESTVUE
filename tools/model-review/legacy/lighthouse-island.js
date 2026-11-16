import * as THREE from 'three';

const PALETTE = {
  grass: 0x70b84b,
  grassLight: 0x91cb60,
  grassDark: 0x438b43,
  sand: 0xe9d8a6,
  chalk: 0xe3e7dc,
  chalkShade: 0xc7d3c7,
  plaster: 0xf2ecdd,
  plasterShade: 0xd8d1c2,
  coral: 0xd95643,
  coralDark: 0xb43e34,
  turquoise: 0x68b7c2,
  turquoiseDark: 0x3e8998,
  cream: 0xf4e7c6,
  timber: 0xb88959,
  timberDark: 0x745136,
  metal: 0x48483f,
  leaf: 0x4d9e49,
  leafLight: 0x73bd57,
  waterline: 0x4c9faa
};

function material(color, options) {
  return new THREE.MeshStandardMaterial(
    Object.assign(
      {
        color,
        roughness: 0.9,
        metalness: 0,
        flatShading: true
      },
      options || {}
    )
  );
}

function organicShape(radiusX, radiusZ, seed, wobble) {
  const shape = new THREE.Shape();
  const count = 30;
  let state = seed >>> 0;
  const random = function () {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const radius =
      1 +
      Math.sin(angle * 3 + seed) * wobble +
      Math.sin(angle * 7 + seed * 0.4) * wobble * 0.55 +
      (random() - 0.5) * wobble * 0.42;
    const x = Math.cos(angle) * radiusX * radius;
    const y = Math.sin(angle) * radiusZ * radius;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
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

function addTree(parent, x, z, scale, variant) {
  const tree = new THREE.Group();
  tree.name = 'LighthouseIsland_Tree_' + variant;
  const trunk = addMesh(
    tree,
    new THREE.CylinderGeometry(0.055 * scale, 0.085 * scale, 0.42 * scale, 6),
    material(PALETTE.timberDark),
    [0, 0.21 * scale, 0],
    null,
    'LighthouseIsland_TreeTrunk'
  );
  trunk.castShadow = true;

  const crownMaterial = material(variant === 'light' ? PALETTE.leafLight : PALETTE.leaf);
  const crown = addMesh(
    tree,
    new THREE.IcosahedronGeometry(0.25 * scale, 1),
    crownMaterial,
    [0, 0.55 * scale, 0],
    null,
    'LighthouseIsland_TreeCrown'
  );
  crown.scale.set(1.12, 0.9, 1);

  if (variant === 'double') {
    const second = addMesh(
      tree,
      new THREE.IcosahedronGeometry(0.2 * scale, 1),
      crownMaterial.clone(),
      [0.13 * scale, 0.72 * scale, -0.03 * scale],
      [0.2, 0.4, 0],
      'LighthouseIsland_TreeCrownSecondary'
    );
    second.scale.set(1.08, 0.92, 1);
  }

  tree.position.set(x, 0.23, z);
  parent.add(tree);
  return tree;
}

function addCliff(parent, x, z, scale, rotation) {
  const cliffMaterial = material(PALETTE.chalk);
  const cliff = addMesh(
    parent,
    new THREE.DodecahedronGeometry(0.24 * scale, 0),
    cliffMaterial,
    [x, 0.13 + 0.08 * scale, z],
    [rotation || 0, (rotation || 0) * 1.8, 0.1],
    'LighthouseIsland_CliffRock'
  );
  cliff.scale.set(1.45, 1.15, 0.9);
  return cliff;
}

function addDock(parent) {
  const dock = new THREE.Group();
  dock.name = 'LighthouseIsland_Dock';
  const plankMaterial = material(PALETTE.timber);
  for (let index = 0; index < 11; index += 1) {
    addMesh(
      dock,
      new THREE.BoxGeometry(0.62, 0.055, 0.105),
      plankMaterial,
      [0.05, 0.17, 0.58 + index * 0.105],
      null,
      'LighthouseIsland_DockPlank'
    );
  }

  const postMaterial = material(PALETTE.timberDark);
  [-0.23, 0.33].forEach(function (x, side) {
    for (let index = 0; index < 3; index += 1) {
      addMesh(
        dock,
        new THREE.CylinderGeometry(0.035, 0.045, 0.4, 6),
        postMaterial,
        [x, 0.01, 0.72 + index * 0.46],
        null,
        'LighthouseIsland_DockPost_' + side + '_' + index
      );
    }
  });
  parent.add(dock);
  return dock;
}

function addBoat(parent) {
  const boat = new THREE.Group();
  boat.name = 'LighthouseIsland_Boat';
  const cream = material(PALETTE.cream);
  addMesh(
    boat,
    new THREE.BoxGeometry(0.7, 0.15, 0.28),
    cream,
    [0, 0.09, 0],
    [0, 0.1, 0],
    'LighthouseIsland_BoatHull'
  );
  addMesh(
    boat,
    new THREE.ConeGeometry(0.18, 0.35, 5),
    cream,
    [0.5, 0.09, 0],
    [0, 0, -Math.PI / 2],
    'LighthouseIsland_BoatBow'
  );
  addMesh(
    boat,
    new THREE.BoxGeometry(0.68, 0.035, 0.3),
    material(PALETTE.coral),
    [0, 0.1, 0],
    [0, 0.1, 0],
    'LighthouseIsland_BoatInterior'
  );
  [-0.14, 0.12].forEach(function (x, index) {
    addMesh(
      boat,
      new THREE.BoxGeometry(0.055, 0.04, 0.26),
      material(PALETTE.coralDark),
      [x, 0.18, 0],
      null,
      'LighthouseIsland_BoatSeat_' + index
    );
  });
  addMesh(
    boat,
    new THREE.BoxGeometry(0.68, 0.035, 0.29),
    material(PALETTE.waterline),
    [0, 0.025, 0],
    [0, 0.1, 0],
    'LighthouseIsland_BoatStripe'
  );
  boat.position.set(-1.23, 0.21, 1.03);
  boat.rotation.y = -0.12;
  parent.add(boat);
  return boat;
}

function addCottage(parent) {
  const cottage = new THREE.Group();
  cottage.name = 'LighthouseIsland_KeeperCottage';

  const wall = addMesh(
    cottage,
    new THREE.BoxGeometry(1.08, 0.62, 0.78),
    material(PALETTE.coral),
    [0, 0.31, 0],
    null,
    'LighthouseIsland_CottageWalls'
  );
  wall.receiveShadow = true;

  addMesh(
    cottage,
    new THREE.BoxGeometry(0.88, 0.08, 0.96),
    material(PALETTE.turquoise),
    [-0.34, 0.73, 0],
    [0, 0, 0.18],
    'LighthouseIsland_CottageRoofTurquoise'
  );
  addMesh(
    cottage,
    new THREE.BoxGeometry(0.88, 0.08, 0.96),
    material(PALETTE.coral),
    [0.34, 0.73, 0],
    [0, 0, -0.18],
    'LighthouseIsland_CottageRoofCoral'
  );
  addMesh(
    cottage,
    new THREE.BoxGeometry(0.12, 0.08, 0.94),
    material(PALETTE.cream),
    [0, 0.82, 0],
    null,
    'LighthouseIsland_CottageRidge'
  );

  addMesh(
    cottage,
    new THREE.CylinderGeometry(0.12, 0.12, 1.04, 10, 1, false, 0, Math.PI),
    material(PALETTE.cream),
    [0, 0.56, 0.53],
    [0, 0, Math.PI / 2],
    'LighthouseIsland_CottageAwning'
  );
  addMesh(
    cottage,
    new THREE.BoxGeometry(0.27, 0.42, 0.06),
    material(PALETTE.timber),
    [0, 0.23, 0.41],
    null,
    'LighthouseIsland_CottageDoor'
  );
  addMesh(
    cottage,
    new THREE.BoxGeometry(0.2, 0.2, 0.035),
    material(PALETTE.turquoiseDark),
    [-0.32, 0.38, 0.395],
    null,
    'LighthouseIsland_CottageWindowLeft'
  );
  addMesh(
    cottage,
    new THREE.BoxGeometry(0.2, 0.2, 0.035),
    material(PALETTE.turquoiseDark),
    [0.32, 0.38, 0.395],
    null,
    'LighthouseIsland_CottageWindowRight'
  );
  addMesh(
    cottage,
    new THREE.BoxGeometry(0.2, 0.48, 0.2),
    material(PALETTE.coralDark),
    [0.3, 0.83, -0.2],
    null,
    'LighthouseIsland_CottageChimney'
  );

  cottage.position.set(0.57, 0.21, 0.28);
  cottage.rotation.y = -0.12;
  parent.add(cottage);
  return cottage;
}

function addTower(parent) {
  const tower = new THREE.Group();
  tower.name = 'LighthouseIsland_Tower';

  addMesh(
    tower,
    new THREE.CylinderGeometry(0.62, 0.72, 0.22, 12),
    material(PALETTE.plaster),
    [0, 0.11, 0],
    null,
    'LighthouseIsland_TowerPlinth'
  );

  const stripeMaterials = [
    material(PALETTE.plaster),
    material(PALETTE.coral)
  ];
  const bandHeights = [0.34, 0.32, 0.3, 0.28, 0.26];
  let height = 0.21;
  for (let index = 0; index < bandHeights.length; index += 1) {
    const bandHeight = bandHeights[index];
    const bottomRadius = 0.48 - index * 0.035;
    const topRadius = 0.445 - index * 0.035;
    addMesh(
      tower,
      new THREE.CylinderGeometry(topRadius, bottomRadius, bandHeight + 0.025, 14),
      stripeMaterials[index % 2],
      [0, height + bandHeight * 0.5, 0],
      null,
      'LighthouseIsland_TowerBand_' + index
    );
    height += bandHeight;
  }

  addMesh(
    tower,
    new THREE.BoxGeometry(0.18, 0.32, 0.055),
    material(PALETTE.timberDark),
    [0, 0.46, 0.455],
    null,
    'LighthouseIsland_TowerDoor'
  );
  addMesh(
    tower,
    new THREE.BoxGeometry(0.22, 0.035, 0.075),
    material(PALETTE.cream),
    [0, 0.63, 0.455],
    null,
    'LighthouseIsland_TowerDoorLintel'
  );

  const galleryY = height + 0.08;
  addMesh(
    tower,
    new THREE.CylinderGeometry(0.49, 0.49, 0.1, 12),
    material(PALETTE.plaster),
    [0, galleryY, 0],
    null,
    'LighthouseIsland_GallerySlab'
  );
  addMesh(
    tower,
    new THREE.TorusGeometry(0.42, 0.018, 6, 20),
    material(PALETTE.metal),
    [0, galleryY + 0.21, 0],
    [Math.PI / 2, 0, 0],
    'LighthouseIsland_GalleryRailTop'
  );
  const railMaterial = material(PALETTE.metal);
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    addMesh(
      tower,
      new THREE.CylinderGeometry(0.014, 0.018, 0.28, 6),
      railMaterial,
      [Math.cos(angle) * 0.42, galleryY + 0.1, Math.sin(angle) * 0.42],
      null,
      'LighthouseIsland_GalleryPost_' + index
    );
  }

  addMesh(
    tower,
    new THREE.CylinderGeometry(0.29, 0.31, 0.3, 12),
    material(0xb7d8da, {
      transparent: true,
      opacity: 0.84,
      roughness: 0.25,
      metalness: 0.04
    }),
    [0, galleryY + 0.22, 0],
    null,
    'LighthouseIsland_LanternRoom'
  );
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    addMesh(
      tower,
      new THREE.BoxGeometry(0.022, 0.29, 0.022),
      railMaterial,
      [Math.cos(angle) * 0.28, galleryY + 0.22, Math.sin(angle) * 0.28],
      null,
      'LighthouseIsland_LanternMullion_' + index
    );
  }

  addMesh(
    tower,
    new THREE.ConeGeometry(0.39, 0.4, 12),
    material(PALETTE.coralDark),
    [0, galleryY + 0.56, 0],
    null,
    'LighthouseIsland_Roof'
  );
  addMesh(
    tower,
    new THREE.CylinderGeometry(0.022, 0.026, 0.36, 6),
    material(PALETTE.metal),
    [0, galleryY + 0.94, 0],
    null,
    'LighthouseIsland_Finial'
  );
  addMesh(
    tower,
    new THREE.BoxGeometry(0.64, 0.025, 0.025),
    material(PALETTE.metal),
    [0, galleryY + 1.04, 0],
    null,
    'LighthouseIsland_WeatherVaneRod'
  );
  addMesh(
    tower,
    new THREE.ConeGeometry(0.075, 0.21, 4),
    material(PALETTE.cream),
    [0.35, galleryY + 1.04, 0],
    [0, 0, -Math.PI / 2],
    'LighthouseIsland_WeatherVaneTip'
  );

  const lantern = tower.getObjectByName('LighthouseIsland_LanternRoom');
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
      new THREE.ConeGeometry(0.12, 0.98, 12, 1, true),
      beamMaterial
    );
    beam.rotation.z = direction * Math.PI / 2;
    beam.position.x = direction * 0.5;
    beamGroup.add(beam);
  });
  beamGroup.position.y = galleryY + 0.22;
  tower.add(beamGroup);

  const beaconLight = new THREE.PointLight(0xffd684, 0, 3.8, 2);
  beaconLight.position.y = galleryY + 0.22;
  tower.add(beaconLight);

  tower.position.set(-0.48, 0.22, -0.38);
  parent.add(tower);

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

export function createLighthouseIslandModel() {
  const root = new THREE.Group();
  root.name = 'LighthouseIsland';
  root.userData.modelSource = 'procedural-code-from-reference';

  const sandShape = organicShape(1.74, 1.28, 81, 0.06);
  const grassShape = organicShape(1.48, 1.02, 96, 0.075);
  const islandBase = new THREE.Mesh(
    new THREE.ExtrudeGeometry(sandShape, {
      depth: 0.18,
      bevelEnabled: true,
      bevelSize: 0.03,
      bevelThickness: 0.03,
      bevelSegments: 1,
      curveSegments: 2
    }),
    material(PALETTE.sand)
  );
  islandBase.name = 'LighthouseIsland_SandBase';
  islandBase.rotation.x = -Math.PI / 2;
  islandBase.position.y = 0.02;
  islandBase.castShadow = true;
  islandBase.receiveShadow = true;
  root.add(islandBase);

  const grass = new THREE.Mesh(
    new THREE.ShapeGeometry(grassShape, 1),
    material(PALETTE.grass)
  );
  grass.name = 'LighthouseIsland_GrassTerrace';
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0.08, 0.225, -0.02);
  grass.receiveShadow = true;
  root.add(grass);

  const upperGrass = new THREE.Mesh(
    new THREE.ShapeGeometry(organicShape(0.82, 0.62, 112, 0.08), 1),
    material(PALETTE.grassLight)
  );
  upperGrass.name = 'LighthouseIsland_TowerTerrace';
  upperGrass.rotation.x = -Math.PI / 2;
  upperGrass.position.set(-0.48, 0.235, -0.38);
  upperGrass.receiveShadow = true;
  root.add(upperGrass);

  [
    [-1.48, 0.38, 0.9, 0.1],
    [-1.25, -0.68, 0.8, 0.4],
    [-0.45, -1.05, 0.75, 0.7],
    [0.7, -0.94, 0.95, 0.5],
    [1.45, -0.45, 0.85, 0.2],
    [1.45, 0.3, 0.72, -0.3],
    [0.95, 0.86, 0.65, -0.5],
    [-0.72, 0.92, 0.7, -0.1]
  ].forEach(function (item) {
    addCliff(root, item[0], item[1], item[2], item[3]);
  });

  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(0.56, 1.35),
    material(PALETTE.cream, { side: THREE.DoubleSide })
  );
  path.name = 'LighthouseIsland_GardenPath';
  path.rotation.x = -Math.PI / 2;
  path.rotation.z = -0.08;
  path.position.set(0.42, 0.239, 0.63);
  path.receiveShadow = true;
  root.add(path);

  const tower = addTower(root);
  addCottage(root);
  addDock(root);
  const boat = addBoat(root);

  addTree(root, 0.78, -0.55, 0.72, 'light');
  addTree(root, 1.18, -0.32, 0.56, 'double');
  addTree(root, -1.08, -0.64, 0.58, 'dark');
  addTree(root, 1.18, 0.18, 0.78, 'light');
  addTree(root, -1.24, 0.06, 0.48, 'double');

  const flagPole = new THREE.Group();
  flagPole.name = 'LighthouseIsland_Flag';
  addMesh(
    flagPole,
    new THREE.CylinderGeometry(0.012, 0.016, 0.82, 6),
    material(PALETTE.metal),
    [0, 0.41, 0],
    null,
    'LighthouseIsland_FlagPole'
  );
  addMesh(
    flagPole,
    new THREE.PlaneGeometry(0.34, 0.19, 1, 1),
    material(PALETTE.coral, { side: THREE.DoubleSide }),
    [0.17, 0.68, 0],
    null,
    'LighthouseIsland_FlagCloth'
  );
  flagPole.position.set(-1.05, 0.26, -0.28);
  root.add(flagPole);

  const markerAnchor = new THREE.Object3D();
  markerAnchor.name = 'LighthouseIsland_MarkerAnchor';
  markerAnchor.position.set(0, 1.35, -0.1);
  root.add(markerAnchor);

  root.userData.parts = {
    tower: tower.group,
    cottage: root.getObjectByName('LighthouseIsland_KeeperCottage'),
    dock: root.getObjectByName('LighthouseIsland_Dock'),
    boat: boat,
    flag: flagPole
  };

  return Object.assign({ root: root, markerAnchor: markerAnchor }, tower);
}
