import { defineConfig } from 'vite';

const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  base: './',
  optimizeDeps: { include: ['dxf/lib/parseString', 'dxf/lib/util/bSpline'] },
  worker: { format: 'es' },
  // The WASM solver is built once, in ../web/wasm, and shared with the current app.
  server: { headers: isolation, fs: { allow: ['..'] } },
  preview: { headers: isolation },
});
