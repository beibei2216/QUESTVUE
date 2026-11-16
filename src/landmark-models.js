import * as THREE from 'three';

const CANVAS_FONT_FAMILY = '"Howdy Party", "Microsoft YaHei", sans-serif';

const PALETTE = {
  stone: 0xb8b5a8,
  stoneLight: 0xd9d5c8,
  stoneDark: 0x8a8d82,
  water: 0x65cbd9,
  waterDeep: 0x2f94ad,
  waterMist: 0xc9f1f2,
  snow: 0xf4f0df,
  moss: 0x79b94c,
  mossDark: 0x4f8d42,
  cliff: 0x8b8e84,
  cliffDark: 0x666d66,
  cave: 0x152d2d,
  timber: 0xbd8450,
  timberLight: 0xd5a46b,
  timberDark: 0x725036,
  harborWall: 0x88b6c4,
  harborWhite: 0xe9f0eb,
  harborRoof: 0x36536f,
  harborTrim: 0xf0e9d8,
  window: 0xffd786,
  red: 0xc94e3f,
  coral: 0xe77758,
  orange: 0xe89b47,
  teal: 0x409bad,
  yellow: 0xe0b94f,
  cream: 0xf1e3c4,
  gull: 0xf7f4e9,
  beak: 0xe59840
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

function addMesh(parent, geometry, meshMaterial, position, rotation, name, shadow) {
  const mesh = new THREE.Mesh(geometry, meshMaterial);
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.name = name;
  mesh.castShadow = shadow !== false;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
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

function addCylinder(parent, top, bottom, height, segments, meshMaterial, position, name, shadow) {
  return addMesh(
    parent,
    new THREE.CylinderGeometry(top, bottom, height, segments),
    meshMaterial,
    position,
    null,
    name,
    shadow
  );
}

function addGableRoof(parent, width, depth, rise, baseY, roofMaterial, wallMaterial, name) {
  const roof = new THREE.Group();
  roof.name = name;
  const halfWidth = width * 0.5;
  const angle = Math.atan2(rise, halfWidth);
  const panelLength = Math.sqrt(halfWidth * halfWidth + rise * rise);
  addBox(
    roof,
    [panelLength + 0.07, 0.055, depth + 0.12],
    roofMaterial,
    [-halfWidth * 0.5, baseY + rise * 0.5, 0],
    [0, 0, angle],
    name + '_PanelLeft'
  );
  addBox(
    roof,
    [panelLength + 0.07, 0.055, depth + 0.12],
    roofMaterial,
    [halfWidth * 0.5, baseY + rise * 0.5, 0],
    [0, 0, -angle],
    name + '_PanelRight'
  );
  [-1, 1].forEach(function (side) {
    const shape = new THREE.Shape();
    shape.moveTo(-halfWidth, 0);
    shape.lineTo(halfWidth, 0);
    shape.lineTo(0, rise);
    shape.closePath();
    addMesh(
      roof,
      new THREE.ShapeGeometry(shape, 1),
      wallMaterial,
      [0, baseY, side * depth * 0.5],
      null,
      name + '_Gable_' + side
    );
  });
  parent.add(roof);
  return roof;
}

function createSignTexture(title, subtitle, background, foreground) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(255,255,255,.55)';
  context.lineWidth = 8;
  context.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
  context.fillStyle = foreground;
  context.textAlign = 'center';
  context.font = '700 54px ' + CANVAS_FONT_FAMILY;
  context.fillText(title, canvas.width / 2, 82);
  context.font = '700 24px ' + CANVAS_FONT_FAMILY;
  context.fillText(subtitle, canvas.width / 2, 124);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

function addBird(parent, x, y, z, scale) {
  const bird = new THREE.Group();
  bird.name = 'HarborLandmark_Seagull';
  const body = addMesh(
    bird,
    new THREE.SphereGeometry(0.1, 8, 6),
    material(PALETTE.gull),
    [0, 0.08, 0],
    null,
    'HarborLandmark_SeagullBody'
  );
  body.scale.set(1.15, 0.72, 1.7);
  addMesh(
    bird,
    new THREE.SphereGeometry(0.07, 8, 6),
    material(PALETTE.gull),
    [0, 0.16, 0.09],
    null,
    'HarborLandmark_SeagullHead'
  );
  addMesh(
    bird,
    new THREE.ConeGeometry(0.026, 0.09, 5),
    material(PALETTE.beak),
    [0, 0.16, 0.18],
    [Math.PI / 2, 0, 0],
    'HarborLandmark_SeagullBeak'
  );
  [-1, 1].forEach(function (side) {
    const wing = addMesh(
      bird,
      new THREE.ConeGeometry(0.07, 0.25, 4),
      material(PALETTE.stoneLight),
      [side * 0.1, 0.1, -0.01],
      [0, 0, side * 1.08],
      'HarborLandmark_SeagullWing'
    );
    wing.scale.z = 0.45;
  });
  bird.position.set(x, y, z);
  bird.scale.setScalar(scale || 1);
  bird.userData.baseY = y;
  parent.add(bird);
  return bird;
}

function createFountainLandmark() {
  const root = new THREE.Group();
  root.name = 'StarFountainLandmark';
  const stone = material(PALETTE.stone);
  const stoneLight = material(PALETTE.stoneLight);
  const waterMaterial = material(PALETTE.waterDeep, {
    transparent: true,
    opacity: 0.78,
    roughness: 0.24,
    metalness: 0
  });
  const sprayMaterial = new THREE.MeshBasicMaterial({
    color: 0x9eeaf2,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  addCylinder(root, 1.24, 1.36, 0.13, 8, stone, [0, 0.065, 0], 'Fountain_BaseStepLower');
  addCylinder(root, 1.04, 1.18, 0.16, 8, stoneLight, [0, 0.205, 0], 'Fountain_BaseStepUpper');
  addMesh(
    root,
    new THREE.CylinderGeometry(0.94, 1.0, 0.26, 8, 1, true),
    stone,
    [0, 0.405, 0],
    null,
    'Fountain_OctagonalBasinWall'
  );
  const rim = addMesh(
    root,
    new THREE.RingGeometry(0.78, 1.01, 8),
    stoneLight,
    [0, 0.54, 0],
    [-Math.PI / 2, 0, Math.PI / 8],
    'Fountain_OctagonalRim'
  );
  rim.receiveShadow = true;
  const pool = addMesh(
    root,
    new THREE.CircleGeometry(0.77, 32),
    waterMaterial,
    [0, 0.515, 0],
    [-Math.PI / 2, 0, 0],
    'Fountain_PoolSurface'
  );
  pool.castShadow = false;

  const centerBase = addBox(
    root,
    [0.56, 0.37, 0.56],
    stoneLight,
    [0, 0.71, 0],
    null,
    'Fountain_CentralBlockLower'
  );
  centerBase.castShadow = true;
  addBox(root, [0.62, 0.08, 0.62], stone, [0, 0.93, 0], null, 'Fountain_CentralCoping');
  const upper = addBox(
    root,
    [0.5, 0.27, 0.5],
    stoneLight,
    [0, 1.1, 0],
    null,
    'Fountain_CentralBlockUpper'
  );
  upper.castShadow = true;
  addCylinder(root, 0.1, 0.12, 0.18, 8, stone, [0, 1.33, 0], 'Fountain_NozzleBase');
  addCylinder(root, 0.065, 0.085, 0.16, 8, material(PALETTE.stoneDark), [0, 1.49, 0], 'Fountain_Nozzle');

  const curtains = [];
  for (let side = 0; side < 4; side += 1) {
    const sideGroup = new THREE.Group();
    sideGroup.name = 'Fountain_Spout_' + side;
    sideGroup.rotation.y = side * Math.PI * 0.5;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.18, 1.05, 0.25),
      new THREE.Vector3(0.31, 0.94, 0.31),
      new THREE.Vector3(0.43, 0.7, 0.37),
      new THREE.Vector3(0.5, 0.53, 0.43)
    ]);
    const curtain = addMesh(
      sideGroup,
      new THREE.TubeGeometry(curve, 18, 0.038, 5, false),
      material(PALETTE.water, {
        transparent: true,
        opacity: 0.66,
        roughness: 0.16
      }),
      [0, 0, 0],
      null,
      'Fountain_SpoutCurtain'
    );
    curtain.castShadow = false;
    curtains.push(curtain);
    root.add(sideGroup);
  }

  const spray = addMesh(
    root,
    new THREE.CylinderGeometry(0.53, 0.1, 0.96, 20, 1, true),
    sprayMaterial,
    [0, 1.72, 0],
    null,
    'Fountain_CentralMist'
  );
  spray.castShadow = false;
  addMesh(
    root,
    new THREE.CylinderGeometry(0.2, 0.065, 0.7, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xcff8f7,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide
    }),
    [0, 1.55, 0],
    null,
    'Fountain_CentralJet',
    false
  );
  addMesh(
    root,
    new THREE.TorusGeometry(0.45, 0.028, 5, 24),
    new THREE.MeshBasicMaterial({
      color: 0xd7fbf8,
      transparent: true,
      opacity: 0.28,
      depthWrite: false
    }),
    [0, 2.2, 0],
    [Math.PI / 2, 0, 0],
    'Fountain_SprayCrown',
    false
  );

  const droplets = new THREE.Group();
  droplets.name = 'Fountain_SprayDroplets';
  const dropMaterial = material(PALETTE.waterMist, {
    transparent: true,
    opacity: 0.76,
    roughness: 0.12
  });
  for (let index = 0; index < 26; index += 1) {
    const angle = (index / 26) * Math.PI * 2;
    const radius = 0.25 + (index % 5) * 0.055;
    addMesh(
      droplets,
      new THREE.IcosahedronGeometry(0.018 + (index % 3) * 0.006, 0),
      dropMaterial,
      [Math.cos(angle) * radius, 1.9 + (index % 6) * 0.018, Math.sin(angle) * radius * 0.72],
      null,
      'Fountain_Droplet_' + index,
      false
    );
  }
  root.add(droplets);

  const star = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.12, 0),
    material(0xf4c85a, {
      emissive: new THREE.Color(0x9d6e1e),
      emissiveIntensity: 0.25
    })
  );
  star.name = 'Fountain_WishStar';
  star.position.set(0, 0.53, 0.18);
  star.scale.y = 0.35;
  root.add(star);

  root.userData.animation = {
    spray: spray,
    droplets: droplets,
    pool: pool,
    star: star
  };
  return root;
}

