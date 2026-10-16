import { THREADS, type Engine } from './local';

/** Open-source sparrow in the browser's workers. */
export const browserEngine: Engine = {
  check: (input) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./check.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        worker.terminate();
        if ('error' in data) reject(new Error(data.error));
        else resolve(data.refusal);
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message || 'The input could not be checked.'));
      };
      worker.postMessage({ input });
    }),

  run(input, settings, report) {
    const worker = new Worker(new URL('./job.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => report(data);
    worker.onerror = (event) =>
      report({
        type: 'failed',
        code: 'internal_error',
        message: event.message || 'The solver could not start.',
      });
    worker.postMessage({ type: 'start', input, settings, threads: THREADS });
    return {
      stop() {
        worker.postMessage({ type: 'stop' });
        // The coordinator ends its workers and closes; terminating it too covers a stuck one.
        setTimeout(() => worker.terminate(), 1000);
      },
    };
  },
};
