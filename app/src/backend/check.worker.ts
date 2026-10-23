import { loadSerialWasm } from '../engine/wasm';

// Checks one job input with the same code that runs it.
self.onmessage = async ({ data }: MessageEvent<{ input: unknown }>) => {
  try {
    const wasm = await loadSerialWasm();
    await wasm.default();
    self.postMessage({ refusal: JSON.parse(wasm.check_job(JSON.stringify(data.input))) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
