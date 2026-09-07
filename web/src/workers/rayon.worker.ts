import { loadThreadedWasm } from '../wasm';

self.onmessage = async ({ data }) => {
  self.onmessage = null;
  try {
    const wasm = await loadThreadedWasm();
    await wasm.default(data.init);
    self.postMessage({ type: 'ready' });
    wasm.wbg_rayon_start_worker(data.receiver);
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) });
  }
};