function createHarborBoat(parent) {
  const boat = new THREE.Group();
  boat.name = 'HarborLandmark_Boat';
  const hull = addBox(
    boat,
    [0.72, 0.18, 0.36],
    material(PALETTE.harborWhite),
    [0, 0.11, 0],
    null,
    'HarborLandmark_BoatHull'
  );
  hull.scale.x = 1.1;
  addBox(
    boat,
    [0.64, 0.055, 0.38],
    material(PALETTE.red),
    [0, 0.04, 0],
    null,
    'HarborLandmark_BoatStripe'
  );
  addBox(
    boat,
    [0.28, 0.28, 0.3],
    material(PALETTE.harborWhite),
    [-0.18, 0.25, 0],
    null,
    'HarborLandmark_BoatCabin'
  );
  addBox(
    boat,
    [0.31, 0.07, 0.32],
    material(PALETTE.harborRoof),
    [-0.18, 0.42, 0],
    null,
    'HarborLandmark_BoatCabinRoof'
  );
  addMesh(
    boat,
    new THREE.TorusGeometry(0.065, 0.018, 5, 16),
    material(PALETTE.coral),
    [-0.18, 0.27, 0.16],
    [0, 0, 0],
    'HarborLandmark_BoatLifebuoy'
  );
  boat.position.set(-0.2, 0.12, 1.0);
  boat.rotation.y = -0.18;
  boat.userData.baseY = 0.12;
  parent.add(boat);
  return boat;
}

