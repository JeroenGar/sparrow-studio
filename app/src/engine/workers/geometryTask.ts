import type { GeometryReply, GeometryRequest } from './protocol';

export function geometryTask(request: GeometryRequest): Promise<GeometryReply> {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./geometry.worker.ts',import.meta.url),{type:'module'});
    const timeout=setTimeout(()=>done(undefined,Error('Geometry work exceeded 30 seconds. Use fewer vertices or a coarser approximation.')),30_000);
    function done(reply?:GeometryReply,error?:Error) {
      clearTimeout(timeout); worker.terminate();
      if(error) reject(error); else resolve(reply!);
    }
    worker.onmessage=({data}:MessageEvent<GeometryReply>)=>{
      if(data.runId!==request.runId || data.documentRevision!==request.documentRevision) return;
      done(data,data.type==='error'?Error(data.message):undefined);
    };
    worker.onerror=e=>done(undefined,Error(e.message));
    worker.postMessage(request);
  });
}
