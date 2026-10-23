import { loadSerialWasm, loadThreadedWasm, supportsSIMD } from '../engine/wasm';
import { SOLVER_REVISION } from '../engine/model';
import type { Input, Schemas } from '../api/client';

export type RuntimeStart = {
  type: 'start';
  input: Input;
  settings: Schemas['Settings'];
  threads: number;
};

// Runs one job with open-source sparrow; the coordinator owns this worker and the thread pool.
self.onmessage = async ({ data }: MessageEvent<RuntimeStart>) => {
  if (data.type !== 'start') return;
  try {
    const threaded = data.threads > 1;
    const wasm = threaded ? await loadThreadedWasm() : await loadSerialWasm();
    await wasm.default();
    if (threaded)
      await (wasm as Awaited<ReturnType<typeof loadThreadedWasm>>).initThreadPool(data.threads);
    const build = `${threaded ? 'threaded' : 'serial'}-${supportsSIMD ? 'simd' : 'nosimd'}`;
    self.postMessage({
      type: 'ready',
      threads: wasm.thread_count(),
      engine: {
        version: `sparrow ${SOLVER_REVISION.slice(0, 7)}`,
        build_id: `${SOLVER_REVISION}-${build}`,
      },
    });
    const { time_limit_seconds, auto_termination, seed } = data.settings;
    wasm.run_job(
      JSON.stringify(data.input),
      time_limit_seconds,
      auto_termination,
      seed,
      (json: string) => self.postMessage(JSON.parse(json)),
    );
  } catch (error) {
    // run_job fails with the API's job error as JSON; anything else is the browser's.
    try {
      const { code, message } = JSON.parse(String(error));
      self.postMessage({ type: 'failed', code, message });
    } catch {
      self.postMessage({ type: 'failed', code: 'internal_error', message: String(error) });
    }
  }
};