function createHarborLandmark() {
  const root = new THREE.Group();
  root.name = 'SeagullHarborLandmark';

  const deck = new THREE.Group();
  deck.name = 'HarborLandmark_Pier';
  const plankMaterial = material(PALETTE.timber);
  for (let index = 0; index < 18; index += 1) {
    addBox(
      deck,
      [0.1, 0.06, 1.45],
      plankMaterial,
      [-1.02 + index * 0.12, 0.045, 0],
      [0, 0.012 * Math.sin(index * 1.8), 0],
      'HarborLandmark_PierPlank_' + index
    );
  }
  [-0.98, -0.5, 0.5, 0.98].forEach(function (x, index) {
    [-0.62, 0.62].forEach(function (z, side) {
      addCylinder(
        deck,
        [0.045, 0.055],
        0.34,
        6,
        material(PALETTE.timberDark),
        [x, -0.08, z],
        'HarborLandmark_PierPost_' + index + '_' + side
      );
    });
  });
  root.add(deck);

  const main = new THREE.Group();
  main.name = 'HarborLandmark_Shop';
  addBox(
    main,
    [1.22, 0.76, 0.92],
    material(PALETTE.harborWall),
    [0, 0.44, -0.06],
    null,
    'HarborLandmark_ShopWalls'
  );
  for (let index = 0; index < 5; index += 1) {
    addBox(
      main,
      [1.24, 0.018, 0.018],
      material(PALETTE.harborTrim),
      [0, 0.17 + index * 0.13, 0.405],
      null,
      'HarborLandmark_Siding_' + index,
      false
    );
  }
  addGableRoof(
    main,
    1.42,
    1.08,
    0.38,
    0.83,
    material(PALETTE.harborRoof),
    material(PALETTE.harborWhite),
    'HarborLandmark_MainRoof'
  );
  addBox(
    main,
    [1.12, 0.53, 0.08],
    material(PALETTE.harborWhite),
    [0, 0.36, 0.48],
    null,
    'HarborLandmark_ShopOpening'
  );
  addBox(
    main,
    [0.98, 0.23, 0.07],
    material(PALETTE.window, {
      emissive: new THREE.Color(0xa96422),
      emissiveIntensity: 0.22
    }),
    [0, 0.34, 0.526],
    null,
    'HarborLandmark_ShopWindow'
  );
  addBox(
    main,
    [1.12, 0.055, 0.37],
    material(PALETTE.harborRoof),
    [0, 0.63, 0.58],
    [0.16, 0, 0],
    'HarborLandmark_Awning'
  );
  for (let index = 0; index < 7; index += 1) {
    addBox(
      main,
      [0.075, 0.065, 0.39],
      material(index % 2 ? PALETTE.harborTrim : PALETTE.harborRoof),
      [-0.45 + index * 0.15, 0.638, 0.581],
      [0.16, 0, 0],
      'HarborLandmark_AwningStripe_' + index,
      false
    );
  }

  const sign = addMesh(
    main,
    new THREE.PlaneGeometry(0.92, 0.245),
    new THREE.MeshStandardMaterial({
      map: createSignTexture('CHUM & BREWS', 'SEASIDE SNACKS', '#f0eadb', '#31536b'),
      roughness: 0.95
    }),
    [0, 0.83, 0.486],
    null,
    'HarborLandmark_MainSign',
    false
  );
  sign.castShadow = false;

  const cupola = new THREE.Group();
  cupola.name = 'HarborLandmark_Cupola';
  addBox(cupola, [0.39, 0.38, 0.39], material(PALETTE.harborWhite), [0, 1.28, -0.06], null, 'HarborLandmark_CupolaWalls');
  addMesh(
    cupola,
    new THREE.CircleGeometry(0.11, 16),
    material(PALETTE.window, {
      emissive: new THREE.Color(0xb1772f),
      emissiveIntensity: 0.3
    }),
    [0, 1.3, 0.14],
    null,
    'HarborLandmark_CupolaWindow',
    false
  );
  addGableRoof(
    cupola,
    0.5,
    0.48,
    0.18,
    1.48,
    material(PALETTE.harborRoof),
    material(PALETTE.harborWhite),
    'HarborLandmark_CupolaRoof'
  );
  main.add(cupola);

  const annex = new THREE.Group();
  annex.name = 'HarborLandmark_Annex';
  addBox(
    annex,
    [0.78, 0.5, 0.72],
    material(PALETTE.harborWall),
    [0, 0.31, 0],
    null,
    'HarborLandmark_AnnexWalls'
  );
  addGableRoof(
    annex,
    0.92,
    0.82,
    0.28,
    0.57,
    material(PALETTE.harborRoof),
    material(PALETTE.harborWhite),
    'HarborLandmark_AnnexRoof'
  );
  addBox(
    annex,
    [0.25, 0.28, 0.035],
    material(PALETTE.window, {
      emissive: new THREE.Color(0xa96422),
      emissiveIntensity: 0.24
    }),
    [0.2, 0.34, 0.374],
    null,
    'HarborLandmark_AnnexWindow'
  );
  annex.position.set(0.86, 0.02, 0.17);
  main.add(annex);

  const mast = new THREE.Group();
  mast.name = 'HarborLandmark_FlagMast';
  addCylinder(mast, [0.018, 0.025], 1.18, 6, material(PALETTE.harborWhite), [0, 0.63, 0], 'HarborLandmark_FlagPole');
  [
    [0.18, PALETTE.red],
    [0.46, 0xefc45b],
    [0.74, PALETTE.teal]
  ].forEach(function (item, index) {
    addBox(
      mast,
      [0.31, 0.12, 0.012],
      material(item[1], { side: THREE.DoubleSide }),
      [0.16, item[0], 0],
      [0, 0, -0.08],
      'HarborLandmark_Flag_' + index,
      false
    );
  });
  mast.position.set(0.82, 0.58, -0.2);
  main.add(mast);

  const surfboard = addMesh(
    main,
    new THREE.SphereGeometry(0.25, 12, 8),
    material(PALETTE.orange),
    [0.99, 0.34, 0.48],
    [0.08, 0, -0.15],
    'HarborLandmark_Surfboard'
  );
  surfboard.scale.set(0.42, 2.15, 0.18);
  addBox(
    main,
    [0.06, 0.62, 0.022],
    material(PALETTE.cream),
    [1.01, 0.42, 0.5],
    [0.08, 0, -0.15],
    'HarborLandmark_SurfboardStripe'
  );

  addMesh(
    main,
    new THREE.TorusGeometry(0.1, 0.024, 5, 18),
    material(PALETTE.coral),
    [1.16, 0.52, 0.16],
    [0, Math.PI / 2, 0],
    'HarborLandmark_Lifebuoy'
  );

  root.add(main);

  const buoyTower = new THREE.Group();
  buoyTower.name = 'HarborLandmark_BuoyTower';
  addCylinder(buoyTower, 0.2, 0.26, 0.17, 10, material(PALETTE.red), [0, 0.1, 0], 'HarborLandmark_BuoyBase');
  addCylinder(buoyTower, 0.18, 0.22, 0.18, 10, material(PALETTE.cream), [0, 0.27, 0], 'HarborLandmark_BuoyBand');
  addCylinder(buoyTower, 0.13, 0.17, 0.18, 10, material(PALETTE.red), [0, 0.44, 0], 'HarborLandmark_BuoyTop');
  addMesh(
    buoyTower,
    new THREE.ConeGeometry(0.1, 0.14, 8),
    material(PALETTE.red),
    [0, 0.58, 0],
    null,
    'HarborLandmark_BuoyCap'
  );
  buoyTower.position.set(-1.12, 0.06, 0.05);
  root.add(buoyTower);

  const birds = [
    addBird(root, -1.12, 0.7, 0.05, 0.85),
    addBird(root, 0.92, 0.54, 0.47, 0.72),
    addBird(root, -0.7, 0.16, 0.55, 0.48)
  ];

  addBox(
    root,
    [0.38, 0.28, 0.34],
    material(PALETTE.cream),
    [0.58, 0.2, 0.58],
    [0, 0.08, 0],
    'HarborLandmark_Crate'
  );
  const crateTrim = material(PALETTE.timberDark);
  addBox(root, [0.39, 0.025, 0.02], crateTrim, [0.58, 0.2, 0.755], null, 'HarborLandmark_CrateBandA');
  addBox(root, [0.025, 0.29, 0.36], crateTrim, [0.58, 0.2, 0.58], null, 'HarborLandmark_CrateBandB');

  const rope = new THREE.Group();
  rope.name = 'HarborLandmark_BuoyString';
  const ropePoints = [
    new THREE.Vector3(-0.9, 1.0, 0.1),
    new THREE.Vector3(-0.2, 0.92, 0.05),
    new THREE.Vector3(0.5, 0.98, -0.08)
  ];
  addMesh(
    rope,
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ropePoints), 18, 0.012, 5, false),
    material(PALETTE.timberDark),
    [0, 0, 0],
    null,
    'HarborLandmark_BuoyRope'
  );
  for (let index = 0; index < 8; index += 1) {
    const t = index / 7;
    const curve = new THREE.CatmullRomCurve3(ropePoints);
    const point = curve.getPoint(t);
    addMesh(
      rope,
      new THREE.SphereGeometry(0.045, 8, 6),
      material(index % 2 ? PALETTE.orange : PALETTE.cream),
      [point.x, point.y, point.z],
      null,
      'HarborLandmark_BuoyOrb_' + index
    );
  }
  root.add(rope);

  const boat = createHarborBoat(root);
  addBox(
    root,
    [0.34, 0.22, 0.3],
    material(PALETTE.harborWhite),
    [-0.74, 0.16, 0.3],
    null,
    'HarborLandmark_Cooler'
  );
  addBox(
    root,
    [0.36, 0.04, 0.32],
    material(PALETTE.harborRoof),
    [-0.74, 0.29, 0.3],
    null,
    'HarborLandmark_CoolerLid'
  );

  root.position.set(-3.12, 0.247, 0.95);
  root.rotation.y = 0.08;
  root.userData.animation = {
    birds: birds,
    boat: boat,
    flags: mast.children.filter(function (child) {
      return typeof child.name === 'string' && child.name.indexOf('Flag_') >= 0;
    })
  };
  return root;
}

