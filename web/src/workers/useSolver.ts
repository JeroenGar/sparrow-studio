import { useEffect, useRef, useState } from 'react';
import { SOLVER_REVISION, type Document, type Result } from '../model';
import type { Candidate, GeometryReply, SolverMessage } from './protocol';
import type {LiveGeometry} from '../geometry/live';

export type RunState='Ready'|'Initializing'|'Running'|'Checking'|'Complete'|'Stopped'|'Error';
export type Timing={sequence:number;elapsedMs:number;lengthMm:number;validation?:string;validationMs?:number;errors?:string[]};
export type Diagnostics={solverRevision:string;seed:string;buildMode:string;initializationMs?:number;stopReason?:string;history:Timing[];liveSnapshots?:number};
export type LiveFrame=LiveGeometry & {sequence:number;result:Result;report:string};
type Run={id:number;revision:number;doc:Document;seed:string;solver?:Worker;checker:Worker;preview:Worker;active?:{candidate:Candidate;result:Result};
  latest?:Candidate;previewActive?:{candidate:Candidate;result:Result};frame?:LiveFrame;previewSequence:number;previewError?:string;
  pending?:Candidate;best?:Result;ended?:'Complete'|'Stopped'|'Error';startedAt?:number;watchdog:ReturnType<typeof setTimeout>;
  validationWatchdog?:ReturnType<typeof setTimeout>;diagnostics:Diagnostics};
