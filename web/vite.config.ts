import { defineConfig } from 'vite';
export default defineConfig({base:'./',worker:{format:'es'},preview:{headers:{}},server:{headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}},build:{rollupOptions:{input:{app:'index.html',bridge:'bridge.html'}}}});
