import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Azure Isle Lighthouse Island
// Sculpt build pass: material-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createAzureIsleLighthouseIslandModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Azure Isle Lighthouse Island";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40, "aspect": 1, "orientation": {"yaw": 0, "pitch": 0, "roll": 0}, "positionHint": [0, 0, 3], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["meadow"] = createSculptMaterial(
    "meadow",
    {"id": "meadow", "name": "Faceted meadow grass", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#69B548", "color": "#69B548", "albedo": {"dominant": "rgba(105, 181, 72, 1)", "secondary": ["rgba(77, 149, 55, 1)"], "samplingNotes": "Palette approximated from the flat-shaded reference; lighting and contact shadows remain separate."}, "colorVariation": {"palette": ["rgba(105, 181, 72, 1)", "rgba(77, 149, 55, 1)"], "pattern": "faceted low-poly tonal breakup", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.88, "variation": 0.06, "localResponse": "Matte painted and natural surfaces; subtle roughness breakup follows facet normals."}, "metalness": {"base": 0, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.38, "notes": "Occlusion concentrated below eaves, beneath decking and where tower sections overlap."}, "localOverrides": [], "textureless": {"declared": true, "evidence": ["The reference is a flat-shaded low-poly diorama with no visible pores, grain maps or printed decals.", "Identity is carried by silhouette, component boundaries and solid color regions rather than surface microtexture.", "Material 1 is represented as procedural geometry with solid PBR albedo."]}, "notes": "Intentional stylized low-poly material; no photographic texture projection is used."},
    options
  );
  materialMap["sand"] = createSculptMaterial(
    "sand",
    {"id": "sand", "name": "Warm island sand", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#E8D8A8", "color": "#E8D8A8", "albedo": {"dominant": "rgba(232, 216, 168, 1)", "secondary": ["rgba(213, 191, 131, 1)"], "samplingNotes": "Palette approximated from the flat-shaded reference; lighting and contact shadows remain separate."}, "colorVariation": {"palette": ["rgba(232, 216, 168, 1)", "rgba(213, 191, 131, 1)"], "pattern": "faceted low-poly tonal breakup", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.88, "variation": 0.06, "localResponse": "Matte painted and natural surfaces; subtle roughness breakup follows facet normals."}, "metalness": {"base": 0, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.38, "notes": "Occlusion concentrated below eaves, beneath decking and where tower sections overlap."}, "localOverrides": [], "textureless": {"declared": true, "evidence": ["The reference is a flat-shaded low-poly diorama with no visible pores, grain maps or printed decals.", "Identity is carried by silhouette, component boundaries and solid color regions rather than surface microtexture.", "Material 2 is represented as procedural geometry with solid PBR albedo."]}, "notes": "Intentional stylized low-poly material; no photographic texture projection is used."},
    options
  );
  materialMap["chalk"] = createSculptMaterial(
    "chalk",
    {"id": "chalk", "name": "White chalk cliff", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#E4E9DF", "color": "#E4E9DF", "albedo": {"dominant": "rgba(228, 233, 223, 1)", "secondary": ["rgba(204, 215, 200, 1)"], "samplingNotes": "Palette approximated from the flat-shaded reference; lighting and contact shadows remain separate."}, "colorVariation": {"palette": ["rgba(228, 233, 223, 1)", "rgba(204, 215, 200, 1)"], "pattern": "faceted low-poly tonal breakup", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.88, "variation": 0.06, "localResponse": "Matte painted and natural surfaces; subtle roughness breakup follows facet normals."}, "metalness": {"base": 0, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.38, "notes": "Occlusion concentrated below eaves, beneath decking and where tower sections overlap."}, "localOverrides": [], "textureless": {"declared": true, "evidence": ["The reference is a flat-shaded low-poly diorama with no visible pores, grain maps or printed decals.", "Identity is carried by silhouette, component boundaries and solid color regions rather than surface microtexture.", "Material 3 is represented as procedural geometry with solid PBR albedo."]}, "notes": "Intentional stylized low-poly material; no photographic texture projection is used."},
    options
  );
  materialMap["plaster"] = createSculptMaterial(
    "plaster",
    {"id": "plaster", "name": "Warm white lighthouse plaster", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#F1EBDD", "color": "#F1EBDD", "albedo": {"dominant": "rgba(241, 235, 221, 1)", "secondary": ["rgba(218, 210, 194, 1)"], "samplingNotes": "Palette approximated from the flat-shaded reference; lighting and contact shadows remain separate."}, "colorVariation": {"palette": ["rgba(241, 235, 221, 1)", "rgba(218, 210, 194, 1)"], "pattern": "faceted low-poly tonal breakup", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.78, "variation": 0.06, "localResponse": "Matte painted and natural surfaces; subtle roughness breakup follows facet normals."}, "metalness": {"base": 0, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.38, "notes": "Occlusion concentrated below eaves, beneath decking and where tower sections overlap."}, "localOverrides": [{"id": "tower-bands", "region": "alternating tower bands", "color": "rgba(217, 86, 67, 1)", "roughness": 0.82, "evidenceRef": "detail-inventory/zone-r1c1.png"}], "textureless": {"declared": true, "evidence": ["The reference is a flat-shaded low-poly diorama with no visible pores, grain maps or printed decals.", "Identity is carried by silhouette, component boundaries and solid color regions rather than surface microtexture.", "Material 4 is represented as procedural geometry with solid PBR albedo."]}, "notes": "Intentional stylized low-poly material; no photographic texture projection is used."},
    options
  );
  materialMap["coral-paint"] = createSculptMaterial(
    "coral-paint",
    {"id": "coral-paint", "name": "Coral red painted bands", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#D95643", "color": "#D95643", "albedo": {"dominant": "rgba(217, 86, 67, 1)", "secondary": ["rgba(185, 66, 54, 1)"], "samplingNotes": "Palette approximated from the flat-shaded reference; lighting and contact shadows remain separate."}, "colorVariation": {"palette": ["rgba(217, 86, 67, 1)", "rgba(185, 66, 54, 1)"], "pattern": "faceted low-poly tonal breakup", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.88, "variation": 0.06, "localResponse": "Matte painted and natural surfaces; subtle roughness breakup follows facet normals."}, "metalness": {"base": 0, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.38, "notes": "Occlusion concentrated below eaves, beneath decking and where tower sections overlap."}, "localOverrides": [], "textureless": {"declared": true, "evidence": ["The reference is a flat-shaded low-poly diorama with no visible pores, grain maps or printed decals.", "Identity is carried by silhouette, component boundaries and solid color regions rather than surface microtexture.", "Material 5 is represented as procedural geometry with solid PBR albedo."]}, "notes": "Intentional stylized low-poly material; no photographic texture projection is used."},
    options
  );
  materialMap["roof-paint"] = createSculptMaterial(
    "roof-paint",
    {"id": "roof-paint", "name": "Coral red roof paint", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#C94D3C", "color": "#C94D3C", "albedo": {"dominant": "rgba(201, 77, 60, 1)", "secondary": ["rgba(169, 61, 50, 1)"], "samplingNotes": "Palette approximated from the flat-shaded reference; lighting and contact shadows remain separate."}, "colorVariation": {"palette": ["rgba(201, 77, 60, 1)", "rgba(169, 61, 50, 1)"], "pattern": "faceted low-poly tonal breakup", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.88, "variation": 0.06, "localResponse": "Matte painted and natural surfaces; subtle roughness breakup follows facet normals."}, "metalness": {"base": 0, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.38, "notes": "Occlusion concentrated below eaves, beneath decking and where tower sections overlap."}, "localOverrides": [], "textureless": {"declared": true, "evidence": ["The reference is a flat-shaded low-poly diorama with no visible pores, grain maps or printed decals.", "Identity is carried by silhouette, component boundaries and solid color regions rather than surface microtexture.", "Material 6 is represented as procedural geometry with solid PBR albedo."]}, "notes": "Intentional stylized low-poly material; no photographic texture projection is used."},
    options
  );
  materialMap["turquoise-paint"] = createSculptMaterial(
    "turquoise-paint",
    {"id": "turquoise-paint", "name": "Muted turquoise roof panel", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#69B9C4", "color": "#69B9C4", "albedo": {"dominant": "rgba(105, 185, 196, 1)", "secondary": ["rgba(77, 154, 168, 1)"], "samplingNotes": "Palette approximated from the flat-shaded reference; lighting and contact shadows remain separate."}, "colorVariation": {"palette": ["rgba(105, 185, 196, 1)", "rgba(77, 154, 168, 1)"], "pattern": "faceted low-poly tonal breakup", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.88, "variation": 0.06, "localResponse": "Matte painted and natural surfaces; subtle roughness breakup follows facet normals."}, "metalness": {"base": 0, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.38, "notes": "Occlusion concentrated below eaves, beneath decking and where tower sections overlap."}, "localOverrides": [], "textureless": {"declared": true, "evidence": ["The reference is a flat-shaded low-poly diorama with no visible pores, grain maps or printed decals.", "Identity is carried by silhouette, component boundaries and solid color regions rather than surface microtexture.", "Material 7 is represented as procedural geometry with solid PBR albedo."]}, "notes": "Intentional stylized low-poly material; no photographic texture projection is used."},
    options
  );
  materialMap["dark-metal"] = createSculptMaterial(
    "dark-metal",
    {"id": "dark-metal", "name": "Graphite railing and fixtures", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#4D4B42", "color": "#4D4B42", "albedo": {"dominant": "rgba(77, 75, 66, 1)", "secondary": ["rgba(49, 52, 47, 1)"], "samplingNotes": "Palette approximated from the flat-shaded reference; lighting and contact shadows remain separate."}, "colorVariation": {"palette": ["rgba(77, 75, 66, 1)", "rgba(49, 52, 47, 1)"], "pattern": "faceted low-poly tonal breakup", "amplitude": 0.08, "heightCorrelation": 0.1}, "roughness": {"base": 0.42, "variation": 0.1, "localResponse": "Matte painted and natural surfaces; subtle roughness breakup follows facet normals."}, "metalness": {"base": 0.38, "variation": 0.08}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.38, "notes": "Occlusion concentrated below eaves, beneath decking and where tower sections overlap."}, "localOverrides": [], "textureless": {"declared": true, "evidence": ["The reference is a flat-shaded low-poly diorama with no visible pores, grain maps or printed decals.", "Identity is carried by silhouette, component boundaries and solid color regions rather than surface microtexture.", "Material 8 is represented as procedural geometry with solid PBR albedo."]}, "notes": "Intentional stylized low-poly material; no photographic texture projection is used."},
    options
  );
  materialMap["timber"] = createSculptMaterial(
    "timber",
    {"id": "timber", "name": "Warm timber decking", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#B98A57", "color": "#B98A57", "albedo": {"dominant": "rgba(185, 138, 87, 1)", "secondary": ["rgba(136, 98, 62, 1)"], "samplingNotes": "Palette approximated from the flat-shaded reference; lighting and contact shadows remain separate."}, "colorVariation": {"palette": ["rgba(185, 138, 87, 1)", "rgba(136, 98, 62, 1)"], "pattern": "faceted low-poly tonal breakup", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.88, "variation": 0.06, "localResponse": "Matte painted and natural surfaces; subtle roughness breakup follows facet normals."}, "metalness": {"base": 0, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.38, "notes": "Occlusion concentrated below eaves, beneath decking and where tower sections overlap."}, "localOverrides": [{"id": "dock-wear", "region": "walked centerline of dock planks", "roughness": 0.76, "color": "rgba(198, 154, 102, 1)", "evidenceRef": "detail-inventory/zone-r2c1.png"}], "textureless": {"declared": true, "evidence": ["The reference is a flat-shaded low-poly diorama with no visible pores, grain maps or printed decals.", "Identity is carried by silhouette, component boundaries and solid color regions rather than surface microtexture.", "Material 9 is represented as procedural geometry with solid PBR albedo."]}, "notes": "Intentional stylized low-poly material; no photographic texture projection is used."},
    options
  );
  materialMap["boat-cream"] = createSculptMaterial(
    "boat-cream",
    {"id": "boat-cream", "name": "Cream boat hull", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#F1E7D1", "color": "#F1E7D1", "albedo": {"dominant": "rgba(241, 231, 209, 1)", "secondary": ["rgba(213, 198, 170, 1)"], "samplingNotes": "Palette approximated from the flat-shaded reference; lighting and contact shadows remain separate."}, "colorVariation": {"palette": ["rgba(241, 231, 209, 1)", "rgba(213, 198, 170, 1)"], "pattern": "faceted low-poly tonal breakup", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.88, "variation": 0.06, "localResponse": "Matte painted and natural surfaces; subtle roughness breakup follows facet normals."}, "metalness": {"base": 0, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.38, "notes": "Occlusion concentrated below eaves, beneath decking and where tower sections overlap."}, "localOverrides": [], "textureless": {"declared": true, "evidence": ["The reference is a flat-shaded low-poly diorama with no visible pores, grain maps or printed decals.", "Identity is carried by silhouette, component boundaries and solid color regions rather than surface microtexture.", "Material 10 is represented as procedural geometry with solid PBR albedo."]}, "notes": "Intentional stylized low-poly material; no photographic texture projection is used."},
    options
  );
  materialMap["foliage"] = createSculptMaterial(
    "foliage",
    {"id": "foliage", "name": "Low-poly leaf canopies", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#4FAF51", "color": "#4FAF51", "albedo": {"dominant": "rgba(79, 175, 81, 1)", "secondary": ["rgba(44, 125, 67, 1)"], "samplingNotes": "Palette approximated from the flat-shaded reference; lighting and contact shadows remain separate."}, "colorVariation": {"palette": ["rgba(79, 175, 81, 1)", "rgba(44, 125, 67, 1)"], "pattern": "faceted low-poly tonal breakup", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.88, "variation": 0.06, "localResponse": "Matte painted and natural surfaces; subtle roughness breakup follows facet normals."}, "metalness": {"base": 0, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.38, "notes": "Occlusion concentrated below eaves, beneath decking and where tower sections overlap."}, "localOverrides": [{"id": "leaf-facets", "region": "outer canopy facets", "color": "rgba(120, 200, 92, 1)", "roughness": 0.9, "evidenceRef": "detail-inventory/zone-r1c2.png"}], "textureless": {"declared": true, "evidence": ["The reference is a flat-shaded low-poly diorama with no visible pores, grain maps or printed decals.", "Identity is carried by silhouette, component boundaries and solid color regions rather than surface microtexture.", "Material 11 is represented as procedural geometry with solid PBR albedo."]}, "notes": "Intentional stylized low-poly material; no photographic texture projection is used."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_root_0 = null;
  const endpoint_root_0 = makeAttachmentEndpoint(attachment_root_0);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Lighthouse Island Assembly__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Lighthouse Island Assembly", "level": "macro", "role": "root", "importance": 0.95, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 18}, "parent": null, "attachment": null, "dimensions": {"width": 3.8, "height": 0.42, "depth": 2.7, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "meadow"}}, "material": "meadow", "materialLayers": ["meadow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "island-shore", "type": "geometry", "description": "Angular stepped shoreline combining grass, sand and pale cliff ledges.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(105, 181, 72, 1)", "secondaryAlbedo": "rgba(77, 149, 55, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "green"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "macro"};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "meadow"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["meadow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Lighthouse Island Assembly";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Lighthouse Island Assembly", "level": "macro", "role": "root", "importance": 0.95, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 18}, "parent": null, "attachment": null, "dimensions": {"width": 3.8, "height": 0.42, "depth": 2.7, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "meadow"}}, "material": "meadow", "materialLayers": ["meadow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "island-shore", "type": "geometry", "description": "Angular stepped shoreline combining grass, sand and pale cliff ledges.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(105, 181, 72, 1)", "secondaryAlbedo": "rgba(77, 149, 55, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "green"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "macro"};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_cliff_skirt_1 = makeAttachmentEndpoint(null);
  const node_cliff_skirt_1 = new THREE.Group();
  node_cliff_skirt_1.name = "Chalk Cliff Skirt__pivot";
  node_cliff_skirt_1.scale.set(1, 1, 1);
  if (endpoint_cliff_skirt_1) {
    node_cliff_skirt_1.position.copy(endpoint_cliff_skirt_1.start);
    node_cliff_skirt_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cliff_skirt_1.position.set(0.0, 0.03, 0.0);
    node_cliff_skirt_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_cliff_skirt_1.userData.sculptComponent = {"id": "cliff-skirt", "name": "Chalk Cliff Skirt", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "none", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.34, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 3.7, "height": 0.34, "depth": 2.65, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.03, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "chalk"}}, "material": "chalk", "materialLayers": ["chalk"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(204, 215, 200, 1)", "materialClass": "stone", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "macro"};
  node_cliff_skirt_1.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "chalk"}};
  (nodes["root"] ?? root).add(node_cliff_skirt_1);
  nodes["cliff-skirt"] = node_cliff_skirt_1;
  const mesh_cliff_skirt_1Geometry = endpoint_cliff_skirt_1
    ? new THREE.CylinderGeometry(endpoint_cliff_skirt_1.endRadius, endpoint_cliff_skirt_1.baseRadius, endpoint_cliff_skirt_1.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_cliff_skirt_1) {
    mesh_cliff_skirt_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cliff_skirt_1 = new THREE.Mesh(
    mesh_cliff_skirt_1Geometry,
    materialMap["chalk"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cliff_skirt_1.name = "Chalk Cliff Skirt";
  if (endpoint_cliff_skirt_1) {
    mesh_cliff_skirt_1.position.copy(endpoint_cliff_skirt_1.midpoint);
    mesh_cliff_skirt_1.quaternion.copy(endpoint_cliff_skirt_1.quaternion);
  }
  mesh_cliff_skirt_1.castShadow = options.castShadow ?? true;
  mesh_cliff_skirt_1.receiveShadow = options.receiveShadow ?? true;
  mesh_cliff_skirt_1.userData.sculptComponent = {"id": "cliff-skirt", "name": "Chalk Cliff Skirt", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "none", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.34, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 3.7, "height": 0.34, "depth": 2.65, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.03, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "chalk"}}, "material": "chalk", "materialLayers": ["chalk"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(204, 215, 200, 1)", "materialClass": "stone", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "macro"};
  node_cliff_skirt_1.add(mesh_cliff_skirt_1);
  meshes["cliff-skirt"] = mesh_cliff_skirt_1;
  colliders["cliff-skirt"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_cliff_skirt_1);

  const attachment_sand_ledge_2 = {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.12, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_sand_ledge_2 = makeAttachmentEndpoint(attachment_sand_ledge_2);
  const node_sand_ledge_2 = new THREE.Group();
  node_sand_ledge_2.name = "Sand Ledge__pivot";
  node_sand_ledge_2.scale.set(1, 1, 1);
  if (endpoint_sand_ledge_2) {
    node_sand_ledge_2.position.copy(endpoint_sand_ledge_2.start);
    node_sand_ledge_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sand_ledge_2.position.set(0.0, 0.22, 0.0);
    node_sand_ledge_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_sand_ledge_2.userData.sculptComponent = {"id": "sand-ledge", "name": "Sand Ledge", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 18}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.12, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 3.4, "height": 0.12, "depth": 2.35, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.22, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(213, 191, 131, 1)", "materialClass": "stone", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "macro"};
  node_sand_ledge_2.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "sand"}};
  (nodes["root"] ?? root).add(node_sand_ledge_2);
  nodes["sand-ledge"] = node_sand_ledge_2;
  const mesh_sand_ledge_2Geometry = endpoint_sand_ledge_2
    ? new THREE.CylinderGeometry(endpoint_sand_ledge_2.endRadius, endpoint_sand_ledge_2.baseRadius, endpoint_sand_ledge_2.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_sand_ledge_2) {
    mesh_sand_ledge_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_sand_ledge_2 = new THREE.Mesh(
    mesh_sand_ledge_2Geometry,
    materialMap["sand"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sand_ledge_2.name = "Sand Ledge";
  if (endpoint_sand_ledge_2) {
    mesh_sand_ledge_2.position.copy(endpoint_sand_ledge_2.midpoint);
    mesh_sand_ledge_2.quaternion.copy(endpoint_sand_ledge_2.quaternion);
  }
  mesh_sand_ledge_2.castShadow = options.castShadow ?? true;
  mesh_sand_ledge_2.receiveShadow = options.receiveShadow ?? true;
  mesh_sand_ledge_2.userData.sculptComponent = {"id": "sand-ledge", "name": "Sand Ledge", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 18}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.12, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 3.4, "height": 0.12, "depth": 2.35, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.22, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(213, 191, 131, 1)", "materialClass": "stone", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "macro"};
  node_sand_ledge_2.add(mesh_sand_ledge_2);
  meshes["sand-ledge"] = mesh_sand_ledge_2;
  colliders["sand-ledge"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_sand_ledge_2);

  const attachment_tower_assembly_3 = {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.22, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_tower_assembly_3 = makeAttachmentEndpoint(attachment_tower_assembly_3);
  const node_tower_assembly_3 = new THREE.Group();
  node_tower_assembly_3.name = "Lighthouse Platform__pivot";
  node_tower_assembly_3.scale.set(1, 1, 1);
  if (endpoint_tower_assembly_3) {
    node_tower_assembly_3.position.copy(endpoint_tower_assembly_3.start);
    node_tower_assembly_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tower_assembly_3.position.set(-0.55, 0.42, -0.35);
    node_tower_assembly_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_tower_assembly_3.userData.sculptComponent = {"id": "tower-assembly", "name": "Lighthouse Platform", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.22, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 1.55, "height": 0.22, "depth": 1.55, "units": "relative", "confidence": 0.88}, "transform": {"position": [-0.55, 0.42, -0.35], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gallery-railing", "type": "geometry", "description": "Dark radial posts and top rail surrounding the lighthouse platform.", "confidence": 0.9}, {"id": "tower-painted-bands", "type": "geometry", "description": "Five alternating coral and warm-white tapered tower bands.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(218, 210, 194, 1)", "materialClass": "ceramic", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "macro"};
  node_tower_assembly_3.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}};
  (nodes["root"] ?? root).add(node_tower_assembly_3);
  nodes["tower-assembly"] = node_tower_assembly_3;
  const mesh_tower_assembly_3Geometry = endpoint_tower_assembly_3
    ? new THREE.CylinderGeometry(endpoint_tower_assembly_3.endRadius, endpoint_tower_assembly_3.baseRadius, endpoint_tower_assembly_3.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_tower_assembly_3) {
    mesh_tower_assembly_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tower_assembly_3 = new THREE.Mesh(
    mesh_tower_assembly_3Geometry,
    materialMap["plaster"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tower_assembly_3.name = "Lighthouse Platform";
  if (endpoint_tower_assembly_3) {
    mesh_tower_assembly_3.position.copy(endpoint_tower_assembly_3.midpoint);
    mesh_tower_assembly_3.quaternion.copy(endpoint_tower_assembly_3.quaternion);
  }
  mesh_tower_assembly_3.castShadow = options.castShadow ?? true;
  mesh_tower_assembly_3.receiveShadow = options.receiveShadow ?? true;
  mesh_tower_assembly_3.userData.sculptComponent = {"id": "tower-assembly", "name": "Lighthouse Platform", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.22, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 1.55, "height": 0.22, "depth": 1.55, "units": "relative", "confidence": 0.88}, "transform": {"position": [-0.55, 0.42, -0.35], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gallery-railing", "type": "geometry", "description": "Dark radial posts and top rail surrounding the lighthouse platform.", "confidence": 0.9}, {"id": "tower-painted-bands", "type": "geometry", "description": "Five alternating coral and warm-white tapered tower bands.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(218, 210, 194, 1)", "materialClass": "ceramic", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "macro"};
  node_tower_assembly_3.add(mesh_tower_assembly_3);
  meshes["tower-assembly"] = mesh_tower_assembly_3;
  colliders["tower-assembly"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_tower_assembly_3);

  const endpoint_cottage_assembly_4 = makeAttachmentEndpoint(null);
  const node_cottage_assembly_4 = new THREE.Group();
  node_cottage_assembly_4.name = "Keeper Cottage__pivot";
  node_cottage_assembly_4.scale.set(1, 1, 1);
  if (endpoint_cottage_assembly_4) {
    node_cottage_assembly_4.position.copy(endpoint_cottage_assembly_4.start);
    node_cottage_assembly_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cottage_assembly_4.position.set(0.78, 0.55, 0.28);
    node_cottage_assembly_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_cottage_assembly_4.userData.sculptComponent = {"id": "cottage-assembly", "name": "Keeper Cottage", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.72, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 1.5, "height": 0.72, "depth": 1.08, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.78, 0.55, 0.28], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cottage-roof", "type": "geometry", "description": "Shallow gabled roof split between coral and turquoise panels.", "confidence": 0.9}, {"id": "cottage-awning", "type": "geometry", "description": "Cream roller awning projecting over the cottage entrance.", "confidence": 0.9}, {"id": "cottage-chimney", "type": "geometry", "description": "Square masonry chimney behind the roof ridge.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(241, 212, 184, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "macro"};
  node_cottage_assembly_4.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}};
  (nodes["root"] ?? root).add(node_cottage_assembly_4);
  nodes["cottage-assembly"] = node_cottage_assembly_4;
  const mesh_cottage_assembly_4Geometry = endpoint_cottage_assembly_4
    ? new THREE.CylinderGeometry(endpoint_cottage_assembly_4.endRadius, endpoint_cottage_assembly_4.baseRadius, endpoint_cottage_assembly_4.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_cottage_assembly_4) {
    mesh_cottage_assembly_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cottage_assembly_4 = new THREE.Mesh(
    mesh_cottage_assembly_4Geometry,
    materialMap["coral-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cottage_assembly_4.name = "Keeper Cottage";
  if (endpoint_cottage_assembly_4) {
    mesh_cottage_assembly_4.position.copy(endpoint_cottage_assembly_4.midpoint);
    mesh_cottage_assembly_4.quaternion.copy(endpoint_cottage_assembly_4.quaternion);
  }
  mesh_cottage_assembly_4.castShadow = options.castShadow ?? true;
  mesh_cottage_assembly_4.receiveShadow = options.receiveShadow ?? true;
  mesh_cottage_assembly_4.userData.sculptComponent = {"id": "cottage-assembly", "name": "Keeper Cottage", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.72, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 1.5, "height": 0.72, "depth": 1.08, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.78, 0.55, 0.28], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cottage-roof", "type": "geometry", "description": "Shallow gabled roof split between coral and turquoise panels.", "confidence": 0.9}, {"id": "cottage-awning", "type": "geometry", "description": "Cream roller awning projecting over the cottage entrance.", "confidence": 0.9}, {"id": "cottage-chimney", "type": "geometry", "description": "Square masonry chimney behind the roof ridge.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(241, 212, 184, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "macro"};
  node_cottage_assembly_4.add(mesh_cottage_assembly_4);
  meshes["cottage-assembly"] = mesh_cottage_assembly_4;
  colliders["cottage-assembly"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_cottage_assembly_4);

  const attachment_tower_white_base_5 = {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_tower_white_base_5 = makeAttachmentEndpoint(attachment_tower_white_base_5);
  const node_tower_white_base_5 = new THREE.Group();
  node_tower_white_base_5.name = "White Tower Band__pivot";
  node_tower_white_base_5.scale.set(1, 1, 1);
  if (endpoint_tower_white_base_5) {
    node_tower_white_base_5.position.copy(endpoint_tower_white_base_5.start);
    node_tower_white_base_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tower_white_base_5.position.set(0.0, 0.48, 0.0);
    node_tower_white_base_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_tower_white_base_5.userData.sculptComponent = {"id": "tower-white-base", "name": "White Tower Band", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 1, "height": 0.3, "depth": 1, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.48, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tower-door", "type": "geometry", "description": "Dark inset door on the lower white band.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(218, 210, 194, 1)", "materialClass": "ceramic", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_tower_white_base_5.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}};
  (nodes["tower-assembly"] ?? root).add(node_tower_white_base_5);
  nodes["tower-white-base"] = node_tower_white_base_5;
  const mesh_tower_white_base_5Geometry = endpoint_tower_white_base_5
    ? new THREE.CylinderGeometry(endpoint_tower_white_base_5.endRadius, endpoint_tower_white_base_5.baseRadius, endpoint_tower_white_base_5.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_tower_white_base_5) {
    mesh_tower_white_base_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tower_white_base_5 = new THREE.Mesh(
    mesh_tower_white_base_5Geometry,
    materialMap["plaster"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tower_white_base_5.name = "White Tower Band";
  if (endpoint_tower_white_base_5) {
    mesh_tower_white_base_5.position.copy(endpoint_tower_white_base_5.midpoint);
    mesh_tower_white_base_5.quaternion.copy(endpoint_tower_white_base_5.quaternion);
  }
  mesh_tower_white_base_5.castShadow = options.castShadow ?? true;
  mesh_tower_white_base_5.receiveShadow = options.receiveShadow ?? true;
  mesh_tower_white_base_5.userData.sculptComponent = {"id": "tower-white-base", "name": "White Tower Band", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 1, "height": 0.3, "depth": 1, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.48, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tower-door", "type": "geometry", "description": "Dark inset door on the lower white band.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(218, 210, 194, 1)", "materialClass": "ceramic", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_tower_white_base_5.add(mesh_tower_white_base_5);
  meshes["tower-white-base"] = mesh_tower_white_base_5;
  colliders["tower-white-base"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_tower_white_base_5);

  const attachment_tower_coral_base_6 = {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_tower_coral_base_6 = makeAttachmentEndpoint(attachment_tower_coral_base_6);
  const node_tower_coral_base_6 = new THREE.Group();
  node_tower_coral_base_6.name = "Coral Tower Band__pivot";
  node_tower_coral_base_6.scale.set(1, 1, 1);
  if (endpoint_tower_coral_base_6) {
    node_tower_coral_base_6.position.copy(endpoint_tower_coral_base_6.start);
    node_tower_coral_base_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tower_coral_base_6.position.set(0.0, 0.76, 0.0);
    node_tower_coral_base_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_tower_coral_base_6.userData.sculptComponent = {"id": "tower-coral-base", "name": "Coral Tower Band", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.94, "height": 0.3, "depth": 0.94, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.76, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(185, 66, 54, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_tower_coral_base_6.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}};
  (nodes["tower-assembly"] ?? root).add(node_tower_coral_base_6);
  nodes["tower-coral-base"] = node_tower_coral_base_6;
  const mesh_tower_coral_base_6Geometry = endpoint_tower_coral_base_6
    ? new THREE.CylinderGeometry(endpoint_tower_coral_base_6.endRadius, endpoint_tower_coral_base_6.baseRadius, endpoint_tower_coral_base_6.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_tower_coral_base_6) {
    mesh_tower_coral_base_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tower_coral_base_6 = new THREE.Mesh(
    mesh_tower_coral_base_6Geometry,
    materialMap["coral-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tower_coral_base_6.name = "Coral Tower Band";
  if (endpoint_tower_coral_base_6) {
    mesh_tower_coral_base_6.position.copy(endpoint_tower_coral_base_6.midpoint);
    mesh_tower_coral_base_6.quaternion.copy(endpoint_tower_coral_base_6.quaternion);
  }
  mesh_tower_coral_base_6.castShadow = options.castShadow ?? true;
  mesh_tower_coral_base_6.receiveShadow = options.receiveShadow ?? true;
  mesh_tower_coral_base_6.userData.sculptComponent = {"id": "tower-coral-base", "name": "Coral Tower Band", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.94, "height": 0.3, "depth": 0.94, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.76, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(185, 66, 54, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_tower_coral_base_6.add(mesh_tower_coral_base_6);
  meshes["tower-coral-base"] = mesh_tower_coral_base_6;
  colliders["tower-coral-base"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_tower_coral_base_6);

  const attachment_tower_white_mid_7 = {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_tower_white_mid_7 = makeAttachmentEndpoint(attachment_tower_white_mid_7);
  const node_tower_white_mid_7 = new THREE.Group();
  node_tower_white_mid_7.name = "White Tower Band__pivot";
  node_tower_white_mid_7.scale.set(1, 1, 1);
  if (endpoint_tower_white_mid_7) {
    node_tower_white_mid_7.position.copy(endpoint_tower_white_mid_7.start);
    node_tower_white_mid_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tower_white_mid_7.position.set(0.0, 1.04, 0.0);
    node_tower_white_mid_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_tower_white_mid_7.userData.sculptComponent = {"id": "tower-white-mid", "name": "White Tower Band", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.88, "height": 0.3, "depth": 0.88, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 1.04, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(218, 210, 194, 1)", "materialClass": "ceramic", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_tower_white_mid_7.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}};
  (nodes["tower-assembly"] ?? root).add(node_tower_white_mid_7);
  nodes["tower-white-mid"] = node_tower_white_mid_7;
  const mesh_tower_white_mid_7Geometry = endpoint_tower_white_mid_7
    ? new THREE.CylinderGeometry(endpoint_tower_white_mid_7.endRadius, endpoint_tower_white_mid_7.baseRadius, endpoint_tower_white_mid_7.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_tower_white_mid_7) {
    mesh_tower_white_mid_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tower_white_mid_7 = new THREE.Mesh(
    mesh_tower_white_mid_7Geometry,
    materialMap["plaster"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tower_white_mid_7.name = "White Tower Band";
  if (endpoint_tower_white_mid_7) {
    mesh_tower_white_mid_7.position.copy(endpoint_tower_white_mid_7.midpoint);
    mesh_tower_white_mid_7.quaternion.copy(endpoint_tower_white_mid_7.quaternion);
  }
  mesh_tower_white_mid_7.castShadow = options.castShadow ?? true;
  mesh_tower_white_mid_7.receiveShadow = options.receiveShadow ?? true;
  mesh_tower_white_mid_7.userData.sculptComponent = {"id": "tower-white-mid", "name": "White Tower Band", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.88, "height": 0.3, "depth": 0.88, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 1.04, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(218, 210, 194, 1)", "materialClass": "ceramic", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_tower_white_mid_7.add(mesh_tower_white_mid_7);
  meshes["tower-white-mid"] = mesh_tower_white_mid_7;
  colliders["tower-white-mid"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_tower_white_mid_7);

  const attachment_tower_coral_mid_8 = {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_tower_coral_mid_8 = makeAttachmentEndpoint(attachment_tower_coral_mid_8);
  const node_tower_coral_mid_8 = new THREE.Group();
  node_tower_coral_mid_8.name = "Coral Tower Band__pivot";
  node_tower_coral_mid_8.scale.set(1, 1, 1);
  if (endpoint_tower_coral_mid_8) {
    node_tower_coral_mid_8.position.copy(endpoint_tower_coral_mid_8.start);
    node_tower_coral_mid_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tower_coral_mid_8.position.set(0.0, 1.32, 0.0);
    node_tower_coral_mid_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_tower_coral_mid_8.userData.sculptComponent = {"id": "tower-coral-mid", "name": "Coral Tower Band", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.82, "height": 0.3, "depth": 0.82, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 1.32, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(185, 66, 54, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_tower_coral_mid_8.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}};
  (nodes["tower-assembly"] ?? root).add(node_tower_coral_mid_8);
  nodes["tower-coral-mid"] = node_tower_coral_mid_8;
  const mesh_tower_coral_mid_8Geometry = endpoint_tower_coral_mid_8
    ? new THREE.CylinderGeometry(endpoint_tower_coral_mid_8.endRadius, endpoint_tower_coral_mid_8.baseRadius, endpoint_tower_coral_mid_8.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_tower_coral_mid_8) {
    mesh_tower_coral_mid_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tower_coral_mid_8 = new THREE.Mesh(
    mesh_tower_coral_mid_8Geometry,
    materialMap["coral-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tower_coral_mid_8.name = "Coral Tower Band";
  if (endpoint_tower_coral_mid_8) {
    mesh_tower_coral_mid_8.position.copy(endpoint_tower_coral_mid_8.midpoint);
    mesh_tower_coral_mid_8.quaternion.copy(endpoint_tower_coral_mid_8.quaternion);
  }
  mesh_tower_coral_mid_8.castShadow = options.castShadow ?? true;
  mesh_tower_coral_mid_8.receiveShadow = options.receiveShadow ?? true;
  mesh_tower_coral_mid_8.userData.sculptComponent = {"id": "tower-coral-mid", "name": "Coral Tower Band", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.82, "height": 0.3, "depth": 0.82, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 1.32, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(185, 66, 54, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_tower_coral_mid_8.add(mesh_tower_coral_mid_8);
  meshes["tower-coral-mid"] = mesh_tower_coral_mid_8;
  colliders["tower-coral-mid"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_tower_coral_mid_8);

  const attachment_tower_white_top_9 = {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_tower_white_top_9 = makeAttachmentEndpoint(attachment_tower_white_top_9);
  const node_tower_white_top_9 = new THREE.Group();
  node_tower_white_top_9.name = "White Tower Band__pivot";
  node_tower_white_top_9.scale.set(1, 1, 1);
  if (endpoint_tower_white_top_9) {
    node_tower_white_top_9.position.copy(endpoint_tower_white_top_9.start);
    node_tower_white_top_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tower_white_top_9.position.set(0.0, 1.6, 0.0);
    node_tower_white_top_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_tower_white_top_9.userData.sculptComponent = {"id": "tower-white-top", "name": "White Tower Band", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.76, "height": 0.3, "depth": 0.76, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 1.6, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(218, 210, 194, 1)", "materialClass": "ceramic", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_tower_white_top_9.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}};
  (nodes["tower-assembly"] ?? root).add(node_tower_white_top_9);
  nodes["tower-white-top"] = node_tower_white_top_9;
  const mesh_tower_white_top_9Geometry = endpoint_tower_white_top_9
    ? new THREE.CylinderGeometry(endpoint_tower_white_top_9.endRadius, endpoint_tower_white_top_9.baseRadius, endpoint_tower_white_top_9.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_tower_white_top_9) {
    mesh_tower_white_top_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tower_white_top_9 = new THREE.Mesh(
    mesh_tower_white_top_9Geometry,
    materialMap["plaster"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tower_white_top_9.name = "White Tower Band";
  if (endpoint_tower_white_top_9) {
    mesh_tower_white_top_9.position.copy(endpoint_tower_white_top_9.midpoint);
    mesh_tower_white_top_9.quaternion.copy(endpoint_tower_white_top_9.quaternion);
  }
  mesh_tower_white_top_9.castShadow = options.castShadow ?? true;
  mesh_tower_white_top_9.receiveShadow = options.receiveShadow ?? true;
  mesh_tower_white_top_9.userData.sculptComponent = {"id": "tower-white-top", "name": "White Tower Band", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.3, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.76, "height": 0.3, "depth": 0.76, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 1.6, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(218, 210, 194, 1)", "materialClass": "ceramic", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_tower_white_top_9.add(mesh_tower_white_top_9);
  meshes["tower-white-top"] = mesh_tower_white_top_9;
  colliders["tower-white-top"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_tower_white_top_9);

  const attachment_gallery_slab_10 = {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.11, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_gallery_slab_10 = makeAttachmentEndpoint(attachment_gallery_slab_10);
  const node_gallery_slab_10 = new THREE.Group();
  node_gallery_slab_10.name = "Gallery Slab__pivot";
  node_gallery_slab_10.scale.set(1, 1, 1);
  if (endpoint_gallery_slab_10) {
    node_gallery_slab_10.position.copy(endpoint_gallery_slab_10.start);
    node_gallery_slab_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_gallery_slab_10.position.set(0.0, 1.85, 0.0);
    node_gallery_slab_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_gallery_slab_10.userData.sculptComponent = {"id": "gallery-slab", "name": "Gallery Slab", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.11, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.9, "height": 0.11, "depth": 0.9, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 1.85, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(218, 210, 194, 1)", "materialClass": "ceramic", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_gallery_slab_10.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}};
  (nodes["tower-assembly"] ?? root).add(node_gallery_slab_10);
  nodes["gallery-slab"] = node_gallery_slab_10;
  const mesh_gallery_slab_10Geometry = endpoint_gallery_slab_10
    ? new THREE.CylinderGeometry(endpoint_gallery_slab_10.endRadius, endpoint_gallery_slab_10.baseRadius, endpoint_gallery_slab_10.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_gallery_slab_10) {
    mesh_gallery_slab_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_gallery_slab_10 = new THREE.Mesh(
    mesh_gallery_slab_10Geometry,
    materialMap["plaster"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gallery_slab_10.name = "Gallery Slab";
  if (endpoint_gallery_slab_10) {
    mesh_gallery_slab_10.position.copy(endpoint_gallery_slab_10.midpoint);
    mesh_gallery_slab_10.quaternion.copy(endpoint_gallery_slab_10.quaternion);
  }
  mesh_gallery_slab_10.castShadow = options.castShadow ?? true;
  mesh_gallery_slab_10.receiveShadow = options.receiveShadow ?? true;
  mesh_gallery_slab_10.userData.sculptComponent = {"id": "gallery-slab", "name": "Gallery Slab", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 16}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.11, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.9, "height": 0.11, "depth": 0.9, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 1.85, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(218, 210, 194, 1)", "materialClass": "ceramic", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_gallery_slab_10.add(mesh_gallery_slab_10);
  meshes["gallery-slab"] = mesh_gallery_slab_10;
  colliders["gallery-slab"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_gallery_slab_10);

  const attachment_gallery_post_11 = {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.26, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_gallery_post_11 = makeAttachmentEndpoint(attachment_gallery_post_11);
  const node_gallery_post_11 = new THREE.Group();
  node_gallery_post_11.name = "Gallery Railing Post__pivot";
  node_gallery_post_11.scale.set(1, 1, 1);
  if (endpoint_gallery_post_11) {
    node_gallery_post_11.position.copy(endpoint_gallery_post_11.start);
    node_gallery_post_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_gallery_post_11.position.set(0.36, 2.0, 0.0);
    node_gallery_post_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_gallery_post_11.userData.sculptComponent = {"id": "gallery-post", "name": "Gallery Railing Post", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 6}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.26, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.035, "height": 0.26, "depth": 0.035, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.36, 2, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "dark-metal"}}, "material": "dark-metal", "materialLayers": ["dark-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(49, 52, 47, 1)", "materialClass": "metal", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_gallery_post_11.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "dark-metal"}};
  (nodes["tower-assembly"] ?? root).add(node_gallery_post_11);
  nodes["gallery-post"] = node_gallery_post_11;
  const mesh_gallery_post_11Geometry = endpoint_gallery_post_11
    ? new THREE.CylinderGeometry(endpoint_gallery_post_11.endRadius, endpoint_gallery_post_11.baseRadius, endpoint_gallery_post_11.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_gallery_post_11) {
    mesh_gallery_post_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_gallery_post_11 = new THREE.Mesh(
    mesh_gallery_post_11Geometry,
    materialMap["dark-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gallery_post_11.name = "Gallery Railing Post";
  if (endpoint_gallery_post_11) {
    mesh_gallery_post_11.position.copy(endpoint_gallery_post_11.midpoint);
    mesh_gallery_post_11.quaternion.copy(endpoint_gallery_post_11.quaternion);
  }
  mesh_gallery_post_11.castShadow = options.castShadow ?? true;
  mesh_gallery_post_11.receiveShadow = options.receiveShadow ?? true;
  mesh_gallery_post_11.userData.sculptComponent = {"id": "gallery-post", "name": "Gallery Railing Post", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 6}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.26, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.035, "height": 0.26, "depth": 0.035, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.36, 2, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "dark-metal"}}, "material": "dark-metal", "materialLayers": ["dark-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(49, 52, 47, 1)", "materialClass": "metal", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_gallery_post_11.add(mesh_gallery_post_11);
  meshes["gallery-post"] = mesh_gallery_post_11;
  colliders["gallery-post"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_gallery_post_11);

  const attachment_lantern_room_12 = {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.32, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_lantern_room_12 = makeAttachmentEndpoint(attachment_lantern_room_12);
  const node_lantern_room_12 = new THREE.Group();
  node_lantern_room_12.name = "Lantern Room__pivot";
  node_lantern_room_12.scale.set(1, 1, 1);
  if (endpoint_lantern_room_12) {
    node_lantern_room_12.position.copy(endpoint_lantern_room_12.start);
    node_lantern_room_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lantern_room_12.position.set(0.0, 2.01, 0.0);
    node_lantern_room_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_lantern_room_12.userData.sculptComponent = {"id": "lantern-room", "name": "Lantern Room", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.32, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.62, "height": 0.32, "depth": 0.62, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 2.01, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(105, 185, 196, 1)", "secondaryAlbedo": "rgba(140, 191, 202, 1)", "materialClass": "glass", "materialClassConfidence": 0.94, "materialFamily": "turquoise"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_lantern_room_12.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}};
  (nodes["tower-assembly"] ?? root).add(node_lantern_room_12);
  nodes["lantern-room"] = node_lantern_room_12;
  const mesh_lantern_room_12Geometry = endpoint_lantern_room_12
    ? new THREE.CylinderGeometry(endpoint_lantern_room_12.endRadius, endpoint_lantern_room_12.baseRadius, endpoint_lantern_room_12.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_lantern_room_12) {
    mesh_lantern_room_12Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lantern_room_12 = new THREE.Mesh(
    mesh_lantern_room_12Geometry,
    materialMap["plaster"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lantern_room_12.name = "Lantern Room";
  if (endpoint_lantern_room_12) {
    mesh_lantern_room_12.position.copy(endpoint_lantern_room_12.midpoint);
    mesh_lantern_room_12.quaternion.copy(endpoint_lantern_room_12.quaternion);
  }
  mesh_lantern_room_12.castShadow = options.castShadow ?? true;
  mesh_lantern_room_12.receiveShadow = options.receiveShadow ?? true;
  mesh_lantern_room_12.userData.sculptComponent = {"id": "lantern-room", "name": "Lantern Room", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.32, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.62, "height": 0.32, "depth": 0.62, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 2.01, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(105, 185, 196, 1)", "secondaryAlbedo": "rgba(140, 191, 202, 1)", "materialClass": "glass", "materialClassConfidence": 0.94, "materialFamily": "turquoise"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_lantern_room_12.add(mesh_lantern_room_12);
  meshes["lantern-room"] = mesh_lantern_room_12;
  colliders["lantern-room"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_lantern_room_12);

  const attachment_roof_13 = {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.42, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_roof_13 = makeAttachmentEndpoint(attachment_roof_13);
  const node_roof_13 = new THREE.Group();
  node_roof_13.name = "Red Lighthouse Roof__pivot";
  node_roof_13.scale.set(1, 1, 1);
  if (endpoint_roof_13) {
    node_roof_13.position.copy(endpoint_roof_13.start);
    node_roof_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_roof_13.position.set(0.0, 2.27, 0.0);
    node_roof_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_roof_13.userData.sculptComponent = {"id": "roof", "name": "Red Lighthouse Roof", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.42, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.78, "height": 0.42, "depth": 0.78, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 2.27, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "roof-paint"}}, "material": "roof-paint", "materialLayers": ["roof-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "roof-finial", "type": "geometry", "description": "Short dark spindle and weather-vane cross above the conical roof.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(169, 61, 50, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_roof_13.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "roof-paint"}};
  (nodes["tower-assembly"] ?? root).add(node_roof_13);
  nodes["roof"] = node_roof_13;
  const mesh_roof_13Geometry = endpoint_roof_13
    ? new THREE.CylinderGeometry(endpoint_roof_13.endRadius, endpoint_roof_13.baseRadius, endpoint_roof_13.length, 16, 6)
    : new THREE.ConeGeometry(0.5, 1, 24, 1);
  if (!endpoint_roof_13) {
    mesh_roof_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_roof_13 = new THREE.Mesh(
    mesh_roof_13Geometry,
    materialMap["roof-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_roof_13.name = "Red Lighthouse Roof";
  if (endpoint_roof_13) {
    mesh_roof_13.position.copy(endpoint_roof_13.midpoint);
    mesh_roof_13.quaternion.copy(endpoint_roof_13.quaternion);
  }
  mesh_roof_13.castShadow = options.castShadow ?? true;
  mesh_roof_13.receiveShadow = options.receiveShadow ?? true;
  mesh_roof_13.userData.sculptComponent = {"id": "roof", "name": "Red Lighthouse Roof", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "tower-assembly", "attachment": {"parentId": "tower-assembly", "parentSocket": "tower-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.42, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.78, "height": 0.42, "depth": 0.78, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 2.27, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "roof-paint"}}, "material": "roof-paint", "materialLayers": ["roof-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "roof-finial", "type": "geometry", "description": "Short dark spindle and weather-vane cross above the conical roof.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(169, 61, 50, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_roof_13.add(mesh_roof_13);
  meshes["roof"] = mesh_roof_13;
  colliders["roof"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_roof_13);

  const attachment_finial_14 = {"parentId": "roof", "parentSocket": "roof-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.26, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_finial_14 = makeAttachmentEndpoint(attachment_finial_14);
  const node_finial_14 = new THREE.Group();
  node_finial_14.name = "Roof Finial__pivot";
  node_finial_14.scale.set(1, 1, 1);
  if (endpoint_finial_14) {
    node_finial_14.position.copy(endpoint_finial_14.start);
    node_finial_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_finial_14.position.set(0.0, 0.3, 0.0);
    node_finial_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_finial_14.userData.sculptComponent = {"id": "finial", "name": "Roof Finial", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 6}, "parent": "roof", "attachment": {"parentId": "roof", "parentSocket": "roof-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.26, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.045, "height": 0.26, "depth": 0.045, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.3, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "dark-metal"}}, "material": "dark-metal", "materialLayers": ["dark-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "weather-vane", "type": "geometry", "description": "Orthogonal directional arrow and colored vane tips.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(49, 52, 47, 1)", "materialClass": "metal", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_finial_14.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "dark-metal"}};
  (nodes["roof"] ?? root).add(node_finial_14);
  nodes["finial"] = node_finial_14;
  const mesh_finial_14Geometry = endpoint_finial_14
    ? new THREE.CylinderGeometry(endpoint_finial_14.endRadius, endpoint_finial_14.baseRadius, endpoint_finial_14.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_finial_14) {
    mesh_finial_14Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_finial_14 = new THREE.Mesh(
    mesh_finial_14Geometry,
    materialMap["dark-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_finial_14.name = "Roof Finial";
  if (endpoint_finial_14) {
    mesh_finial_14.position.copy(endpoint_finial_14.midpoint);
    mesh_finial_14.quaternion.copy(endpoint_finial_14.quaternion);
  }
  mesh_finial_14.castShadow = options.castShadow ?? true;
  mesh_finial_14.receiveShadow = options.receiveShadow ?? true;
  mesh_finial_14.userData.sculptComponent = {"id": "finial", "name": "Roof Finial", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 6}, "parent": "roof", "attachment": {"parentId": "roof", "parentSocket": "roof-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.26, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.045, "height": 0.26, "depth": 0.045, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.3, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "dark-metal"}}, "material": "dark-metal", "materialLayers": ["dark-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "weather-vane", "type": "geometry", "description": "Orthogonal directional arrow and colored vane tips.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(49, 52, 47, 1)", "materialClass": "metal", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_finial_14.add(mesh_finial_14);
  meshes["finial"] = mesh_finial_14;
  colliders["finial"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_finial_14);

  const endpoint_weather_vane_rod_15 = makeAttachmentEndpoint(null);
  const node_weather_vane_rod_15 = new THREE.Group();
  node_weather_vane_rod_15.name = "Weather Vane Rod__pivot";
  node_weather_vane_rod_15.scale.set(1, 1, 1);
  if (endpoint_weather_vane_rod_15) {
    node_weather_vane_rod_15.position.copy(endpoint_weather_vane_rod_15.start);
    node_weather_vane_rod_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_weather_vane_rod_15.position.set(0.0, 0.16, 0.0);
    node_weather_vane_rod_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_weather_vane_rod_15.userData.sculptComponent = {"id": "weather-vane-rod", "name": "Weather Vane Rod", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "finial", "attachment": {"parentId": "finial", "parentSocket": "finial-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.05, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.68, "height": 0.035, "depth": 0.035, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.16, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "dark-metal"}}, "material": "dark-metal", "materialLayers": ["dark-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(49, 52, 47, 1)", "materialClass": "metal", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_weather_vane_rod_15.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "dark-metal"}};
  (nodes["finial"] ?? root).add(node_weather_vane_rod_15);
  nodes["weather-vane-rod"] = node_weather_vane_rod_15;
  const mesh_weather_vane_rod_15Geometry = endpoint_weather_vane_rod_15
    ? new THREE.CylinderGeometry(endpoint_weather_vane_rod_15.endRadius, endpoint_weather_vane_rod_15.baseRadius, endpoint_weather_vane_rod_15.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_weather_vane_rod_15) {
    mesh_weather_vane_rod_15Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_weather_vane_rod_15 = new THREE.Mesh(
    mesh_weather_vane_rod_15Geometry,
    materialMap["dark-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_weather_vane_rod_15.name = "Weather Vane Rod";
  if (endpoint_weather_vane_rod_15) {
    mesh_weather_vane_rod_15.position.copy(endpoint_weather_vane_rod_15.midpoint);
    mesh_weather_vane_rod_15.quaternion.copy(endpoint_weather_vane_rod_15.quaternion);
  }
  mesh_weather_vane_rod_15.castShadow = options.castShadow ?? true;
  mesh_weather_vane_rod_15.receiveShadow = options.receiveShadow ?? true;
  mesh_weather_vane_rod_15.userData.sculptComponent = {"id": "weather-vane-rod", "name": "Weather Vane Rod", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "finial", "attachment": {"parentId": "finial", "parentSocket": "finial-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.05, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.68, "height": 0.035, "depth": 0.035, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.16, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "dark-metal"}}, "material": "dark-metal", "materialLayers": ["dark-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(49, 52, 47, 1)", "materialClass": "metal", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_weather_vane_rod_15.add(mesh_weather_vane_rod_15);
  meshes["weather-vane-rod"] = mesh_weather_vane_rod_15;
  colliders["weather-vane-rod"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_weather_vane_rod_15);

  const endpoint_weather_vane_arrow_16 = makeAttachmentEndpoint(null);
  const node_weather_vane_arrow_16 = new THREE.Group();
  node_weather_vane_arrow_16.name = "Weather Vane Arrow__pivot";
  node_weather_vane_arrow_16.scale.set(1, 1, 1);
  if (endpoint_weather_vane_arrow_16) {
    node_weather_vane_arrow_16.position.copy(endpoint_weather_vane_arrow_16.start);
    node_weather_vane_arrow_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_weather_vane_arrow_16.position.set(0.0, 0.19, 0.0);
    node_weather_vane_arrow_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_weather_vane_arrow_16.userData.sculptComponent = {"id": "weather-vane-arrow", "name": "Weather Vane Arrow", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "finial", "attachment": {"parentId": "finial", "parentSocket": "finial-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.05, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.035, "height": 0.035, "depth": 0.52, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.19, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(185, 66, 54, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_weather_vane_arrow_16.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}};
  (nodes["finial"] ?? root).add(node_weather_vane_arrow_16);
  nodes["weather-vane-arrow"] = node_weather_vane_arrow_16;
  const mesh_weather_vane_arrow_16Geometry = endpoint_weather_vane_arrow_16
    ? new THREE.CylinderGeometry(endpoint_weather_vane_arrow_16.endRadius, endpoint_weather_vane_arrow_16.baseRadius, endpoint_weather_vane_arrow_16.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_weather_vane_arrow_16) {
    mesh_weather_vane_arrow_16Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_weather_vane_arrow_16 = new THREE.Mesh(
    mesh_weather_vane_arrow_16Geometry,
    materialMap["coral-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_weather_vane_arrow_16.name = "Weather Vane Arrow";
  if (endpoint_weather_vane_arrow_16) {
    mesh_weather_vane_arrow_16.position.copy(endpoint_weather_vane_arrow_16.midpoint);
    mesh_weather_vane_arrow_16.quaternion.copy(endpoint_weather_vane_arrow_16.quaternion);
  }
  mesh_weather_vane_arrow_16.castShadow = options.castShadow ?? true;
  mesh_weather_vane_arrow_16.receiveShadow = options.receiveShadow ?? true;
  mesh_weather_vane_arrow_16.userData.sculptComponent = {"id": "weather-vane-arrow", "name": "Weather Vane Arrow", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "finial", "attachment": {"parentId": "finial", "parentSocket": "finial-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.05, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.035, "height": 0.035, "depth": 0.52, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.19, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(185, 66, 54, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_weather_vane_arrow_16.add(mesh_weather_vane_arrow_16);
  meshes["weather-vane-arrow"] = mesh_weather_vane_arrow_16;
  colliders["weather-vane-arrow"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_weather_vane_arrow_16);

  const endpoint_cottage_roof_turquoise_17 = makeAttachmentEndpoint(null);
  const node_cottage_roof_turquoise_17 = new THREE.Group();
  node_cottage_roof_turquoise_17.name = "Turquoise Cottage Roof__pivot";
  node_cottage_roof_turquoise_17.scale.set(1, 1, 1);
  if (endpoint_cottage_roof_turquoise_17) {
    node_cottage_roof_turquoise_17.position.copy(endpoint_cottage_roof_turquoise_17.start);
    node_cottage_roof_turquoise_17.rotation.set(0.0, 0.0, 0.16);
  } else {
    node_cottage_roof_turquoise_17.position.set(-0.3, 0.48, 0.0);
    node_cottage_roof_turquoise_17.rotation.set(0.0, 0.0, 0.16);
  }
  node_cottage_roof_turquoise_17.userData.sculptComponent = {"id": "cottage-roof-turquoise", "name": "Turquoise Cottage Roof", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "cottage-assembly", "attachment": {"parentId": "cottage-assembly", "parentSocket": "cottage-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.12, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.86, "height": 0.12, "depth": 1.24, "units": "relative", "confidence": 0.88}, "transform": {"position": [-0.3, 0.48, 0], "rotation": [0, 0, 0.16], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "turquoise-paint"}}, "material": "turquoise-paint", "materialLayers": ["turquoise-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(105, 185, 196, 1)", "secondaryAlbedo": "rgba(77, 154, 168, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "turquoise"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_cottage_roof_turquoise_17.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "turquoise-paint"}};
  (nodes["cottage-assembly"] ?? root).add(node_cottage_roof_turquoise_17);
  nodes["cottage-roof-turquoise"] = node_cottage_roof_turquoise_17;
  const mesh_cottage_roof_turquoise_17Geometry = endpoint_cottage_roof_turquoise_17
    ? new THREE.CylinderGeometry(endpoint_cottage_roof_turquoise_17.endRadius, endpoint_cottage_roof_turquoise_17.baseRadius, endpoint_cottage_roof_turquoise_17.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_cottage_roof_turquoise_17) {
    mesh_cottage_roof_turquoise_17Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cottage_roof_turquoise_17 = new THREE.Mesh(
    mesh_cottage_roof_turquoise_17Geometry,
    materialMap["turquoise-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cottage_roof_turquoise_17.name = "Turquoise Cottage Roof";
  if (endpoint_cottage_roof_turquoise_17) {
    mesh_cottage_roof_turquoise_17.position.copy(endpoint_cottage_roof_turquoise_17.midpoint);
    mesh_cottage_roof_turquoise_17.quaternion.copy(endpoint_cottage_roof_turquoise_17.quaternion);
  }
  mesh_cottage_roof_turquoise_17.castShadow = options.castShadow ?? true;
  mesh_cottage_roof_turquoise_17.receiveShadow = options.receiveShadow ?? true;
  mesh_cottage_roof_turquoise_17.userData.sculptComponent = {"id": "cottage-roof-turquoise", "name": "Turquoise Cottage Roof", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "cottage-assembly", "attachment": {"parentId": "cottage-assembly", "parentSocket": "cottage-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.12, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.86, "height": 0.12, "depth": 1.24, "units": "relative", "confidence": 0.88}, "transform": {"position": [-0.3, 0.48, 0], "rotation": [0, 0, 0.16], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "turquoise-paint"}}, "material": "turquoise-paint", "materialLayers": ["turquoise-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(105, 185, 196, 1)", "secondaryAlbedo": "rgba(77, 154, 168, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "turquoise"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_cottage_roof_turquoise_17.add(mesh_cottage_roof_turquoise_17);
  meshes["cottage-roof-turquoise"] = mesh_cottage_roof_turquoise_17;
  colliders["cottage-roof-turquoise"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_cottage_roof_turquoise_17);

  const endpoint_cottage_roof_coral_18 = makeAttachmentEndpoint(null);
  const node_cottage_roof_coral_18 = new THREE.Group();
  node_cottage_roof_coral_18.name = "Coral Cottage Roof__pivot";
  node_cottage_roof_coral_18.scale.set(1, 1, 1);
  if (endpoint_cottage_roof_coral_18) {
    node_cottage_roof_coral_18.position.copy(endpoint_cottage_roof_coral_18.start);
    node_cottage_roof_coral_18.rotation.set(0.0, 0.0, -0.16);
  } else {
    node_cottage_roof_coral_18.position.set(0.3, 0.48, 0.0);
    node_cottage_roof_coral_18.rotation.set(0.0, 0.0, -0.16);
  }
  node_cottage_roof_coral_18.userData.sculptComponent = {"id": "cottage-roof-coral", "name": "Coral Cottage Roof", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "cottage-assembly", "attachment": {"parentId": "cottage-assembly", "parentSocket": "cottage-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.12, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.86, "height": 0.12, "depth": 1.24, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.3, 0.48, 0], "rotation": [0, 0, -0.16], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(241, 212, 184, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_cottage_roof_coral_18.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}};
  (nodes["cottage-assembly"] ?? root).add(node_cottage_roof_coral_18);
  nodes["cottage-roof-coral"] = node_cottage_roof_coral_18;
  const mesh_cottage_roof_coral_18Geometry = endpoint_cottage_roof_coral_18
    ? new THREE.CylinderGeometry(endpoint_cottage_roof_coral_18.endRadius, endpoint_cottage_roof_coral_18.baseRadius, endpoint_cottage_roof_coral_18.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_cottage_roof_coral_18) {
    mesh_cottage_roof_coral_18Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cottage_roof_coral_18 = new THREE.Mesh(
    mesh_cottage_roof_coral_18Geometry,
    materialMap["coral-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cottage_roof_coral_18.name = "Coral Cottage Roof";
  if (endpoint_cottage_roof_coral_18) {
    mesh_cottage_roof_coral_18.position.copy(endpoint_cottage_roof_coral_18.midpoint);
    mesh_cottage_roof_coral_18.quaternion.copy(endpoint_cottage_roof_coral_18.quaternion);
  }
  mesh_cottage_roof_coral_18.castShadow = options.castShadow ?? true;
  mesh_cottage_roof_coral_18.receiveShadow = options.receiveShadow ?? true;
  mesh_cottage_roof_coral_18.userData.sculptComponent = {"id": "cottage-roof-coral", "name": "Coral Cottage Roof", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "cottage-assembly", "attachment": {"parentId": "cottage-assembly", "parentSocket": "cottage-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.12, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.86, "height": 0.12, "depth": 1.24, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.3, 0.48, 0], "rotation": [0, 0, -0.16], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(241, 212, 184, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_cottage_roof_coral_18.add(mesh_cottage_roof_coral_18);
  meshes["cottage-roof-coral"] = mesh_cottage_roof_coral_18;
  colliders["cottage-roof-coral"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_cottage_roof_coral_18);

  const attachment_cottage_awning_19 = {"parentId": "cottage-assembly", "parentSocket": "cottage-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.12, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_cottage_awning_19 = makeAttachmentEndpoint(attachment_cottage_awning_19);
  const node_cottage_awning_19 = new THREE.Group();
  node_cottage_awning_19.name = "Cream Roller Awning__pivot";
  node_cottage_awning_19.scale.set(1, 1, 1);
  if (endpoint_cottage_awning_19) {
    node_cottage_awning_19.position.copy(endpoint_cottage_awning_19.start);
    node_cottage_awning_19.rotation.set(0.0, 0.0, 1.5707963267948966);
  } else {
    node_cottage_awning_19.position.set(0.0, 0.18, 0.62);
    node_cottage_awning_19.rotation.set(0.0, 0.0, 1.5707963267948966);
  }
  node_cottage_awning_19.userData.sculptComponent = {"id": "cottage-awning", "name": "Cream Roller Awning", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 10}, "parent": "cottage-assembly", "attachment": {"parentId": "cottage-assembly", "parentSocket": "cottage-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.12, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.34, "height": 1.12, "depth": 0.34, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.18, 0.62], "rotation": [0, 0, 1.5707963267948966], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(218, 210, 194, 1)", "materialClass": "fabric", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_cottage_awning_19.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}};
  (nodes["cottage-assembly"] ?? root).add(node_cottage_awning_19);
  nodes["cottage-awning"] = node_cottage_awning_19;
  const mesh_cottage_awning_19Geometry = endpoint_cottage_awning_19
    ? new THREE.CylinderGeometry(endpoint_cottage_awning_19.endRadius, endpoint_cottage_awning_19.baseRadius, endpoint_cottage_awning_19.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_cottage_awning_19) {
    mesh_cottage_awning_19Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cottage_awning_19 = new THREE.Mesh(
    mesh_cottage_awning_19Geometry,
    materialMap["plaster"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cottage_awning_19.name = "Cream Roller Awning";
  if (endpoint_cottage_awning_19) {
    mesh_cottage_awning_19.position.copy(endpoint_cottage_awning_19.midpoint);
    mesh_cottage_awning_19.quaternion.copy(endpoint_cottage_awning_19.quaternion);
  }
  mesh_cottage_awning_19.castShadow = options.castShadow ?? true;
  mesh_cottage_awning_19.receiveShadow = options.receiveShadow ?? true;
  mesh_cottage_awning_19.userData.sculptComponent = {"id": "cottage-awning", "name": "Cream Roller Awning", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 10}, "parent": "cottage-assembly", "attachment": {"parentId": "cottage-assembly", "parentSocket": "cottage-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.12, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.34, "height": 1.12, "depth": 0.34, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.18, 0.62], "rotation": [0, 0, 1.5707963267948966], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "plaster"}}, "material": "plaster", "materialLayers": ["plaster"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(218, 210, 194, 1)", "materialClass": "fabric", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_cottage_awning_19.add(mesh_cottage_awning_19);
  meshes["cottage-awning"] = mesh_cottage_awning_19;
  colliders["cottage-awning"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_cottage_awning_19);

  const endpoint_cottage_chimney_20 = makeAttachmentEndpoint(null);
  const node_cottage_chimney_20 = new THREE.Group();
  node_cottage_chimney_20.name = "Masonry Chimney__pivot";
  node_cottage_chimney_20.scale.set(1, 1, 1);
  if (endpoint_cottage_chimney_20) {
    node_cottage_chimney_20.position.copy(endpoint_cottage_chimney_20.start);
    node_cottage_chimney_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cottage_chimney_20.position.set(0.32, 0.7, -0.18);
    node_cottage_chimney_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_cottage_chimney_20.userData.sculptComponent = {"id": "cottage-chimney", "name": "Masonry Chimney", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "cottage-assembly", "attachment": {"parentId": "cottage-assembly", "parentSocket": "cottage-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.48, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.22, "height": 0.48, "depth": 0.22, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.32, 0.7, -0.18], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(185, 66, 54, 1)", "materialClass": "stone", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_cottage_chimney_20.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}};
  (nodes["cottage-assembly"] ?? root).add(node_cottage_chimney_20);
  nodes["cottage-chimney"] = node_cottage_chimney_20;
  const mesh_cottage_chimney_20Geometry = endpoint_cottage_chimney_20
    ? new THREE.CylinderGeometry(endpoint_cottage_chimney_20.endRadius, endpoint_cottage_chimney_20.baseRadius, endpoint_cottage_chimney_20.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_cottage_chimney_20) {
    mesh_cottage_chimney_20Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cottage_chimney_20 = new THREE.Mesh(
    mesh_cottage_chimney_20Geometry,
    materialMap["coral-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cottage_chimney_20.name = "Masonry Chimney";
  if (endpoint_cottage_chimney_20) {
    mesh_cottage_chimney_20.position.copy(endpoint_cottage_chimney_20.midpoint);
    mesh_cottage_chimney_20.quaternion.copy(endpoint_cottage_chimney_20.quaternion);
  }
  mesh_cottage_chimney_20.castShadow = options.castShadow ?? true;
  mesh_cottage_chimney_20.receiveShadow = options.receiveShadow ?? true;
  mesh_cottage_chimney_20.userData.sculptComponent = {"id": "cottage-chimney", "name": "Masonry Chimney", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "cottage-assembly", "attachment": {"parentId": "cottage-assembly", "parentSocket": "cottage-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.48, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.22, "height": 0.48, "depth": 0.22, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.32, 0.7, -0.18], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(185, 66, 54, 1)", "materialClass": "stone", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_cottage_chimney_20.add(mesh_cottage_chimney_20);
  meshes["cottage-chimney"] = mesh_cottage_chimney_20;
  colliders["cottage-chimney"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_cottage_chimney_20);

  const endpoint_cottage_door_21 = makeAttachmentEndpoint(null);
  const node_cottage_door_21 = new THREE.Group();
  node_cottage_door_21.name = "Cottage Door__pivot";
  node_cottage_door_21.scale.set(1, 1, 1);
  if (endpoint_cottage_door_21) {
    node_cottage_door_21.position.copy(endpoint_cottage_door_21.start);
    node_cottage_door_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cottage_door_21.position.set(0.0, -0.15, 0.56);
    node_cottage_door_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_cottage_door_21.userData.sculptComponent = {"id": "cottage-door", "name": "Cottage Door", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "cottage-assembly", "attachment": {"parentId": "cottage-assembly", "parentSocket": "cottage-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.42, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.28, "height": 0.42, "depth": 0.055, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -0.15, 0.56], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}}, "material": "timber", "materialLayers": ["timber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(106, 77, 52, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_cottage_door_21.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}};
  (nodes["cottage-assembly"] ?? root).add(node_cottage_door_21);
  nodes["cottage-door"] = node_cottage_door_21;
  const mesh_cottage_door_21Geometry = endpoint_cottage_door_21
    ? new THREE.CylinderGeometry(endpoint_cottage_door_21.endRadius, endpoint_cottage_door_21.baseRadius, endpoint_cottage_door_21.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_cottage_door_21) {
    mesh_cottage_door_21Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cottage_door_21 = new THREE.Mesh(
    mesh_cottage_door_21Geometry,
    materialMap["timber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cottage_door_21.name = "Cottage Door";
  if (endpoint_cottage_door_21) {
    mesh_cottage_door_21.position.copy(endpoint_cottage_door_21.midpoint);
    mesh_cottage_door_21.quaternion.copy(endpoint_cottage_door_21.quaternion);
  }
  mesh_cottage_door_21.castShadow = options.castShadow ?? true;
  mesh_cottage_door_21.receiveShadow = options.receiveShadow ?? true;
  mesh_cottage_door_21.userData.sculptComponent = {"id": "cottage-door", "name": "Cottage Door", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "cottage-assembly", "attachment": {"parentId": "cottage-assembly", "parentSocket": "cottage-assembly-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.42, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.28, "height": 0.42, "depth": 0.055, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -0.15, 0.56], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}}, "material": "timber", "materialLayers": ["timber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(106, 77, 52, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_cottage_door_21.add(mesh_cottage_door_21);
  meshes["cottage-door"] = mesh_cottage_door_21;
  colliders["cottage-door"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_cottage_door_21);

  const endpoint_dock_walkway_22 = makeAttachmentEndpoint(null);
  const node_dock_walkway_22 = new THREE.Group();
  node_dock_walkway_22.name = "Timber Dock Walkway__pivot";
  node_dock_walkway_22.scale.set(1, 1, 1);
  if (endpoint_dock_walkway_22) {
    node_dock_walkway_22.position.copy(endpoint_dock_walkway_22.start);
    node_dock_walkway_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_dock_walkway_22.position.set(0.05, 0.25, 1.08);
    node_dock_walkway_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_dock_walkway_22.userData.sculptComponent = {"id": "dock-walkway", "name": "Timber Dock Walkway", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.12, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.88, "height": 0.12, "depth": 1.3, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.05, 0.25, 1.08], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}}, "material": "timber", "materialLayers": ["timber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "dock-planks", "type": "geometry", "description": "Closely spaced light timber planks supported on dark piles.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(136, 98, 62, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "macro"};
  node_dock_walkway_22.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}};
  (nodes["root"] ?? root).add(node_dock_walkway_22);
  nodes["dock-walkway"] = node_dock_walkway_22;
  const mesh_dock_walkway_22Geometry = endpoint_dock_walkway_22
    ? new THREE.CylinderGeometry(endpoint_dock_walkway_22.endRadius, endpoint_dock_walkway_22.baseRadius, endpoint_dock_walkway_22.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_dock_walkway_22) {
    mesh_dock_walkway_22Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_dock_walkway_22 = new THREE.Mesh(
    mesh_dock_walkway_22Geometry,
    materialMap["timber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dock_walkway_22.name = "Timber Dock Walkway";
  if (endpoint_dock_walkway_22) {
    mesh_dock_walkway_22.position.copy(endpoint_dock_walkway_22.midpoint);
    mesh_dock_walkway_22.quaternion.copy(endpoint_dock_walkway_22.quaternion);
  }
  mesh_dock_walkway_22.castShadow = options.castShadow ?? true;
  mesh_dock_walkway_22.receiveShadow = options.receiveShadow ?? true;
  mesh_dock_walkway_22.userData.sculptComponent = {"id": "dock-walkway", "name": "Timber Dock Walkway", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.12, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.88, "height": 0.12, "depth": 1.3, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.05, 0.25, 1.08], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}}, "material": "timber", "materialLayers": ["timber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "dock-planks", "type": "geometry", "description": "Closely spaced light timber planks supported on dark piles.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(136, 98, 62, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "macro"};
  node_dock_walkway_22.add(mesh_dock_walkway_22);
  meshes["dock-walkway"] = mesh_dock_walkway_22;
  colliders["dock-walkway"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_dock_walkway_22);

  const attachment_dock_post_left_23 = {"parentId": "dock-walkway", "parentSocket": "dock-walkway-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.35, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_dock_post_left_23 = makeAttachmentEndpoint(attachment_dock_post_left_23);
  const node_dock_post_left_23 = new THREE.Group();
  node_dock_post_left_23.name = "Dock Post Left__pivot";
  node_dock_post_left_23.scale.set(1, 1, 1);
  if (endpoint_dock_post_left_23) {
    node_dock_post_left_23.position.copy(endpoint_dock_post_left_23.start);
    node_dock_post_left_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_dock_post_left_23.position.set(-0.38, -0.12, 0.38);
    node_dock_post_left_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_dock_post_left_23.userData.sculptComponent = {"id": "dock-post-left", "name": "Dock Post Left", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 6}, "parent": "dock-walkway", "attachment": {"parentId": "dock-walkway", "parentSocket": "dock-walkway-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.35, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.075, "height": 0.35, "depth": 0.075, "units": "relative", "confidence": 0.88}, "transform": {"position": [-0.38, -0.12, 0.38], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}}, "material": "timber", "materialLayers": ["timber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(95, 70, 47, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_dock_post_left_23.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}};
  (nodes["dock-walkway"] ?? root).add(node_dock_post_left_23);
  nodes["dock-post-left"] = node_dock_post_left_23;
  const mesh_dock_post_left_23Geometry = endpoint_dock_post_left_23
    ? new THREE.CylinderGeometry(endpoint_dock_post_left_23.endRadius, endpoint_dock_post_left_23.baseRadius, endpoint_dock_post_left_23.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_dock_post_left_23) {
    mesh_dock_post_left_23Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_dock_post_left_23 = new THREE.Mesh(
    mesh_dock_post_left_23Geometry,
    materialMap["timber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dock_post_left_23.name = "Dock Post Left";
  if (endpoint_dock_post_left_23) {
    mesh_dock_post_left_23.position.copy(endpoint_dock_post_left_23.midpoint);
    mesh_dock_post_left_23.quaternion.copy(endpoint_dock_post_left_23.quaternion);
  }
  mesh_dock_post_left_23.castShadow = options.castShadow ?? true;
  mesh_dock_post_left_23.receiveShadow = options.receiveShadow ?? true;
  mesh_dock_post_left_23.userData.sculptComponent = {"id": "dock-post-left", "name": "Dock Post Left", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 6}, "parent": "dock-walkway", "attachment": {"parentId": "dock-walkway", "parentSocket": "dock-walkway-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.35, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.075, "height": 0.35, "depth": 0.075, "units": "relative", "confidence": 0.88}, "transform": {"position": [-0.38, -0.12, 0.38], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}}, "material": "timber", "materialLayers": ["timber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(95, 70, 47, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_dock_post_left_23.add(mesh_dock_post_left_23);
  meshes["dock-post-left"] = mesh_dock_post_left_23;
  colliders["dock-post-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_dock_post_left_23);

  const attachment_dock_post_right_24 = {"parentId": "dock-walkway", "parentSocket": "dock-walkway-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.35, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_dock_post_right_24 = makeAttachmentEndpoint(attachment_dock_post_right_24);
  const node_dock_post_right_24 = new THREE.Group();
  node_dock_post_right_24.name = "Dock Post Right__pivot";
  node_dock_post_right_24.scale.set(1, 1, 1);
  if (endpoint_dock_post_right_24) {
    node_dock_post_right_24.position.copy(endpoint_dock_post_right_24.start);
    node_dock_post_right_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_dock_post_right_24.position.set(0.38, -0.12, 0.38);
    node_dock_post_right_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_dock_post_right_24.userData.sculptComponent = {"id": "dock-post-right", "name": "Dock Post Right", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 6}, "parent": "dock-walkway", "attachment": {"parentId": "dock-walkway", "parentSocket": "dock-walkway-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.35, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.075, "height": 0.35, "depth": 0.075, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.38, -0.12, 0.38], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}}, "material": "timber", "materialLayers": ["timber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(95, 70, 47, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_dock_post_right_24.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}};
  (nodes["dock-walkway"] ?? root).add(node_dock_post_right_24);
  nodes["dock-post-right"] = node_dock_post_right_24;
  const mesh_dock_post_right_24Geometry = endpoint_dock_post_right_24
    ? new THREE.CylinderGeometry(endpoint_dock_post_right_24.endRadius, endpoint_dock_post_right_24.baseRadius, endpoint_dock_post_right_24.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_dock_post_right_24) {
    mesh_dock_post_right_24Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_dock_post_right_24 = new THREE.Mesh(
    mesh_dock_post_right_24Geometry,
    materialMap["timber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dock_post_right_24.name = "Dock Post Right";
  if (endpoint_dock_post_right_24) {
    mesh_dock_post_right_24.position.copy(endpoint_dock_post_right_24.midpoint);
    mesh_dock_post_right_24.quaternion.copy(endpoint_dock_post_right_24.quaternion);
  }
  mesh_dock_post_right_24.castShadow = options.castShadow ?? true;
  mesh_dock_post_right_24.receiveShadow = options.receiveShadow ?? true;
  mesh_dock_post_right_24.userData.sculptComponent = {"id": "dock-post-right", "name": "Dock Post Right", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 6}, "parent": "dock-walkway", "attachment": {"parentId": "dock-walkway", "parentSocket": "dock-walkway-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.35, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.075, "height": 0.35, "depth": 0.075, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.38, -0.12, 0.38], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}}, "material": "timber", "materialLayers": ["timber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(95, 70, 47, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_dock_post_right_24.add(mesh_dock_post_right_24);
  meshes["dock-post-right"] = mesh_dock_post_right_24;
  colliders["dock-post-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_dock_post_right_24);

  const endpoint_boat_hull_25 = makeAttachmentEndpoint(null);
  const node_boat_hull_25 = new THREE.Group();
  node_boat_hull_25.name = "Cream Rowboat Hull__pivot";
  node_boat_hull_25.scale.set(1, 1, 1);
  if (endpoint_boat_hull_25) {
    node_boat_hull_25.position.copy(endpoint_boat_hull_25.start);
    node_boat_hull_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_boat_hull_25.position.set(-0.95, 0.28, 1.28);
    node_boat_hull_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_boat_hull_25.userData.sculptComponent = {"id": "boat-hull", "name": "Cream Rowboat Hull", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.18, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.96, "height": 0.18, "depth": 0.36, "units": "relative", "confidence": 0.88}, "transform": {"position": [-0.95, 0.28, 1.28], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "boat-cream"}}, "material": "boat-cream", "materialLayers": ["boat-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "boat-ribs", "type": "geometry", "description": "Coral interior ribs and a thin turquoise painted waterline.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(213, 198, 170, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_boat_hull_25.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "boat-cream"}};
  (nodes["root"] ?? root).add(node_boat_hull_25);
  nodes["boat-hull"] = node_boat_hull_25;
  const mesh_boat_hull_25Geometry = endpoint_boat_hull_25
    ? new THREE.CylinderGeometry(endpoint_boat_hull_25.endRadius, endpoint_boat_hull_25.baseRadius, endpoint_boat_hull_25.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_boat_hull_25) {
    mesh_boat_hull_25Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_boat_hull_25 = new THREE.Mesh(
    mesh_boat_hull_25Geometry,
    materialMap["boat-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_boat_hull_25.name = "Cream Rowboat Hull";
  if (endpoint_boat_hull_25) {
    mesh_boat_hull_25.position.copy(endpoint_boat_hull_25.midpoint);
    mesh_boat_hull_25.quaternion.copy(endpoint_boat_hull_25.quaternion);
  }
  mesh_boat_hull_25.castShadow = options.castShadow ?? true;
  mesh_boat_hull_25.receiveShadow = options.receiveShadow ?? true;
  mesh_boat_hull_25.userData.sculptComponent = {"id": "boat-hull", "name": "Cream Rowboat Hull", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.18, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.96, "height": 0.18, "depth": 0.36, "units": "relative", "confidence": 0.88}, "transform": {"position": [-0.95, 0.28, 1.28], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "boat-cream"}}, "material": "boat-cream", "materialLayers": ["boat-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "boat-ribs", "type": "geometry", "description": "Coral interior ribs and a thin turquoise painted waterline.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(213, 198, 170, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_boat_hull_25.add(mesh_boat_hull_25);
  meshes["boat-hull"] = mesh_boat_hull_25;
  colliders["boat-hull"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_boat_hull_25);

  const attachment_boat_bow_26 = {"parentId": "boat-hull", "parentSocket": "boat-hull-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.5, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_boat_bow_26 = makeAttachmentEndpoint(attachment_boat_bow_26);
  const node_boat_bow_26 = new THREE.Group();
  node_boat_bow_26.name = "Boat Bow__pivot";
  node_boat_bow_26.scale.set(1, 1, 1);
  if (endpoint_boat_bow_26) {
    node_boat_bow_26.position.copy(endpoint_boat_bow_26.start);
    node_boat_bow_26.rotation.set(0.0, 0.0, -1.5707963267948966);
  } else {
    node_boat_bow_26.position.set(0.58, 0.0, 0.0);
    node_boat_bow_26.rotation.set(0.0, 0.0, -1.5707963267948966);
  }
  node_boat_bow_26.userData.sculptComponent = {"id": "boat-bow", "name": "Boat Bow", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 6}, "parent": "boat-hull", "attachment": {"parentId": "boat-hull", "parentSocket": "boat-hull-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.5, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.36, "height": 0.5, "depth": 0.36, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.58, 0, 0], "rotation": [0, 0, -1.5707963267948966], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "boat-cream"}}, "material": "boat-cream", "materialLayers": ["boat-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(213, 198, 170, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_boat_bow_26.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "boat-cream"}};
  (nodes["boat-hull"] ?? root).add(node_boat_bow_26);
  nodes["boat-bow"] = node_boat_bow_26;
  const mesh_boat_bow_26Geometry = endpoint_boat_bow_26
    ? new THREE.CylinderGeometry(endpoint_boat_bow_26.endRadius, endpoint_boat_bow_26.baseRadius, endpoint_boat_bow_26.length, 16, 6)
    : new THREE.ConeGeometry(0.5, 1, 24, 1);
  if (!endpoint_boat_bow_26) {
    mesh_boat_bow_26Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_boat_bow_26 = new THREE.Mesh(
    mesh_boat_bow_26Geometry,
    materialMap["boat-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_boat_bow_26.name = "Boat Bow";
  if (endpoint_boat_bow_26) {
    mesh_boat_bow_26.position.copy(endpoint_boat_bow_26.midpoint);
    mesh_boat_bow_26.quaternion.copy(endpoint_boat_bow_26.quaternion);
  }
  mesh_boat_bow_26.castShadow = options.castShadow ?? true;
  mesh_boat_bow_26.receiveShadow = options.receiveShadow ?? true;
  mesh_boat_bow_26.userData.sculptComponent = {"id": "boat-bow", "name": "Boat Bow", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 6}, "parent": "boat-hull", "attachment": {"parentId": "boat-hull", "parentSocket": "boat-hull-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.5, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.36, "height": 0.5, "depth": 0.36, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.58, 0, 0], "rotation": [0, 0, -1.5707963267948966], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "boat-cream"}}, "material": "boat-cream", "materialLayers": ["boat-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(213, 198, 170, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_boat_bow_26.add(mesh_boat_bow_26);
  meshes["boat-bow"] = mesh_boat_bow_26;
  colliders["boat-bow"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_boat_bow_26);

  const endpoint_boat_seat_27 = makeAttachmentEndpoint(null);
  const node_boat_seat_27 = new THREE.Group();
  node_boat_seat_27.name = "Boat Seat__pivot";
  node_boat_seat_27.scale.set(1, 1, 1);
  if (endpoint_boat_seat_27) {
    node_boat_seat_27.position.copy(endpoint_boat_seat_27.start);
    node_boat_seat_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_boat_seat_27.position.set(-0.08, 0.1, 0.0);
    node_boat_seat_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_boat_seat_27.userData.sculptComponent = {"id": "boat-seat", "name": "Boat Seat", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "boat-hull", "attachment": {"parentId": "boat-hull", "parentSocket": "boat-hull-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.06, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.14, "height": 0.06, "depth": 0.34, "units": "relative", "confidence": 0.88}, "transform": {"position": [-0.08, 0.1, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(185, 66, 54, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_boat_seat_27.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}};
  (nodes["boat-hull"] ?? root).add(node_boat_seat_27);
  nodes["boat-seat"] = node_boat_seat_27;
  const mesh_boat_seat_27Geometry = endpoint_boat_seat_27
    ? new THREE.CylinderGeometry(endpoint_boat_seat_27.endRadius, endpoint_boat_seat_27.baseRadius, endpoint_boat_seat_27.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_boat_seat_27) {
    mesh_boat_seat_27Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_boat_seat_27 = new THREE.Mesh(
    mesh_boat_seat_27Geometry,
    materialMap["coral-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_boat_seat_27.name = "Boat Seat";
  if (endpoint_boat_seat_27) {
    mesh_boat_seat_27.position.copy(endpoint_boat_seat_27.midpoint);
    mesh_boat_seat_27.quaternion.copy(endpoint_boat_seat_27.quaternion);
  }
  mesh_boat_seat_27.castShadow = options.castShadow ?? true;
  mesh_boat_seat_27.receiveShadow = options.receiveShadow ?? true;
  mesh_boat_seat_27.userData.sculptComponent = {"id": "boat-seat", "name": "Boat Seat", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "boat-hull", "attachment": {"parentId": "boat-hull", "parentSocket": "boat-hull-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.06, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.14, "height": 0.06, "depth": 0.34, "units": "relative", "confidence": 0.88}, "transform": {"position": [-0.08, 0.1, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "coral-paint"}}, "material": "coral-paint", "materialLayers": ["coral-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(217, 86, 67, 1)", "secondaryAlbedo": "rgba(185, 66, 54, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "coral"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_boat_seat_27.add(mesh_boat_seat_27);
  meshes["boat-seat"] = mesh_boat_seat_27;
  colliders["boat-seat"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_boat_seat_27);

  const endpoint_cliff_west_28 = makeAttachmentEndpoint(null);
  const node_cliff_west_28 = new THREE.Group();
  node_cliff_west_28.name = "West Chalk Cliff__pivot";
  node_cliff_west_28.scale.set(1, 1, 1);
  if (endpoint_cliff_west_28) {
    node_cliff_west_28.position.copy(endpoint_cliff_west_28.start);
    node_cliff_west_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cliff_west_28.position.set(-1.24, 0.18, 0.3);
    node_cliff_west_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_cliff_west_28.userData.sculptComponent = {"id": "cliff-west", "name": "West Chalk Cliff", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "none", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.72, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.72, "height": 0.72, "depth": 0.9, "units": "relative", "confidence": 0.88}, "transform": {"position": [-1.24, 0.18, 0.3], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "chalk"}}, "material": "chalk", "materialLayers": ["chalk"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(204, 215, 200, 1)", "materialClass": "stone", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_cliff_west_28.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "chalk"}};
  (nodes["root"] ?? root).add(node_cliff_west_28);
  nodes["cliff-west"] = node_cliff_west_28;
  const mesh_cliff_west_28Geometry = endpoint_cliff_west_28
    ? new THREE.CylinderGeometry(endpoint_cliff_west_28.endRadius, endpoint_cliff_west_28.baseRadius, endpoint_cliff_west_28.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_cliff_west_28) {
    mesh_cliff_west_28Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cliff_west_28 = new THREE.Mesh(
    mesh_cliff_west_28Geometry,
    materialMap["chalk"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cliff_west_28.name = "West Chalk Cliff";
  if (endpoint_cliff_west_28) {
    mesh_cliff_west_28.position.copy(endpoint_cliff_west_28.midpoint);
    mesh_cliff_west_28.quaternion.copy(endpoint_cliff_west_28.quaternion);
  }
  mesh_cliff_west_28.castShadow = options.castShadow ?? true;
  mesh_cliff_west_28.receiveShadow = options.receiveShadow ?? true;
  mesh_cliff_west_28.userData.sculptComponent = {"id": "cliff-west", "name": "West Chalk Cliff", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "none", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.72, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.72, "height": 0.72, "depth": 0.9, "units": "relative", "confidence": 0.88}, "transform": {"position": [-1.24, 0.18, 0.3], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "chalk"}}, "material": "chalk", "materialLayers": ["chalk"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(204, 215, 200, 1)", "materialClass": "stone", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_cliff_west_28.add(mesh_cliff_west_28);
  meshes["cliff-west"] = mesh_cliff_west_28;
  colliders["cliff-west"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_cliff_west_28);

  const endpoint_cliff_east_29 = makeAttachmentEndpoint(null);
  const node_cliff_east_29 = new THREE.Group();
  node_cliff_east_29.name = "East Chalk Cliff__pivot";
  node_cliff_east_29.scale.set(1, 1, 1);
  if (endpoint_cliff_east_29) {
    node_cliff_east_29.position.copy(endpoint_cliff_east_29.start);
    node_cliff_east_29.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cliff_east_29.position.set(1.28, 0.14, 0.14);
    node_cliff_east_29.rotation.set(0.0, 0.0, 0.0);
  }
  node_cliff_east_29.userData.sculptComponent = {"id": "cliff-east", "name": "East Chalk Cliff", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "none", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.58, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.64, "height": 0.58, "depth": 0.74, "units": "relative", "confidence": 0.88}, "transform": {"position": [1.28, 0.14, 0.14], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "chalk"}}, "material": "chalk", "materialLayers": ["chalk"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(204, 215, 200, 1)", "materialClass": "stone", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_cliff_east_29.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "chalk"}};
  (nodes["root"] ?? root).add(node_cliff_east_29);
  nodes["cliff-east"] = node_cliff_east_29;
  const mesh_cliff_east_29Geometry = endpoint_cliff_east_29
    ? new THREE.CylinderGeometry(endpoint_cliff_east_29.endRadius, endpoint_cliff_east_29.baseRadius, endpoint_cliff_east_29.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_cliff_east_29) {
    mesh_cliff_east_29Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cliff_east_29 = new THREE.Mesh(
    mesh_cliff_east_29Geometry,
    materialMap["chalk"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cliff_east_29.name = "East Chalk Cliff";
  if (endpoint_cliff_east_29) {
    mesh_cliff_east_29.position.copy(endpoint_cliff_east_29.midpoint);
    mesh_cliff_east_29.quaternion.copy(endpoint_cliff_east_29.quaternion);
  }
  mesh_cliff_east_29.castShadow = options.castShadow ?? true;
  mesh_cliff_east_29.receiveShadow = options.receiveShadow ?? true;
  mesh_cliff_east_29.userData.sculptComponent = {"id": "cliff-east", "name": "East Chalk Cliff", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "none", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.58, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.64, "height": 0.58, "depth": 0.74, "units": "relative", "confidence": 0.88}, "transform": {"position": [1.28, 0.14, 0.14], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "chalk"}}, "material": "chalk", "materialLayers": ["chalk"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 219, 194, 1)", "secondaryAlbedo": "rgba(204, 215, 200, 1)", "materialClass": "stone", "materialClassConfidence": 0.94, "materialFamily": "cream"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_cliff_east_29.add(mesh_cliff_east_29);
  meshes["cliff-east"] = mesh_cliff_east_29;
  colliders["cliff-east"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_cliff_east_29);

  const endpoint_tree_canopy_30 = makeAttachmentEndpoint(null);
  const node_tree_canopy_30 = new THREE.Group();
  node_tree_canopy_30.name = "Faceted Tree Canopy__pivot";
  node_tree_canopy_30.scale.set(1, 1, 1);
  if (endpoint_tree_canopy_30) {
    node_tree_canopy_30.position.copy(endpoint_tree_canopy_30.start);
    node_tree_canopy_30.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tree_canopy_30.position.set(0.62, 1.02, -0.52);
    node_tree_canopy_30.rotation.set(0.0, 0.0, 0.0);
  }
  node_tree_canopy_30.userData.sculptComponent = {"id": "tree-canopy", "name": "Faceted Tree Canopy", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "none", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.54, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.52, "height": 0.54, "depth": 0.52, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.62, 1.02, -0.52], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "foliage"}}, "material": "foliage", "materialLayers": ["foliage"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tree-clusters", "type": "geometry", "description": "Irregular low-poly tree crowns placed around cottage and tower terrace.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(105, 181, 72, 1)", "secondaryAlbedo": "rgba(44, 125, 67, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "green"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_tree_canopy_30.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "foliage"}};
  (nodes["root"] ?? root).add(node_tree_canopy_30);
  nodes["tree-canopy"] = node_tree_canopy_30;
  const mesh_tree_canopy_30Geometry = endpoint_tree_canopy_30
    ? new THREE.CylinderGeometry(endpoint_tree_canopy_30.endRadius, endpoint_tree_canopy_30.baseRadius, endpoint_tree_canopy_30.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_tree_canopy_30) {
    mesh_tree_canopy_30Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tree_canopy_30 = new THREE.Mesh(
    mesh_tree_canopy_30Geometry,
    materialMap["foliage"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tree_canopy_30.name = "Faceted Tree Canopy";
  if (endpoint_tree_canopy_30) {
    mesh_tree_canopy_30.position.copy(endpoint_tree_canopy_30.midpoint);
    mesh_tree_canopy_30.quaternion.copy(endpoint_tree_canopy_30.quaternion);
  }
  mesh_tree_canopy_30.castShadow = options.castShadow ?? true;
  mesh_tree_canopy_30.receiveShadow = options.receiveShadow ?? true;
  mesh_tree_canopy_30.userData.sculptComponent = {"id": "tree-canopy", "name": "Faceted Tree Canopy", "level": "meso", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "none", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 12}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.54, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.52, "height": 0.54, "depth": 0.52, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.62, 1.02, -0.52], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "foliage"}}, "material": "foliage", "materialLayers": ["foliage"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tree-clusters", "type": "geometry", "description": "Irregular low-poly tree crowns placed around cottage and tower terrace.", "confidence": 0.9}], "colorMaterialRecipe": {"dominantAlbedo": "rgba(105, 181, 72, 1)", "secondaryAlbedo": "rgba(44, 125, 67, 1)", "materialClass": "plastic", "materialClassConfidence": 0.94, "materialFamily": "green"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "meso"};
  node_tree_canopy_30.add(mesh_tree_canopy_30);
  meshes["tree-canopy"] = mesh_tree_canopy_30;
  colliders["tree-canopy"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_tree_canopy_30);

  const attachment_tree_trunk_31 = {"parentId": "tree-canopy", "parentSocket": "tree-canopy-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.55, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]};
  const endpoint_tree_trunk_31 = makeAttachmentEndpoint(attachment_tree_trunk_31);
  const node_tree_trunk_31 = new THREE.Group();
  node_tree_trunk_31.name = "Tree Trunk__pivot";
  node_tree_trunk_31.scale.set(1, 1, 1);
  if (endpoint_tree_trunk_31) {
    node_tree_trunk_31.position.copy(endpoint_tree_trunk_31.start);
    node_tree_trunk_31.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tree_trunk_31.position.set(0.0, -0.35, 0.0);
    node_tree_trunk_31.rotation.set(0.0, 0.0, 0.0);
  }
  node_tree_trunk_31.userData.sculptComponent = {"id": "tree-trunk", "name": "Tree Trunk", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 6}, "parent": "tree-canopy", "attachment": {"parentId": "tree-canopy", "parentSocket": "tree-canopy-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.55, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.09, "height": 0.55, "depth": 0.09, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -0.35, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}}, "material": "timber", "materialLayers": ["timber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(78, 57, 40, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_tree_trunk_31.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}};
  (nodes["tree-canopy"] ?? root).add(node_tree_trunk_31);
  nodes["tree-trunk"] = node_tree_trunk_31;
  const mesh_tree_trunk_31Geometry = endpoint_tree_trunk_31
    ? new THREE.CylinderGeometry(endpoint_tree_trunk_31.endRadius, endpoint_tree_trunk_31.baseRadius, endpoint_tree_trunk_31.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_tree_trunk_31) {
    mesh_tree_trunk_31Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tree_trunk_31 = new THREE.Mesh(
    mesh_tree_trunk_31Geometry,
    materialMap["timber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tree_trunk_31.name = "Tree Trunk";
  if (endpoint_tree_trunk_31) {
    mesh_tree_trunk_31.position.copy(endpoint_tree_trunk_31.midpoint);
    mesh_tree_trunk_31.quaternion.copy(endpoint_tree_trunk_31.quaternion);
  }
  mesh_tree_trunk_31.castShadow = options.castShadow ?? true;
  mesh_tree_trunk_31.receiveShadow = options.receiveShadow ?? true;
  mesh_tree_trunk_31.userData.sculptComponent = {"id": "tree-trunk", "name": "Tree Trunk", "level": "micro", "role": "static-part", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Built from discrete low-poly solid parts with explicit contact seams; geometry follows the visible architectural blockout.", "geometryDescriptor": {"topologyIntent": "game-ready low-poly architectural assembly", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat-shaded vertex normals from generated geometry", "segments": 6}, "parent": "tree-canopy", "attachment": {"parentId": "tree-canopy", "parentSocket": "tree-canopy-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.55, 0], "contactNormal": [0, 1, 0], "contactType": "overlap", "overlap": 0.035, "gapTolerance": 0.006, "evidenceRefs": ["front-3q", "top-view"]}, "dimensions": {"width": 0.09, "height": 0.55, "depth": 0.09, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -0.35, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "static-part", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "timber"}}, "material": "timber", "materialLayers": ["timber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "colorMaterialRecipe": {"dominantAlbedo": "rgba(40, 114, 151, 1)", "secondaryAlbedo": "rgba(78, 57, 40, 1)", "materialClass": "wood", "materialClassConfidence": 0.94, "materialFamily": "dark"}, "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.05, "bumpAmplitude": 0, "normalPattern": "faceted procedural normals", "displacementPattern": "none", "occlusionPattern": "contact cavities beneath overlaps", "edgeWearPattern": "none", "notes": "Textureless faceted low-poly treatment."}, "evidenceRefs": ["front-3q", "top-view"], "details": [], "fidelityTier": "micro"};
  node_tree_trunk_31.add(mesh_tree_trunk_31);
  meshes["tree-trunk"] = mesh_tree_trunk_31;
  colliders["tree-trunk"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Simplified runtime proxy; visual geometry remains separate."};
  destructionGroups["static-part"] ??= [];
  destructionGroups["static-part"].push(node_tree_trunk_31);

  // repetition system: gallery-railing-posts (InstancedMesh, radial, count=10, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["meadow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 10);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 10; i++) {
      const ang = ((0.0) + (i * 360) / 10) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "gallery-railing-posts";
    parent.add(cluster);
  }

  // repetition system: dock-plank-repetition (InstancedMesh, radial, count=8, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["meadow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 8);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 8; i++) {
      const ang = ((0.0) + (i * 360) / 8) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "dock-plank-repetition";
    parent.add(cluster);
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "stylized-code-native", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createAzureIsleLighthouseIslandLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Azure Isle Lighthouse Island look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"role": "key", "direction": "upper-left to lower-right", "color": "warm white", "intensity": 1.1, "observation": "Facets facing upper-left are brighter and cast short grounded shadows."}, {"role": "fill", "direction": "camera-right", "color": "cool sky teal", "intensity": 0.28, "observation": "Shadow sides keep readable cool values without crushing."}, {"role": "environment", "toneMapping": "ACES-like neutral tone mapping", "exposure": "0.85-0.95", "contactShadow": "Soft ambient contact shadow beneath island base and dock piles.", "background": "Muted olive-green tabletop environment"}];
  lights.userData.lookDevTargets = {"qualityPriority": "stylized-code-native", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createAzureIsleLighthouseIslandEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameAzureIsleLighthouseIslandCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createAzureIsleLighthouseIslandPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureAzureIsleLighthouseIslandRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createAzureIsleLighthouseIslandInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