export function candidateResult(doc:Document,candidate:Candidate,seed:string):Result {
  const copies=new Map<string,number>();
  return {documentRevision:candidate.documentRevision,solverRevision:SOLVER_REVISION,seed,
    elapsedSeconds:candidate.elapsedMs/1000,usedLengthMm:candidate.solution.strip_width,
    placements:candidate.solution.layout.placed_items.map(p=>{
      const partId=doc.parts[p.item_id]?.id ?? `unknown:${p.item_id}`;
      const copyIndex=copies.get(partId) ?? 0; copies.set(partId,copyIndex+1);
      return {partId,copyIndex,xMm:p.transformation.translation[0],yMm:p.transformation.translation[1],angleDeg:p.transformation.rotation};
    }), validation:{status:'pending',overlapAreaMm2:0,maxBoundaryViolationMm:0,minClearanceMm:null,errors:[]}};
}
export function useSolver() {
  const [state,setState]=useState<RunState>('Ready'),[result,setResult]=useState<Result>(),[elapsed,setElapsed]=useState(0),[error,setError]=useState('');
  const [live,setLive]=useState<LiveFrame>(),[liveError,setLiveError]=useState('');
  const [workers,setWorkers]=useState<{actual:number;requested?:number;reason?:string}>();
  const run=useRef<Run|undefined>(undefined),serial=useRef(0);
  const diagnostics=useRef<Diagnostics|undefined>(undefined);
  function clear() {
    const r=run.current;
    if(r) {r.solver?.postMessage({type:'stop'});r.checker.terminate();r.preview.terminate();clearTimeout(r.watchdog);clearTimeout(r.validationWatchdog);}
    run.current=undefined;
  }
  useEffect(()=>{
    const timer=setInterval(()=>{
      const r=run.current;
      if(r) {
        setResult(r.best);setLive(r.frame);setLiveError(r.previewError??'');
        if(r.startedAt && !r.ended) setElapsed((performance.now()-r.startedAt)/1000);
        // Render the latest snapshot at most 10 times/second. Keep one in flight;
        // live display work cannot queue ahead of independent feasible checks.
        if(r.latest&&!r.previewActive&&!r.previewError&&r.latest.sequence>r.previewSequence) {
          const candidate=r.latest,result=candidateResult(r.doc,candidate,r.seed);
          r.previewActive={candidate,result};r.previewSequence=candidate.sequence;
          r.preview.postMessage({type:'live-preview',sequence:candidate.sequence,runId:r.id,documentRevision:r.revision,document:r.doc,result});
        }
      }
    },100);
    return ()=>{clearInterval(timer);clear();};
  },[]);
  function settled(r:Run) {
    if(r.ended && !r.active && !r.pending) {
      setResult(r.best);setState(r.ended);r.checker.terminate();
      if(!r.best&&r.ended==='Complete') {setState('Error');setError(`No candidate passed geometry validation. ${r.diagnostics.history.slice().reverse().find(t=>t.errors?.length)?.errors?.join(' ')??'Download diagnostics and check the input.'}`);}
    }
  }
  function end(reason:'Complete'|'Stopped'|'Error',message?:string) {
    const r=run.current;if(!r) return;
    r.solver?.postMessage({type:'stop'});r.solver=undefined;clearTimeout(r.watchdog);r.ended=reason;
    r.diagnostics.stopReason=message ?? reason;
    if(message) setError(message);
    if(r.startedAt) setElapsed((performance.now()-r.startedAt)/1000);
    setState(r.active || r.pending?'Checking':reason);settled(r);
  }
  function check(r:Run,candidate:Candidate) {
    if(r.active) {r.pending=candidate;return;}
    const result=candidateResult(r.doc,candidate,r.seed);r.active={candidate,result};
    r.validationWatchdog=setTimeout(()=>{
      if(run.current!==r) return;
      r.checker.terminate();r.active=undefined;r.pending=undefined;end('Error','Geometry check exceeded 30 seconds. Reduce input complexity.');
    },30_000);
    r.checker.postMessage({type:'validate',runId:r.id,documentRevision:r.revision,sequence:candidate.sequence,document:r.doc,result});
  }
  function start(doc:Document,revision:number,threads?:number) {
    clear();setWorkers(undefined);setResult(undefined);setLive(undefined);setLiveError('');setError('');setElapsed(0);setState('Initializing');
    const id=++serial.current,seed=crypto.getRandomValues(new BigUint64Array(1))[0].toString();
    const solver=new Worker(new URL('./solver.worker.ts',import.meta.url),{type:'module'});
    const checker=new Worker(new URL('./geometry.worker.ts',import.meta.url),{type:'module'});
    const preview=new Worker(new URL('./geometry.worker.ts',import.meta.url),{type:'module'});
    const r:Run={id,revision,doc,seed,solver,checker,preview,previewSequence:0,watchdog:setTimeout(()=>end('Stopped','Initialization exceeded 15 seconds.'),15_000),
      diagnostics:{solverRevision:SOLVER_REVISION,seed,buildMode:'Initializing',history:[],liveSnapshots:0}};
    run.current=r;diagnostics.current=r.diagnostics;
    preview.onmessage=({data}:MessageEvent<GeometryReply>)=>{
      if(run.current!==r||data.runId!==r.id||data.documentRevision!==r.revision)return;
      if(data.type==='error'){r.previewError=data.message;r.previewActive=undefined;preview.terminate();return;}
      if(data.type!=='live-frame'||!r.previewActive||data.sequence!==r.previewActive.candidate.sequence)return;
      r.frame={...data.geometry,sequence:data.sequence,result:r.previewActive.result,report:r.previewActive.candidate.report};r.previewActive=undefined;
    };
    preview.onerror=e=>{if(run.current===r){r.previewError=e.message;r.previewActive=undefined;preview.terminate();}};
    checker.onmessage=({data}:MessageEvent<GeometryReply>)=>{
      if(run.current!==r || data.runId!==r.id || data.documentRevision!==r.revision) return;
      if(r.ended && !r.active && !r.pending) return;
      if(data.type==='error') {clearTimeout(r.validationWatchdog);r.active=undefined;r.pending=undefined;end('Error',data.message);return;}
      if(data.type!=='validation-result' || !r.active || data.sequence!==r.active.candidate.sequence) return;
      clearTimeout(r.validationWatchdog);
      const checked={...r.active.result,validation:data.validation};
      const timing=r.diagnostics.history.find(t=>t.sequence===data.sequence);
      if(timing) Object.assign(timing,{validation:data.validation.status,validationMs:data.elapsedMs,errors:data.validation.errors});
      if(data.validation.status==='passed' && (!r.best || checked.usedLengthMm<r.best.usedLengthMm)) r.best=checked;
      r.active=undefined;
      if(r.pending) {const next=r.pending;r.pending=undefined;check(r,next);} else settled(r);
    };
    checker.onerror=e=>{if(run.current===r && (!r.ended || r.active || r.pending)) {clearTimeout(r.validationWatchdog);r.active=undefined;r.pending=undefined;end('Error',e.message||'A background worker could not be loaded. Reload the page and try again.');}};
    solver.onmessage=({data}:MessageEvent<SolverMessage>)=>{
      if(run.current!==r || !r.solver || data.runId!==r.id || data.documentRevision!==r.revision) return;
      switch(data.type) {
        case 'ready': setWorkers({actual:data.threads,requested:threads,reason:data.fallbackReason});r.diagnostics.buildMode=`${data.threads} solver thread${data.threads===1?'':'s'}, no SIMD${data.fallbackReason?`; serial fallback: ${data.fallbackReason}`:''}`; break;
        case 'phase':
          setWorkers(previous=>previous?{...previous,actual:data.workers}:previous);
          if(!r.startedAt) {r.startedAt=performance.now();r.diagnostics.initializationMs=data.initializationMs;clearTimeout(r.watchdog);if(doc.settings.timeLimitSeconds!==null)r.watchdog=setTimeout(()=>end('Stopped','Solve duration plus two-second allowance elapsed.'),(doc.settings.timeLimitSeconds+2)*1000);}
          setState('Running');break;
        case 'live':r.latest=data;r.diagnostics.liveSnapshots!++;break;
        case 'candidate':
          r.latest=data;r.diagnostics.liveSnapshots!++;
          r.diagnostics.history.push({sequence:data.sequence,elapsedMs:data.elapsedMs,lengthMm:data.solution.strip_width});
          check(r,data);break;
        case 'finished': end('Complete');break;
        case 'error': end('Error',data.message);break;
      }
    };
    solver.onerror=e=>{if(run.current===r && r.solver) end('Error',e.message||'A background worker could not be loaded. Reload the page and try again.');};
    solver.postMessage({type:'start',runId:id,documentRevision:revision,document:doc,seed,threads});
  }
  function invalidate() {clear();setWorkers(undefined);setResult(undefined);setLive(undefined);setLiveError('');setState('Ready');setError('');}
  function load(checked:Result) {
    clear();setWorkers(undefined);setLive(undefined);setLiveError('');setResult(checked);setElapsed(checked.elapsedSeconds);setState('Complete');setError('');
    diagnostics.current={solverRevision:checked.solverRevision,seed:checked.seed,buildMode:'Loaded project; result rechecked locally',stopReason:'Loaded project',history:[]};
  }
  return {state,workers,result,live,liveError,elapsed,error,start,stop:()=>end('Stopped'),invalidate,load,diagnostics};
}
