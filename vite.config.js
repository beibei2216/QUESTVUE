import { defineConfig } from 'vite';

function inlineClassicBundle() {
  return {
    name: 'inline-classic-bundle',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const htmlAsset = bundle['index.html'];
      let javascript = '';
      let styles = '';

      if (!htmlAsset) return;

      Object.keys(bundle).forEach((key) => {
        const item = bundle[key];

        if (item.type === 'chunk' && /\.js$/.test(item.fileName)) {
          javascript += item.code;
          delete bundle[key];
        }

        if (item.type === 'asset' && /\.css$/.test(item.fileName)) {
          styles += String(item.source);
          delete bundle[key];
        }
      });

      let html = String(htmlAsset.source);
      html = html.replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/gi, '');
      html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/gi, '');
      html = html.replace('</head>', function () {
        return '<style>' + styles + '</style></head>';
      });
      html = html.replace('</body>', function () {
        return '<script>' + javascript.replace(/<\/script/gi, '<\\/script') + '</script></body>';
      });
      htmlAsset.source = html;
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [inlineClassicBundle()],
  esbuild: {
    target: 'chrome61'
  },
  build: {
    target: 'chrome61',
    minify: 'esbuild',
    outDir: 'html',
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    modulePreload: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        format: 'iife',
        name: 'AzureAdventure',
        inlineDynamicImports: true,
        entryFileNames: 'azure-adventure.js',
        assetFileNames: 'azure-adventure.[ext]'
      }
    }
  }
});
