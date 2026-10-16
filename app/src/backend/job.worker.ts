import type { RuntimeStart } from './job-runtime.worker';

type PoolInit = {
  type: 'pool-init';
  threads: number;
  init: { module_or_path: WebAssembly.Module; memory: WebAssembly.Memory };
  receiver: number;
};

let dispose = () => {};

// Coordinates one job: it owns the runtime and its thread pool, and stays idle itself, so it can
// end them at once even while the solver is busy in WebAssembly. Without shared memory, or when
// the pool cannot start, the job runs on one thread and says why.
self.onmessage = ({ data }: MessageEvent<RuntimeStart | { type: 'stop' }>) => {
  if (data.type === 'stop') {
    dispose();
    self.close();
    return;
  }
  const start = data;
  const shared = self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
  function launch(threads: number, fallbackReason?: string) {
    const runtime = new Worker(new URL('./job-runtime.worker.ts', import.meta.url), {
      type: 'module',
    });
    const pool: Worker[] = [];
    let ready = false;
    let closed = false;
    dispose = () => {
      closed = true;
      clearTimeout(timer);
      runtime.terminate();
      pool.forEach((worker) => worker.terminate());
    };
    const fail = (message: string) => {
      if (closed) return;
      dispose();
      if (!ready && threads > 1) launch(1, message);
      else self.postMessage({ type: 'failed', code: 'internal_error', message });
    };
    const timer = setTimeout(
      () => fail('The solver threads did not start in time.'),
      threads > 1 ? 8000 : 6000,
    );
    runtime.onmessage = ({ data: message }: MessageEvent<PoolInit | { type: string }>) => {
      if (closed) return;
      if (message.type === 'pool-init') {
        const init = message as PoolInit;
        let started = 0;
        try {
          for (let i = 0; i < init.threads; i++) {
            const worker = new Worker(
              new URL('../engine/workers/rayon.worker.ts', import.meta.url),
              { type: 'module' },
            );
            pool.push(worker);
            worker.onmessage = ({ data }) => {
              if (closed) return;
              if (data.type === 'error') fail(data.message);
              else if (data.type === 'ready' && ++started === init.threads)
                runtime.postMessage({ type: 'pool-ready' });
            };
            worker.onerror = (event) => {
              event.preventDefault();
              fail(event.message || 'A solver thread failed.');
            };
            worker.postMessage(init);
          }
        } catch (error) {
          fail(String(error));
        }
        return;
      }
      if (message.type === 'ready') {
        ready = true;
        clearTimeout(timer);
        self.postMessage({ ...message, fallbackReason });
        return;
      }
      // A failure before the solver is ready may be the threads'; one thread may still work.
      if (message.type === 'failed' && !ready) {
        fail((message as { message?: string }).message ?? 'The solver could not start.');
        return;
      }
      self.postMessage(message);
      // A job's last message ends its workers.
      if (message.type === 'finished' || message.type === 'failed') {
        dispose();
        self.close();
      }
    };
    runtime.onerror = (event) => {
      event.preventDefault();
      fail(event.message || 'The solver failed.');
    };
    runtime.postMessage({ ...start, threads } satisfies RuntimeStart);
  }
  if (shared) launch(start.threads);
  else
    launch(1, 'This page cannot share memory between threads, so the solver runs on one thread.');
};
