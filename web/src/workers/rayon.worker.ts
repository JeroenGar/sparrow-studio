import init, { wbg_rayon_start_worker } from '../../wasm/pkg-threads/sparrow_web';

self.onmessage = async ({ data }) => {
  self.onmessage = null;
  try {
    await init(data.init);
    self.postMessage({ type: 'ready' });
    wbg_rayon_start_worker(data.receiver);
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) });
  }
};
