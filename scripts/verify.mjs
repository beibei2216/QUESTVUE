import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const buildDir = resolve('html');
const files = readdirSync(buildDir);
const html = readFileSync(resolve(buildDir, 'index.html'), 'utf8');
const scriptMatches = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
const styleMatches = Array.from(html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi));
const errors = [];
const allowedEntries = ['index.html', 'models', 'media'];
const unexpectedEntries = files.filter(function (entry) {
  return !allowedEntries.includes(entry);
});

if (!files.includes('index.html')) {
  errors.push('html must contain index.html');
}

if (unexpectedEntries.length > 0) {
  errors.push('html contains unexpected entries: ' + unexpectedEntries.join(', '));
}

if (scriptMatches.length !== 1) {
  errors.push('html must contain exactly one inline script');
}

if (styleMatches.length !== 1) {
  errors.push('html must contain exactly one inline stylesheet');
}

if (/type=["']module["']/i.test(html) || /<script\b[^>]*\bsrc=/i.test(html)) {
  errors.push('script must be classic and inline');
}

if (/<link\b[^>]*rel=["']stylesheet["']/i.test(html)) {
  errors.push('stylesheet must be inline');
}

if (scriptMatches.length === 1) {
  const attributes = scriptMatches[0][1].trim();
  const source = scriptMatches[0][2];

  if (attributes.length > 0) {
    errors.push('inline script should not carry module or src attributes');
  }

  try {
    new Function(source);
  } catch (error) {
    errors.push('classic script parse failed: ' + error.message);
  }

  if (/\?\.[A-Za-z_$]/.test(source)) {
    errors.push('optional chaining is present');
  }

  if (/\?\?/.test(source)) {
    errors.push('nullish coalescing is present');
  }

  if (/\bimport\s*\(|\bexport\s+|\bimport\s+/.test(source)) {
    errors.push('module syntax is present');
  }

  if (/ResizeObserver|IntersectionObserver/.test(source)) {
    errors.push('post-Chrome-61 observer API is present');
  }
}

const result = {
  files: files,
  bytes: Buffer.byteLength(html),
  scripts: scriptMatches.length,
  styles: styleMatches.length,
  classicScript: errors.length === 0,
  target: 'Chrome 61 / ES2017',
  errors: errors
};

if (files.includes('models')) {
  const modelDir = resolve(buildDir, 'models');
  const modelFiles = readdirSync(modelDir);
  const expectedModels = [
    'island-house-boat-candidate.glb',
    'island-house.glb',
    'lighthouse-cottage.glb',
    'island-market-no-base.glb',
    'coconut-palm.glb',
    'ice-cream-truck.glb',
    'stone-fountain.glb',
    'coastal-cabin.glb',
    'wood-cabin.glb',
    'blue-house.glb',
    'fishing-boat.glb',
    'pink-shop.glb',
    'island-cabin-99999.glb',
    'island-cabin-444444.glb',
    'windmill-cottage.glb'
  ];
  if (
    modelFiles.length !== expectedModels.length ||
    expectedModels.some(function (file) {
      return !modelFiles.includes(file);
    })
  ) {
    errors.push('html/models must contain: ' + expectedModels.join(', '));
  }

  result.models = expectedModels.map(function (file) {
    const path = resolve(modelDir, file);
    const model = modelFiles.includes(file) ? readFileSync(path) : null;
    const binaryGlTF = Boolean(model && model.toString('ascii', 0, 4) === 'glTF');
    if (model && !binaryGlTF) {
      errors.push(file + ' is not a valid binary glTF file');
    }
    return {
      file: 'models/' + file,
      bytes: model ? model.length : 0,
      binaryGlTF: binaryGlTF
    };
  });
} else {
  errors.push('html/models is missing');
}

if (files.includes('media')) {
  const mediaDir = resolve(buildDir, 'media');
  const mediaFiles = readdirSync(mediaDir);
  const expectedMedia = [
    'jungle-start.png',
    'jungle-loading.mp4',
    'tidal-fishing-port.png',
    'tidal-fishing-port-snapshot-cover.png',
    'tidal-fishing-port-snapshot-ended.png',
    'tidal-fishing-port-snapshot.mp4',
    'photo-wall-star-spring-square.jpg',
    'photo-wall-watchlight-beacon.jpg',
    'photo-wall-springside-cabin.jpg',
    'photo-wall-clearbrook-haven.jpg',
    'photo-wall-bluecove-residence.jpg',
    'photo-wall-redsail-hut.jpg',
    'photo-wall-gullhaven-wharf.jpg',
    'photo-wall-fengxin-wanchang.jpg',
    'photo-wall-pinkshore-boutique.jpg',
    'photo-wall-tidal-fishing-port.jpg',
    'photo-wall-selfie-lighthouse-pier.jpg',
    'photo-wall-selfie-lighthouse-upward.jpg',
    'photo-wall-selfie-sunset-island.jpg',
    'photo-wall-selfie-ear-squeeze.jpg',
    'photo-wall-selfie-girl-dog.jpg',
    'photo-wall-selfie-shoulder-back.jpg',
    'photo-wall-selfie-cheek-lean.jpg',
    'photo-wall-selfie-shop-lie.jpg',
    'photo-wall-selfie-arm-leg-up.jpg',
    'photo-wall-selfie-seated-arms-wide.jpg',
    'windbell-market.jpg',
    'windbell-market-snapshot-cover.png',
    'windbell-market-snapshot-ended.png',
    'windbell-market-snapshot.mp4',
    'star-spring-square.jpg',
    'star-spring-square-snapshot-cover.png',
    'star-spring-square-snapshot-ended.png',
    'star-spring-square-snapshot.mp4',
    'gullhaven-wharf.jpg',
    'gullhaven-wharf-snapshot-cover.png',
    'gullhaven-wharf-snapshot-ended.png',
    'gullhaven-wharf-snapshot.mp4',
    'watchlight-beacon.jpg',
    'watchlight-beacon-snapshot-cover.png',
    'watchlight-beacon-snapshot-ended.png',
    'watchlight-beacon-snapshot.mp4',
    'springside-cabin.jpg',
    'springside-cabin-snapshot-cover.png',
    'springside-cabin-snapshot-ended.png',
    'springside-cabin-snapshot.mp4',
    'redsail-hut.jpg',
    'redsail-hut-snapshot-cover.png',
    'redsail-hut-snapshot-ended.png',
    'redsail-hut-snapshot.mp4',
    'clearbrook-haven.jpg',
    'clearbrook-haven-snapshot-cover.png',
    'clearbrook-haven-snapshot-ended.png',
    'clearbrook-haven-snapshot.mp4',
    'pinkshore-boutique.jpg',
    'pinkshore-boutique-snapshot-cover.png',
    'pinkshore-boutique-snapshot-ended.png',
    'pinkshore-boutique-snapshot.mp4',
    'bluecove-residence.jpg',
    'bluecove-residence-snapshot-cover.png',
    'bluecove-residence-snapshot-ended.png',
    'bluecove-residence-snapshot.mp4'
  ];
  if (
    mediaFiles.length !== expectedMedia.length ||
    expectedMedia.some(function (file) {
      return !mediaFiles.includes(file);
    })
  ) {
      errors.push('html/media must contain: ' + expectedMedia.join(', '));
  }

  result.media = expectedMedia.map(function (file) {
    const path = resolve(mediaDir, file);
    const media = mediaFiles.includes(file) ? readFileSync(path) : null;
    const isPng = Boolean(
      media &&
        media[0] === 0x89 &&
        media.toString('ascii', 1, 4) === 'PNG'
    );
    const isJpeg = Boolean(
      media &&
        media[0] === 0xff &&
        media[1] === 0xd8 &&
        media[2] === 0xff
    );
    const isMp4 = Boolean(media && media.toString('ascii', 4, 8) === 'ftyp');
    const validSignature = file.endsWith('.png')
      ? isPng
      : file.endsWith('.jpg') || file.endsWith('.jpeg')
        ? isJpeg
        : isMp4;
    if (media && !validSignature) {
      errors.push(file + ' has an invalid media signature');
    }
    return {
      file: 'media/' + file,
      bytes: media ? media.length : 0,
      validSignature: validSignature
    };
  });
} else {
  errors.push('html/media is missing');
}

process.stdout.write(JSON.stringify(result, null, 2) + '\n');

if (errors.length > 0) {
  process.exit(1);
}
