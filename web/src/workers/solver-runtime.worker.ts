import type { Start, SolverMessage } from './protocol';
import { normalizeDocument } from '../geometry/normalize';
import { solverInput } from '../import/sparrow';

self.onmessage = async ({ data }: MessageEvent<Start>) => {
  if (data.type !== 'start' && data.type !== 'bridge') return;
  const { runId, documentRevision } = data;
  const send = (message: object) => self.postMessage({ ...message, runId, documentRevision });
  try {
    let wasm: Pick<typeof import('../../wasm/pkg/sparrow_web'), 'run' | 'thread_count'>;
    if (data.threads && data.threads > 1) {
      const threaded = await import('../../wasm/pkg-threads/sparrow_web');
      await threaded.default();
      await threaded.initThreadPool(data.threads);
      wasm = threaded;
    } else {
      const serial = await import('../../wasm/pkg/sparrow_web');
      await serial.default();
      wasm = serial;
    }
    send({ type: 'ready', threads: wasm.thread_count() });
    const doc=data.type==='start'?normalizeDocument(data.document):null;
    const input=doc?solverInput(doc):(data as Extract<Start,{type:'bridge'}>).input;
    wasm.run(input, data.type==='bridge'?data.seconds:doc!.settings.timeLimitSeconds??undefined, data.seed, doc?.settings.clearanceMm ?? 0, (json: string) => {
      const message = JSON.parse(json) as SolverMessage;
      send(message);
    });
  } catch (error) {
    send({ type: 'error', message: String(error) });
  }
};
