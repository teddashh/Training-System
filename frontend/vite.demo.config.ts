import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(async () => {
  // Set before loading the shared resolver, regardless of the caller's brand selection.
  process.env.BRAND = 'default';
  const { brandAlias, brandHtml } = await import('../shared/brand/build');
  const base = process.env.DEMO_BASE || '/Training-System/demo/';
  if (!base.startsWith('/') || !base.endsWith('/') || base.startsWith('//')) throw new Error('DEMO_BASE must be an absolute path ending in /.');
  return {
    root: fileURLToPath(new URL('./demo/', import.meta.url)),
    envDir: fileURLToPath(new URL('./demo/', import.meta.url)),
    publicDir: fileURLToPath(new URL('./public/', import.meta.url)),
    base,
    resolve: { alias: brandAlias },
    plugins: [brandHtml, react(), {
      name: 'demo-redirect',
      generateBundle() { this.emitFile({ type: 'asset', fileName: 'redirect.js', source: readFileSync(new URL('./demo/redirect.js', import.meta.url), 'utf8') }); },
    }],
    build: {
      outDir: fileURLToPath(new URL('./dist-demo/', import.meta.url)), emptyOutDir: true,
      rollupOptions: { input: { index: fileURLToPath(new URL('./demo/index.html', import.meta.url)), scorm: fileURLToPath(new URL('./demo/scorm.html', import.meta.url)) } },
    },
  };
});
