import { build, createServer, preview } from 'vite';
import { resolve } from 'node:path';
import config from '../vite.config.js';

const command = process.argv[2];
const root = resolve('.');
const projectConfig = {
  ...config,
  configFile: false,
  root
};

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

if (command === 'build') {
  await build(projectConfig);
} else if (command === 'dev') {
  const server = await createServer({
    ...projectConfig,
    server: {
      host: option('--host', '127.0.0.1'),
      port: Number(option('--port', '5173')),
      strictPort: hasFlag('--strictPort')
    }
  });
  await server.listen();
  server.printUrls();
} else if (command === 'preview') {
  const server = await preview({
    ...projectConfig,
    preview: {
      host: option('--host', '127.0.0.1'),
      port: Number(option('--port', '4173')),
      strictPort: hasFlag('--strictPort')
    }
  });
  server.printUrls();
} else {
  throw new Error('Usage: node scripts/vite.mjs <dev|build|preview>');
}
