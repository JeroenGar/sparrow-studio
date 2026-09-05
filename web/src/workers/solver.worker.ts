import type { Start, SolverMessage } from './protocol';

type PoolInit = { type: 'pool-init'; threads: number; init: { module_or_path: WebAssembly.Module; memory: WebAssembly.Memory }; receiver: number };
let dispose = () => {};

// Keep this coordinator idle: it owns every runtime and pool worker, and can
// terminate them even while the solver is blocked in synchronous WASM.
self.onmessage = ({ data }: MessageEvent<Start | { type: 'stop' }>) => {
  if (data.type === 'stop') { dispose(); self.close(); return; }
  const requested = data.threads ?? Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
  const threads = self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined' ? requested : 1;
  if (!Number.isInteger(requested) || requested < 1 || requested > 3) {
    self.postMessage({ type: 'error', runId: data.runId, documentRevision: data.documentRevision, message: 'Choose 1–3 solver threads.' });
    return;
  }
  const start = data;
  function launch(count: number, fallbackReason?: string) {
    const runtime = new Worker(new URL('./solver-runtime.worker.ts', import.meta.url), { type: 'module' });
    const pool: Worker[] = [];
    let ready = false, closed = false;
    dispose = () => { closed = true; clearTimeout(timer); runtime.terminate(); pool.forEach(worker => worker.terminate()); };
    const fail = (message: string) => {
      if (closed) return;
      dispose();
      if (!ready && count > 1) launch(1, message);
      else self.postMessage({ type: 'error', runId: start.runId, documentRevision: start.documentRevision, message });
    };
    const timer = setTimeout(() => fail('Thread initialization timed out.'), count > 1 ? 8000 : 6000);
    runtime.onmessage = ({ data: message }: MessageEvent<SolverMessage | PoolInit>) => {
      if (closed) return;
      if (message.type === 'pool-init') {
        if (pool.length || message.threads !== count) { fail('Invalid thread pool initialization.'); return; }
        let initialized = 0;
        try {
        for (let i = 0; i < count; i++) {
          const worker = new Worker(new URL('./rayon.worker.ts', import.meta.url), { type: 'module' });
          pool.push(worker);
          worker.onmessage = ({ data }) => {
            if (closed) return;
            if (data.type === 'error') fail(data.message);
            else if (data.type === 'ready' && ++initialized === count) runtime.postMessage({ type: 'pool-ready' });
          };
          worker.onerror = event => { event.preventDefault(); fail(event.message || 'A solver thread failed.'); };
          worker.postMessage(message);
        }
        } catch (error) { fail(String(error)); }
        return;
      }
      if (message.type === 'error') { fail(message.message); return; }
      if (message.type === 'ready') { ready = true; clearTimeout(timer); }
      self.postMessage(message.type === 'ready' ? { ...message, fallbackReason } : message);
    };
    runtime.onerror = event => { event.preventDefault(); fail(event.message || 'The solver runtime failed.'); };
    runtime.postMessage({ ...start, threads: count });
  }
  dispose();
  launch(threads);
};