function createWaterRibbon(points, width, y, color, name, parent) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(function (point) {
      return new THREE.Vector3(point[0], y, point[1]);
    })
  );
  const samples = curve.getPoints(36);
  const positions = [];
  const indices = [];
  for (let index = 0; index < samples.length; index += 1) {
    const point = samples[index];
    const before = samples[Math.max(0, index - 1)];
    const after = samples[Math.min(samples.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const length = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = (-dz / length) * width * 0.5;
    const nz = (dx / length) * width * 0.5;
    positions.push(point.x + nx, y, point.z + nz);
    positions.push(point.x - nx, y, point.z - nz);
    if (index < samples.length - 1) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return addMesh(
    parent,
    geometry,
    material(color, { transparent: true, opacity: 0.82, roughness: 0.24, side: THREE.DoubleSide }),
    [0, 0, 0],
    null,
    name,
    false
  );
}

function addPine(parent, x, z, scale, color) {
  const pine = new THREE.Group();
  pine.name = 'MountainSpring_Pine';
  addCylinder(pine, [0.035 * scale, 0.055 * scale], 0.3 * scale, 6, material(PALETTE.timberDark), [0, 0.15 * scale, 0], 'MountainSpring_PineTrunk');
  for (let index = 0; index < 3; index += 1) {
    addMesh(
      pine,
      new THREE.ConeGeometry((0.25 - index * 0.05) * scale, (0.34 - index * 0.04) * scale, 7),
      material(color || PALETTE.mossDark),
      [0, (0.36 + index * 0.17) * scale, 0],
      [0, index * 0.4, 0],
      'MountainSpring_PineCanopy_' + index
    );
  }
  pine.position.set(x, 0.245, z);
  parent.add(pine);
  return pine;
}

function createMountainSpringLandmark() {
  const root = new THREE.Group();
  root.name = 'MountainSpringLandmark';

  const rock = material(PALETTE.cliff);
  const rockDark = material(PALETTE.cliffDark);
  const moss = material(PALETTE.moss);
  const mountain = new THREE.Group();
  mountain.name = 'MountainSpring_RockMass';

  [
    [0, 0.34, -0.1, 1.2, 0.54, 1.08, 0],
    [-0.72, 0.28, 0.06, 0.96, 0.48, 0.9, 0.32],
    [0.7, 0.27, 0.03, 0.9, 0.46, 0.86, -0.24]
  ].forEach(function (item, index) {
    const foot = addMesh(
      mountain,
      new THREE.DodecahedronGeometry(0.62, 0),
      index === 1 ? rockDark : rock,
      [item[0], item[1], item[2]],
      [0.12 * index, item[6], -0.08 * index],
      'MountainSpring_FootRock_' + index
    );
    foot.scale.set(item[3], item[4], item[5]);
  });

  const core = addMesh(
    mountain,
    new THREE.DodecahedronGeometry(0.95, 1),
    rock,
    [0, 1.05, -0.15],
    [0.08, 0.15, -0.04],
    'MountainSpring_Core'
  );
  core.scale.set(1.0, 1.35, 0.82);

  [
    [-0.83, 0.56, 0.08, 1.22, 0.7],
    [0.78, 0.62, 0.04, 1.18, 0.72],
    [-0.62, 1.1, 0.18, 1.0, 0.58],
    [0.62, 1.18, 0.12, 0.96, 0.6],
    [-0.95, 1.15, -0.18, 1.1, 0.52],
    [0.92, 1.05, -0.26, 1.0, 0.55]
  ].forEach(function (item, index) {
    const boulder = addMesh(
      mountain,
      new THREE.DodecahedronGeometry(0.48, 0),
      index % 2 ? rock : rockDark,
      [item[0], item[1], item[2]],
      [0.18 * index, 0.42 * index, 0.09 * index],
      'MountainSpring_Boulder_' + index
    );
    boulder.scale.set(item[3], item[4], 0.88);
  });

  addMesh(
    mountain,
    new THREE.ConeGeometry(0.5, 0.48, 7),
    material(PALETTE.snow),
    [0, 2.15, -0.14],
    [0.05, 0.2, 0],
    'MountainSpring_SnowCap'
  );
  [
    [-0.33, 1.9, 0.03, 0.26],
    [0.24, 1.96, -0.02, 0.3],
    [0.05, 2.18, -0.05, 0.2]
  ].forEach(function (item, index) {
    const snow = addMesh(
      mountain,
      new THREE.DodecahedronGeometry(item[3], 1),
      material(PALETTE.snow),
      [item[0], item[1], item[2]],
      [0.2 * index, 0.5 * index, 0],
      'MountainSpring_SnowPatch_' + index
    );
    snow.scale.y = 0.55;
  });

  const cave = addMesh(
    mountain,
    new THREE.SphereGeometry(0.38, 12, 8),
    material(PALETTE.cave),
    [0, 0.93, 0.56],
    null,
    'MountainSpring_CaveMouth'
  );
  cave.scale.set(0.72, 1.05, 0.22);
  addMesh(
    mountain,
    new THREE.DodecahedronGeometry(0.35, 0),
    rockDark,
    [-0.46, 0.81, 0.43],
    [0.2, 0.42, 0.15],
    'MountainSpring_CaveRockLeft'
  ).scale.set(0.75, 1.2, 0.8);
  addMesh(
    mountain,
    new THREE.DodecahedronGeometry(0.35, 0),
    rock,
    [0.44, 0.83, 0.43],
    [-0.12, -0.34, -0.08],
    'MountainSpring_CaveRockRight'
  ).scale.set(0.74, 1.16, 0.82);

  [
    [-0.58, 1.6, 0.16, 0.46, 0.34],
    [0.58, 1.53, 0.1, 0.42, 0.38],
    [-0.82, 0.9, 0.22, 0.42, 0.28],
    [0.72, 0.91, 0.18, 0.38, 0.26]
  ].forEach(function (item, index) {
    const patch = addMesh(
      mountain,
      new THREE.IcosahedronGeometry(item[3], 1),
      moss,
      [item[0], item[1], item[2]],
      [0.1 * index, 0.3 * index, 0],
      'MountainSpring_MossLedge_' + index
    );
    patch.scale.set(1.2, 0.26, item[4] * 1.2);
  });

  const waterfall = addMesh(
    mountain,
    new THREE.PlaneGeometry(0.28, 0.96, 1, 8),
    material(PALETTE.water, {
      transparent: true,
      opacity: 0.86,
      roughness: 0.16,
      side: THREE.DoubleSide
    }),
    [0, 0.63, 0.74],
    [-0.08, 0, 0],
    'MountainSpring_Waterfall'
  );
  waterfall.castShadow = false;

  addMesh(
    mountain,
    new THREE.CylinderGeometry(0.2, 0.29, 0.24, 12),
    material(PALETTE.water, { transparent: true, opacity: 0.84, roughness: 0.18 }),
    [0, 0.35, 0.82],
    null,
    'MountainSpring_SplashPool',
    false
  );

  const stream = createWaterRibbon(
    [
      [0, 0.88],
      [-0.16, 1.1],
      [-0.3, 1.32],
      [-0.45, 1.52]
    ],
    0.18,
    0.3,
    PALETTE.water,
    'MountainSpring_Stream',
    mountain
  );
  stream.castShadow = false;
  const lowerPool = addMesh(
    mountain,
    new THREE.CircleGeometry(0.46, 28),
    material(PALETTE.waterDeep, {
      transparent: true,
      opacity: 0.85,
      roughness: 0.2
    }),
    [-0.55, 0.305, 1.58],
    [-Math.PI / 2, 0, 0],
    'MountainSpring_LowerPool',
    false
  );
  lowerPool.scale.z = 0.7;

  const spray = new THREE.Group();
  spray.name = 'MountainSpring_Spray';
  const sprayMaterial = material(PALETTE.waterMist, {
    transparent: true,
    opacity: 0.78,
    roughness: 0.12
  });
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2;
    addMesh(
      spray,
      new THREE.IcosahedronGeometry(0.022 + (index % 3) * 0.006, 0),
      sprayMaterial,
      [Math.cos(angle) * (0.16 + (index % 4) * 0.025), 0.36 + (index % 3) * 0.05, 0.82 + Math.sin(angle) * 0.12],
      null,
      'MountainSpring_SprayDrop_' + index,
      false
    );
  }
  mountain.add(spray);

  addPine(mountain, 0.88, 0.52, 0.75, PALETTE.mossDark);
  addPine(mountain, 1.02, 0.15, 0.58, PALETTE.moss);
  addPine(mountain, -0.9, 0.72, 0.62, PALETTE.mossDark);

  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    const stone = addMesh(
      mountain,
      new THREE.DodecahedronGeometry(0.1 + (index % 3) * 0.025, 0),
      index % 2 ? rock : rockDark,
      [Math.cos(angle) * 0.58 - 0.42, 0.31, 1.56 + Math.sin(angle) * 0.38],
      [0, angle, 0],
      'MountainSpring_PondRock_' + index
    );
    stone.scale.y = 0.55;
  }

  root.add(mountain);
  root.position.set(-0.18, 0.25, -2.15);
  root.rotation.y = -0.12;
  root.userData.animation = {
    waterfall: waterfall,
    spray: spray,
    pool: lowerPool,
    stream: stream
  };
  return root;
}

export {
  createFountainLandmark,
  createHarborLandmark,
  createMountainSpringLandmark
};
