import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('.');
const specPath = resolve(root, '.img2threejs-lighthouse/object-sculpt-spec.json');
const assessmentPath = resolve(root, '.img2threejs-lighthouse/assessment.json');
const inventoryPath = resolve(root, '.img2threejs-lighthouse/detail-inventory.json');
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const assessment = JSON.parse(readFileSync(assessmentPath, 'utf8'));
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')).detailInventory;

const rgba = (hex, alpha = 1) => {
  const value = hex.replace('#', '');
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${alpha})`;
};

const materials = [
  ['meadow', 'Faceted meadow grass', '#69B548', '#4D9537', 'plastic'],
  ['sand', 'Warm island sand', '#E8D8A8', '#D5BF83', 'stone'],
  ['chalk', 'White chalk cliff', '#E4E9DF', '#CCD7C8', 'stone'],
  ['plaster', 'Warm white lighthouse plaster', '#F1EBDD', '#DAD2C2', 'ceramic'],
  ['coral-paint', 'Coral red painted bands', '#D95643', '#B94236', 'plastic'],
  ['roof-paint', 'Coral red roof paint', '#C94D3C', '#A93D32', 'plastic'],
  ['turquoise-paint', 'Muted turquoise roof panel', '#69B9C4', '#4D9AA8', 'plastic'],
  ['dark-metal', 'Graphite railing and fixtures', '#4D4B42', '#31342F', 'metal'],
  ['timber', 'Warm timber decking', '#B98A57', '#88623E', 'wood'],
  ['boat-cream', 'Cream boat hull', '#F1E7D1', '#D5C6AA', 'wood'],
  ['foliage', 'Low-poly leaf canopies', '#4FAF51', '#2C7D43', 'plastic']
].map(([id, name, color, secondary, materialClass], materialIndex) => ({
  id,
  name,
  type: 'standard',
  shaderModel: 'MeshStandardMaterial / PBR approximation',
  baseColor: color,
  color,
  albedo: {
    dominant: rgba(color),
    secondary: [rgba(secondary)],
    samplingNotes: 'Palette approximated from the flat-shaded reference; lighting and contact shadows remain separate.'
  },
  colorVariation: {
    palette: [rgba(color), rgba(secondary)],
    pattern: 'faceted low-poly tonal breakup',
    amplitude: materialClass === 'metal' ? 0.08 : 0.05,
    heightCorrelation: 0.1
  },
  roughness: {
    base: materialClass === 'metal' ? 0.42 : materialClass === 'ceramic' ? 0.78 : 0.88,
    variation: materialClass === 'metal' ? 0.1 : 0.06,
    localResponse: 'Matte painted and natural surfaces; subtle roughness breakup follows facet normals.'
  },
  metalness: {
    base: materialClass === 'metal' ? 0.38 : 0,
    variation: materialClass === 'metal' ? 0.08 : 0
  },
  ambientOcclusion: {
    cavityStrength: 0.24,
    contactShadowBias: 0.38,
    notes: 'Occlusion concentrated below eaves, beneath decking and where tower sections overlap.'
  },
  localOverrides: id === 'plaster'
    ? [
        {
          id: 'tower-bands',
          region: 'alternating tower bands',
          color: rgba('#D95643'),
          roughness: 0.82,
          evidenceRef: 'detail-inventory/zone-r1c1.png'
        }
      ]
    : id === 'timber'
      ? [
          {
            id: 'dock-wear',
            region: 'walked centerline of dock planks',
            roughness: 0.76,
            color: rgba('#C69A66'),
            evidenceRef: 'detail-inventory/zone-r2c1.png'
          }
        ]
      : id === 'foliage'
        ? [
            {
              id: 'leaf-facets',
              region: 'outer canopy facets',
              color: rgba('#78C85C'),
              roughness: 0.9,
              evidenceRef: 'detail-inventory/zone-r1c2.png'
            }
          ]
        : [],
  textureless: {
    declared: true,
    evidence: [
      'The reference is a flat-shaded low-poly diorama with no visible pores, grain maps or printed decals.',
      'Identity is carried by silhouette, component boundaries and solid color regions rather than surface microtexture.',
      `Material ${materialIndex + 1} is represented as procedural geometry with solid PBR albedo.`
    ]
  },
  notes: 'Intentional stylized low-poly material; no photographic texture projection is used.'
}));

const feature = (id, description) => ({ id, type: 'geometry', description, confidence: 0.9 });
const action = (role, material, collider) => ({
  animationRole: role,
  pivot: { mode: 'center', localPosition: [0, 0, 0], axis: [0, 1, 0], confidence: 0.75 },
  transformChannels: {
    translate: true,
    rotate: role === 'root' || role === 'beacon',
    scale: true,
    bend: false,
    twist: false,
    detach: false,
    visibility: true,
    materialState: true
  },
  sockets: [],
  collider: {
    type: collider || 'box',
    offset: [0, 0, 0],
    scale: [1, 1, 1],
    isTrigger: false,
    notes: 'Simplified runtime proxy; visual geometry remains separate.'
  },
  constraints: [],
  destruction: {
    breakable: false,
    fractureGroup: role,
    seamRefs: [],
    detachableFragments: [],
    breakImpulse: 0,
    debrisMaterial: material
  }
});

const recipe = (dominant, secondary, materialClass) => ({
  dominantAlbedo: rgba(dominant),
  secondaryAlbedo: rgba(secondary),
  materialClass,
  materialClassConfidence: 0.94
});

const components = [];
const parentState = new Map();

function addComponent(options) {
  const parent = options.parent || null;
  const material = options.material;
  const primitive = options.primitive || 'box';
  const requiresAttachment = Boolean(parent);
  const component = {
    id: options.id,
    name: options.name,
    level: options.level,
    role: options.role || 'static-part',
    importance: options.importance || (options.level === 'macro' ? 0.95 : 0.75),
    confidence: 0.9,
    primitive,
    topologyClass: 'assembled-solid',
    topologyRationale:
      'Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.',
    geometryDescriptor: {
      topologyIntent: 'game-ready low-poly architectural assembly',
      edgeTreatment: {
        type: primitive === 'sphere' || primitive === 'ellipsoid' ? 'none' : 'chamfer',
        bevelRadius: 0.015,
        segments: 1
      },
      deformationStack: [],
      uvStrategy: 'generated procedural coordinates',
      normalStrategy: 'flat-shaded vertex normals from generated geometry',
      segments: options.segments || 12
    },
    parent,
    attachment: requiresAttachment
      ? {
          parentId: parent,
          parentSocket: options.socket || `${parent}-surface`,
          localStart: [0, 0, 0],
          localEnd: [0, Math.max(0.05, options.dimensions[1] || 0.1), 0],
          contactNormal: [0, 1, 0],
          contactType: 'overlap',
          overlap: 0.035,
          gapTolerance: 0.006,
          evidenceRefs: ['front-3q', 'top-view']
        }
      : null,
    dimensions: {
      width: options.dimensions[0],
      height: options.dimensions[1],
      depth: options.dimensions[2],
      units: 'relative',
      confidence: 0.88
    },
    transform: {
      position: options.position || [0, 0, 0],
      rotation: options.rotation || [0, 0, 0],
      scale: [1, 1, 1]
    },
    actionProfile: action(options.role || 'static-part', material, options.collider),
    material,
    materialLayers: [material],
    deformations: [],
    joints: [],
    seams: [],
    localFeatures: (options.features || []).map((item) => feature(item[0], item[1])),
    colorMaterialRecipe: recipe(
      options.color || '#E8D8A8',
      options.secondary || '#C8B171',
      options.materialClass || 'stone'
    ),
    surfaceDetail: {
      macroRoughness: 0.12,
      microRoughness: 0.05,
      bumpAmplitude: 0,
      normalPattern: 'faceted procedural normals',
      displacementPattern: 'none',
      occlusionPattern: 'contact cavities beneath overlaps',
      edgeWearPattern: 'none',
      notes: 'Textureless faceted low-poly treatment.'
    },
    evidenceRefs: ['front-3q', 'top-view'],
    details: [],
    fidelityTier: options.level
  };
  components.push(component);
  parentState.set(component.id, component);
  return component;
}

addComponent({
  id: 'root',
  name: 'Lighthouse Island Assembly',
  level: 'macro',
  role: 'root',
  primitive: 'cylinder',
  dimensions: [3.8, 0.42, 2.7],
  segments: 18,
  material: 'meadow',
  color: '#69B548',
  secondary: '#4D9537',
  materialClass: 'plastic',
  features: [
    ['island-shore', 'Angular stepped shoreline combining grass, sand and pale cliff ledges.']
  ],
  collider: 'cylinder'
});
addComponent({
  id: 'cliff-skirt',
  name: 'Chalk Cliff Skirt',
  level: 'macro',
  parent: 'root',
  primitive: 'ellipsoid',
  position: [0, 0.03, 0],
  dimensions: [3.7, 0.34, 2.65],
  material: 'chalk',
  color: '#E4E9DF',
  secondary: '#CCD7C8',
  materialClass: 'stone'
});
addComponent({
  id: 'sand-ledge',
  name: 'Sand Ledge',
  level: 'macro',
  parent: 'root',
  primitive: 'cylinder',
  position: [0, 0.22, 0],
  dimensions: [3.4, 0.12, 2.35],
  segments: 18,
  material: 'sand',
  color: '#E8D8A8',
  secondary: '#D5BF83',
  materialClass: 'stone'
});
addComponent({
  id: 'tower-assembly',
  name: 'Lighthouse Platform',
  level: 'macro',
  parent: 'root',
  primitive: 'cylinder',
  position: [-0.55, 0.42, -0.35],
  dimensions: [1.55, 0.22, 1.55],
  segments: 16,
  material: 'plaster',
  color: '#F1EBDD',
  secondary: '#DAD2C2',
  materialClass: 'ceramic',
  features: [
    ['gallery-railing', 'Dark radial posts and top rail surrounding the lighthouse platform.'],
    ['tower-painted-bands', 'Five alternating coral and warm-white tapered tower bands.']
  ]
});
addComponent({
  id: 'cottage-assembly',
  name: 'Keeper Cottage',
  level: 'macro',
  parent: 'root',
  primitive: 'box',
  position: [0.78, 0.55, 0.28],
  dimensions: [1.5, 0.72, 1.08],
  material: 'coral-paint',
  color: '#D9876E',
  secondary: '#F1D4B8',
  materialClass: 'plastic',
  features: [
    ['cottage-roof', 'Shallow gabled roof split between coral and turquoise panels.'],
    ['cottage-awning', 'Cream roller awning projecting over the cottage entrance.'],
    ['cottage-chimney', 'Square masonry chimney behind the roof ridge.']
  ]
});

const towerBands = [
  ['tower-white-base', 'white', 0.48, 0.5, 0.47],
  ['tower-coral-base', 'coral', 0.76, 0.47, 0.44],
  ['tower-white-mid', 'white', 1.04, 0.44, 0.41],
  ['tower-coral-mid', 'coral', 1.32, 0.41, 0.38],
  ['tower-white-top', 'white', 1.60, 0.38, 0.34]
];
towerBands.forEach(([id, tone, y, radiusBottom, radiusTop]) => {
  const coral = tone === 'coral';
  addComponent({
    id,
    name: coral ? 'Coral Tower Band' : 'White Tower Band',
    level: 'meso',
    parent: 'tower-assembly',
    primitive: 'cylinder',
    position: [0, y, 0],
    dimensions: [radiusBottom * 2, 0.3, radiusBottom * 2],
    segments: 16,
    material: coral ? 'coral-paint' : 'plaster',
    color: coral ? '#D95643' : '#F1EBDD',
    secondary: coral ? '#B94236' : '#DAD2C2',
    materialClass: coral ? 'plastic' : 'ceramic',
    features: coral ? [] : id === 'tower-white-base' ? [['tower-door', 'Dark inset door on the lower white band.']] : []
  });
});

addComponent({
  id: 'gallery-slab',
  name: 'Gallery Slab',
  level: 'meso',
  parent: 'tower-assembly',
  primitive: 'cylinder',
  position: [0, 1.85, 0],
  dimensions: [0.9, 0.11, 0.9],
  segments: 16,
  material: 'plaster',
  color: '#F1EBDD',
  secondary: '#DAD2C2',
  materialClass: 'ceramic'
});
addComponent({
  id: 'gallery-post',
  name: 'Gallery Railing Post',
  level: 'micro',
  parent: 'tower-assembly',
  primitive: 'cylinder',
  position: [0.36, 2.0, 0],
  dimensions: [0.035, 0.26, 0.035],
  segments: 6,
  material: 'dark-metal',
  color: '#4D4B42',
  secondary: '#31342F',
  materialClass: 'metal'
});
addComponent({
  id: 'lantern-room',
  name: 'Lantern Room',
  level: 'meso',
  parent: 'tower-assembly',
  primitive: 'cylinder',
  position: [0, 2.01, 0],
  dimensions: [0.62, 0.32, 0.62],
  segments: 12,
  material: 'plaster',
  color: '#B7DDE0',
  secondary: '#8CBFCA',
  materialClass: 'glass'
});
addComponent({
  id: 'roof',
  name: 'Red Lighthouse Roof',
  level: 'meso',
  parent: 'tower-assembly',
  primitive: 'cone',
  position: [0, 2.27, 0],
  dimensions: [0.78, 0.42, 0.78],
  segments: 12,
  material: 'roof-paint',
  color: '#C94D3C',
  secondary: '#A93D32',
  materialClass: 'plastic',
  features: [['roof-finial', 'Short dark spindle and weather-vane cross above the conical roof.']]
});
addComponent({
  id: 'finial',
  name: 'Roof Finial',
  level: 'micro',
  parent: 'roof',
  primitive: 'cylinder',
  position: [0, 0.3, 0],
  dimensions: [0.045, 0.26, 0.045],
  segments: 6,
  material: 'dark-metal',
  color: '#4D4B42',
  secondary: '#31342F',
  materialClass: 'metal',
  features: [['weather-vane', 'Orthogonal directional arrow and colored vane tips.']]
});
addComponent({
  id: 'weather-vane-rod',
  name: 'Weather Vane Rod',
  level: 'micro',
  parent: 'finial',
  primitive: 'box',
  position: [0, 0.16, 0],
  dimensions: [0.68, 0.035, 0.035],
  material: 'dark-metal',
  color: '#4D4B42',
  secondary: '#31342F',
  materialClass: 'metal'
});
addComponent({
  id: 'weather-vane-arrow',
  name: 'Weather Vane Arrow',
  level: 'micro',
  parent: 'finial',
  primitive: 'box',
  position: [0, 0.19, 0],
  dimensions: [0.035, 0.035, 0.52],
  material: 'coral-paint',
  color: '#D95643',
  secondary: '#B94236',
  materialClass: 'plastic'
});

addComponent({
  id: 'cottage-roof-turquoise',
  name: 'Turquoise Cottage Roof',
  level: 'meso',
  parent: 'cottage-assembly',
  primitive: 'box',
  position: [-0.3, 0.48, 0],
  rotation: [0, 0, 0.16],
  dimensions: [0.86, 0.12, 1.24],
  material: 'turquoise-paint',
  color: '#69B9C4',
  secondary: '#4D9AA8',
  materialClass: 'plastic'
});
addComponent({
  id: 'cottage-roof-coral',
  name: 'Coral Cottage Roof',
  level: 'meso',
  parent: 'cottage-assembly',
  primitive: 'box',
  position: [0.3, 0.48, 0],
  rotation: [0, 0, -0.16],
  dimensions: [0.86, 0.12, 1.24],
  material: 'coral-paint',
  color: '#D9876E',
  secondary: '#F1D4B8',
  materialClass: 'plastic'
});
addComponent({
  id: 'cottage-awning',
  name: 'Cream Roller Awning',
  level: 'meso',
  parent: 'cottage-assembly',
  primitive: 'cylinder',
  position: [0, 0.18, 0.62],
  rotation: [0, 0, Math.PI / 2],
  dimensions: [0.34, 1.12, 0.34],
  segments: 10,
  material: 'plaster',
  color: '#F1EBDD',
  secondary: '#DAD2C2',
  materialClass: 'fabric'
});
addComponent({
  id: 'cottage-chimney',
  name: 'Masonry Chimney',
  level: 'meso',
  parent: 'cottage-assembly',
  primitive: 'box',
  position: [0.32, 0.7, -0.18],
  dimensions: [0.22, 0.48, 0.22],
  material: 'coral-paint',
  color: '#D95643',
  secondary: '#B94236',
  materialClass: 'stone'
});
addComponent({
  id: 'cottage-door',
  name: 'Cottage Door',
  level: 'micro',
  parent: 'cottage-assembly',
  primitive: 'box',
  position: [0, -0.15, 0.56],
  dimensions: [0.28, 0.42, 0.055],
  material: 'timber',
  color: '#8C6846',
  secondary: '#6A4D34',
  materialClass: 'wood'
});

addComponent({
  id: 'dock-walkway',
  name: 'Timber Dock Walkway',
  level: 'macro',
  parent: 'root',
  primitive: 'box',
  position: [0.05, 0.25, 1.08],
  dimensions: [0.88, 0.12, 1.3],
  material: 'timber',
  color: '#B98A57',
  secondary: '#88623E',
  materialClass: 'wood',
  features: [['dock-planks', 'Closely spaced light timber planks supported on dark piles.']]
});
addComponent({
  id: 'dock-post-left',
  name: 'Dock Post Left',
  level: 'micro',
  parent: 'dock-walkway',
  primitive: 'cylinder',
  position: [-0.38, -0.12, 0.38],
  dimensions: [0.075, 0.35, 0.075],
  segments: 6,
  material: 'timber',
  color: '#7D5C3C',
  secondary: '#5F462F',
  materialClass: 'wood'
});
addComponent({
  id: 'dock-post-right',
  name: 'Dock Post Right',
  level: 'micro',
  parent: 'dock-walkway',
  primitive: 'cylinder',
  position: [0.38, -0.12, 0.38],
  dimensions: [0.075, 0.35, 0.075],
  segments: 6,
  material: 'timber',
  color: '#7D5C3C',
  secondary: '#5F462F',
  materialClass: 'wood'
});
addComponent({
  id: 'boat-hull',
  name: 'Cream Rowboat Hull',
  level: 'meso',
  parent: 'root',
  primitive: 'box',
  position: [-0.95, 0.28, 1.28],
  dimensions: [0.96, 0.18, 0.36],
  material: 'boat-cream',
  color: '#F1E7D1',
  secondary: '#D5C6AA',
  materialClass: 'wood',
  features: [['boat-ribs', 'Coral interior ribs and a thin turquoise painted waterline.']]
});
addComponent({
  id: 'boat-bow',
  name: 'Boat Bow',
  level: 'micro',
  parent: 'boat-hull',
  primitive: 'cone',
  position: [0.58, 0, 0],
  rotation: [0, 0, -Math.PI / 2],
  dimensions: [0.36, 0.5, 0.36],
  segments: 6,
  material: 'boat-cream',
  color: '#F1E7D1',
  secondary: '#D5C6AA',
  materialClass: 'wood'
});
addComponent({
  id: 'boat-seat',
  name: 'Boat Seat',
  level: 'micro',
  parent: 'boat-hull',
  primitive: 'box',
  position: [-0.08, 0.1, 0],
  dimensions: [0.14, 0.06, 0.34],
  material: 'coral-paint',
  color: '#D95643',
  secondary: '#B94236',
  materialClass: 'wood'
});

addComponent({
  id: 'cliff-west',
  name: 'West Chalk Cliff',
  level: 'meso',
  parent: 'root',
  primitive: 'ellipsoid',
  position: [-1.24, 0.18, 0.3],
  dimensions: [0.72, 0.72, 0.9],
  material: 'chalk',
  color: '#E4E9DF',
  secondary: '#CCD7C8',
  materialClass: 'stone'
});
addComponent({
  id: 'cliff-east',
  name: 'East Chalk Cliff',
  level: 'meso',
  parent: 'root',
  primitive: 'ellipsoid',
  position: [1.28, 0.14, 0.14],
  dimensions: [0.64, 0.58, 0.74],
  material: 'chalk',
  color: '#E4E9DF',
  secondary: '#CCD7C8',
  materialClass: 'stone'
});
addComponent({
  id: 'tree-canopy',
  name: 'Faceted Tree Canopy',
  level: 'meso',
  parent: 'root',
  primitive: 'ellipsoid',
  position: [0.62, 1.02, -0.52],
  dimensions: [0.52, 0.54, 0.52],
  material: 'foliage',
  color: '#4FAF51',
  secondary: '#2C7D43',
  materialClass: 'plastic',
  features: [['tree-clusters', 'Irregular low-poly tree crowns placed around cottage and tower terrace.']]
});
addComponent({
  id: 'tree-trunk',
  name: 'Tree Trunk',
  level: 'micro',
  parent: 'tree-canopy',
  primitive: 'cylinder',
  position: [0, -0.35, 0],
  dimensions: [0.09, 0.55, 0.09],
  segments: 6,
  material: 'timber',
  color: '#6E543A',
  secondary: '#4E3928',
  materialClass: 'wood'
});

const featureDefinitions = [
  ['lighthouse-silhouette', 'Tapered lighthouse tower and roof silhouette', 'critical', ['blockout', 'structural-pass'], ['root', 'tower-assembly', 'roof']],
  ['painted-band-sequence', 'Alternating red-white tower band sequence', 'critical', ['material-pass', 'form-refinement'], ['tower-coral-base', 'tower-white-mid', 'tower-coral-mid', 'tower-white-top']],
  ['gallery-and-lantern', 'Gallery railing, lantern room and red cap', 'critical', ['structural-pass', 'form-refinement'], ['gallery-slab', 'gallery-post', 'lantern-room', 'roof', 'finial']],
  ['cottage-waterfront', 'Cottage, split roof, awning, chimney, dock and boat relationship', 'critical', ['structural-pass', 'interaction-pass'], ['cottage-assembly', 'cottage-roof-turquoise', 'cottage-roof-coral', 'dock-walkway', 'boat-hull']],
  ['island-shoreline', 'Stepped grass, sand and chalk shoreline silhouette', 'important', ['form-refinement', 'surface-pass'], ['root', 'cliff-skirt', 'cliff-west', 'cliff-east']],
  ['faceted-vegetation', 'Faceted tree crown clusters and trunks', 'important', ['form-refinement', 'surface-pass'], ['tree-canopy', 'tree-trunk']]
].map(([id, name, tier, passIds, componentRefs]) => ({
  id,
  name,
  tier,
  passIds,
  minimumScore: tier === 'critical' ? 0.8 : 0.68,
  mustPass: tier === 'critical',
  componentRefs,
  evidenceRefs: ['front-3q', 'top-view']
}));

const qualityGroups = [
  {
    id: 'lighthouse-silhouette',
    name: 'Tapered striped lighthouse silhouette',
    required: true,
    qualityCriteria: [
      'Base platform, five tapered color bands, gallery, lantern and cone roof retain the reference vertical rhythm.',
      'Tower remains clearly taller than the cottage and tree canopy in both review views.'
    ],
    evidenceRefs: ['front-3q', 'top-view'],
    failureModes: ['straight untapered cylinder replaces the tower', 'gallery or roof silhouette is missing']
  },
  {
    id: 'waterfront-composition',
    name: 'Cottage, dock and boat composition',
    required: true,
    qualityCriteria: [
      'Cottage sits on the inland terrace with a split roof and visible cream awning.',
      'Dock reaches from the shoreline into water and the boat sits clear of all dock geometry.'
    ],
    evidenceRefs: ['front-3q', 'top-view'],
    failureModes: ['boat intersects dock or island', 'cottage roof reads as a single flat slab']
  },
  {
    id: 'island-terracing',
    name: 'Layered low-poly island base',
    required: true,
    qualityCriteria: [
      'Grass, sand and pale cliff ledges create a stepped silhouette around the buildings.',
      'All architectural bases make contact with the vegetated terrace.'
    ],
    evidenceRefs: ['front-3q', 'top-view'],
    failureModes: ['floating architecture', 'single flat green disc with no shoreline depth']
  },
  {
    id: 'flat-material-system',
    name: 'Intentional flat-shaded material system',
    required: true,
    qualityCriteria: [
      'Coral, turquoise, cream, chalk, timber and foliage colors remain distinct under neutral light.',
      'Faceted normals provide form readability without photographic textures.'
    ],
    evidenceRefs: ['front-3q'],
    failureModes: ['washed-out material roles', 'texture projection conflicts with low-poly style']
  }
];

spec.targetName = 'Azure Isle Lighthouse Island';
spec.sourceImage = resolve(root, '.img2threejs-lighthouse/reference-front.png');
spec.suitability = 'conditional';
spec.scores = {
  object_isolation: 2,
  silhouette_readability: 3,
  depth_inference: 2,
  primitive_decomposition: 3,
  material_procedurality: 3,
  occlusion_risk: 2,
  interaction_fit: 2
};
spec.preSpecAssessment = assessment.preSpecAssessment;
spec.preSpecAssessment.objectClass = {
  primaryType: 'stylized low-poly lighthouse island architectural diorama',
  primaryDomain: 'object',
  formLanguage: ['architectural', 'low-poly', 'hard-surface', 'botanical', 'sculptural'],
  structureKind: ['compound object', 'branching hierarchy', 'repeated modules', 'layered shell'],
  motionPotential: ['static prop', 'whole-object transform', 'articulated beacon'],
  materialFamilies: ['plaster', 'painted wood', 'stone', 'metal', 'foliage', 'fabric'],
  notes: 'A reference-matched low-poly reconstruction; hidden rear details are inferred from the second top view.'
};
spec.preSpecAssessment.complexity = {
  tier: 'complex',
  scores: {
    silhouetteComplexity: 3,
    componentCount: 3,
    hierarchyDepth: 2,
    repetitionDensity: 2,
    materialLayerCount: 3,
    localDetailDensity: 2,
    occlusionRisk: 2,
    actionReadinessNeed: 1
  },
  estimatedCounts: {
    macroComponents: 5,
    mesoComponents: 15,
    microFeatureGroups: 11,
    materialLayers: materials.length,
    repetitionSystems: 2
  },
  reasoning: [
    'The scene has a tall tapered tower, a keeper cottage, a dock, a boat and layered terrain.',
    'Repeated tower bands, railing posts, dock planks and faceted foliage form multiple local systems.',
    'A second top-down view resolves most hidden footprint and attachment relationships.'
  ]
};
spec.preSpecAssessment.specDepthDecision = {
  requiredDepth: 'complex',
  minimumComponentLevels: ['macro', 'meso', 'micro'],
  needsRepetitionSystems: true,
  needsMaterialLocalOverrides: true,
  needsMultipleReviewViews: true,
  needsActionReadyHierarchy: true,
  rationale: 'The island reads as a compound architectural diorama and cannot be represented by a single tower primitive.'
};
spec.preSpecAssessment.unknownsToResolveBeforeImplementation = [];
spec.preSpecAssessment.detailInventory = inventory;

spec.qualityContract = {
  qualityBar: 'complex',
  definitionOfDone: [
    'The lighthouse island reads as the reference diorama at first glance, led by the tapered striped tower silhouette.',
    'Tower platform, gallery, lantern, roof, keeper cottage, dock, boat and terrain remain separately addressable parts.',
    'All attached parts visibly contact their parents and the boat remains clear of the dock.',
    'The flat-shaded color roles and faceted surface language remain consistent with the existing game.',
    'The model holds from the reference three-quarter angle and a top-down structural check.'
  ],
  minimumSpecDepth: {
    macroComponents: 3,
    mesoComponents: 8,
    microFeatureGroups: 10,
    materialLayers: 8,
    repetitionSystems: 2,
    reviewViewpoints: 4
  },
  featureGroups: qualityGroups,
  visualDeltaChecks: [
    'Compare tower height-to-base ratio and taper angle against the reference.',
    'Compare tower stripes, cottage roof split and dock silhouette in the same camera framing.',
    'Verify no floating foundation, boat-dock intersection or tree-water intersection.',
    'Verify the island holds from top view and three-quarter view.'
  ],
  antiShallowSpecRules: spec.qualityContract.antiShallowSpecRules || [],
  mustNotDo: [
    'Do not collapse the lighthouse island into a single mesh.',
    'Do not replace the tower with a straight cylinder.',
    'Do not use photographic texture projection.',
    'Do not place the boat through the dock or terrain.',
    'Do not conceal missing shoreline geometry with a flat green disc.'
  ]
};
spec.featureReviewTargets = featureDefinitions;
spec.qualityTargets.reviewViewpoints = ['front-3q', 'top-view', 'left', 'right'];
spec.qualityTargets.targetFidelity = 0.78;
spec.lookDevTargets.qualityPriority = 'stylized-code-native';
spec.proceduralStrategy = [
  'Block out island, tower, cottage and dock first.',
  'Add tapered striped tower sections and layered architecture.',
  'Add dock, boat, cliffs, trees and railings with stable pivots.',
  'Use flat-shaded solid materials and controlled tonal variation.',
  'Verify three-quarter and top views in the existing game camera.'
];
spec.assumptions = [
  'Rear tower doorway and hidden stair geometry are inferred because the reference does not expose them.',
  'The second top-down image is used as structural evidence, not as a second lighting reference.'
];
spec.risks = [
  'Single-image front view does not reveal the complete rear facade.',
  'Distant small details are represented by simplified low-poly proxies.'
];
spec.silhouette = {
  boundingShape: 'Asymmetric oval island with a tall tapered tower mass at the rear-left and a lower cottage mass at the center-right.',
  aspectRatios: [1.42, 0.58],
  symmetry: 'asymmetric',
  dominantCurves: ['tapered tower silhouette', 'round gallery and lantern', 'conical roof', 'organic island rim'],
  negativeSpaces: ['space beneath dock', 'gap between tower and cottage', 'open water beside boat'],
  landmarks: ['red-white band sequence', 'dark gallery ring', 'red cone cap', 'cream awning', 'split-color cottage roof']
};
spec.viewEvidence = [
  {
    id: 'front-3q',
    view: 'three-quarter-front',
    imageRegion: { x: 0.12, y: 0.03, width: 0.76, height: 0.92, units: 'normalized' },
    observations: [
      'Tower rises behind a round platform and dominates the silhouette.',
      'Keeper cottage sits below the tower with a cream barrel awning.',
      'Timber dock leads toward the lower front edge; a cream boat floats at its left.'
    ],
    confidence: 0.96
  },
  {
    id: 'top-view',
    view: 'top',
    imageRegion: { x: 0.16, y: 0.08, width: 0.68, height: 0.82, units: 'normalized' },
    observations: [
      'The island footprint is an irregular rounded mass wider than deep.',
      'Tower platform sits rear-left and the cottage occupies the central-right terrace.',
      'Dock projects from the lower shoreline and the boat sits clear of its piles.'
    ],
    confidence: 0.93
  }
];
spec.coordinateFrame = {
  front: 'positive Z faces the viewer',
  up: 'positive Y',
  scaleReference: 'island width approximately 3.8 world units in the current map'
};
spec.componentTree = components;
spec.materials = materials;
spec.repetitionSystems = [
  {
    id: 'gallery-railing-posts',
    kind: 'radial-array',
    count: 10,
    pitch: '36 degrees',
    axis: '+Y',
    target: 'gallery-post',
    realization: 'Place gallery posts radially around the gallery slab and join them with a narrow dark top rail.',
    evidence: ['front-3q'],
    confidence: 0.92,
    buildsGeometry: true,
    instances: 10
  },
  {
    id: 'dock-plank-repetition',
    kind: 'linear-array',
    count: 8,
    pitch: 0.13,
    axis: '+Z',
    target: 'dock-walkway',
    realization: 'Keep the main deck solid and add shallow plank seam strips along its walking direction.',
    evidence: ['front-3q', 'top-view'],
    confidence: 0.86,
    buildsGeometry: true,
    instances: 8
  }
];
spec.lightingFromPhoto = [
  {
    role: 'key',
    direction: 'upper-left to lower-right',
    color: 'warm white',
    intensity: 1.1,
    observation: 'Facets facing upper-left are brighter and cast short grounded shadows.'
  },
  {
    role: 'fill',
    direction: 'camera-right',
    color: 'cool sky teal',
    intensity: 0.28,
    observation: 'Shadow sides keep readable cool values without crushing.'
  },
  {
    role: 'environment',
    toneMapping: 'ACES-like neutral tone mapping',
    exposure: '0.85-0.95',
    contactShadow: 'Soft ambient contact shadow beneath island base and dock piles.',
    background: 'Muted olive-green tabletop environment'
  }
];
spec.performanceBudget.targetTriangles = 24000;
spec.performanceBudget.maxDrawCalls = 80;
spec.performanceBudget.textureSize = 0;
spec.performanceBudget.fpsTarget = 60;
spec.buildPasses.forEach((pass) => {
  pass.componentRefs = components.map((component) => component.id);
});

writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
writeFileSync(
  assessmentPath,
  JSON.stringify(
    {
      ...assessment,
      preSpecAssessment: spec.preSpecAssessment,
      qualityContract: spec.qualityContract
    },
    null,
    2
  ) + '\n'
);

process.stdout.write('Authored lighthouse spec with ' + components.length + ' components.\n');
