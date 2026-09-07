import { loadSerialWasm, loadThreadedWasm, supportsSIMD, type SolverBinary } from '../wasm';
import type { Start, SolverMessage } from './protocol';
import { normalizeDocument } from '../geometry/normalize';
import { solverInput } from '../import/sparrow';

self.onmessage = async ({ data }: MessageEvent<Start | {type:'preload';threads:number}>) => {
  if (data.type !== 'start' && data.type !== 'bridge' && data.type !== 'preload') return;
  const { runId, documentRevision } = data.type==='preload'?{runId:0,documentRevision:0}:data;
  const send = (message: object) => self.postMessage({ ...message, runId, documentRevision });
  try {
    let wasm: Pick<typeof import('../../wasm/pkg/sparrow_web'), 'run' | 'thread_count'>;
    if (data.threads && data.threads > 1) {
      const threaded = await loadThreadedWasm();
      await threaded.default();
      if(data.type!=='preload')await threaded.initThreadPool(data.threads);
      wasm = threaded;
    } else {
      const serial = await loadSerialWasm();
      await serial.default();
      wasm = serial;
    }
    // Download and compile off the UI thread; actual runs still own fresh workers.
    if(data.type==='preload'){self.postMessage({type:'preloaded'});self.close();return;}
    const solverBinary: SolverBinary = `${data.threads && data.threads > 1 ? 'threaded' : 'serial'}-${supportsSIMD ? 'simd' : 'nosimd'}`;
    send({ type: 'ready', threads: wasm.thread_count(), solverBinary, simd: supportsSIMD });
    const doc=data.type==='start'?normalizeDocument(data.document):null;
    const input=doc?solverInput(doc):(data as Extract<Start,{type:'bridge'}>).input;
    wasm.run(input, data.type==='bridge'?data.seconds:doc!.settings.timeLimitSeconds??undefined, data.seed, doc?.settings.clearanceMm ?? 0, doc?.settings.solverPreset??'standard', (json: string) => {
      const message = JSON.parse(json) as SolverMessage;
      send(message);
    });
  } catch (error) {
    send({ type: 'error', message: String(error) });
    if(data.type==='preload')self.close();
  }
};
