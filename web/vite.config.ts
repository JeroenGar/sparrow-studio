import { defineConfig } from 'vite';
export default defineConfig({base:'./',optimizeDeps:{include:['dxf/lib/parseString','dxf/lib/util/bSpline']},worker:{format:'es'},preview:{headers:{}},server:{headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}},build:{rollupOptions:{input:{app:'index.html',bridge:'bridge.html'}}}});
