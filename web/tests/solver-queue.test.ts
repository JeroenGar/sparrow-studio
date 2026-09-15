import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import type {GeometryRequest,GeometryReply,SolverMessage} from '../src/workers/protocol';
import {example,newPart,type Document} from '../src/model';

// Exercise the real hook's worker callbacks without a DOM or a second React renderer.
const hooks=vi.hoisted(()=>({slots:[] as unknown[],cursor:0,effects:[] as (()=>void|(()=>void))[],cleanups:[] as (()=>void)[]}));
vi.mock('react',()=>({
  useState:(initial:unknown)=>{const i=hooks.cursor++;if(!(i in hooks.slots))hooks.slots[i]=typeof initial==='function'?initial():initial;return [hooks.slots[i],(value:unknown)=>{hooks.slots[i]=typeof value==='function'?value(hooks.slots[i]):value;}];},
  useRef:(initial:unknown)=>{const i=hooks.cursor++;if(!(i in hooks.slots))hooks.slots[i]={current:initial};return hooks.slots[i];},
  useEffect:(effect:()=>void|(()=>void))=>{const i=hooks.cursor++;if(!(i in hooks.slots)){hooks.slots[i]=true;hooks.effects.push(effect);}},
}));
import {useSolver} from '../src/workers/useSolver';
import {exportSVG} from '../src/export/svg';
import {exportProject} from '../src/import/project';

class WorkerStub {
  static all:WorkerStub[]=[];
  messages:GeometryRequest[]=[];terminated=false;
  onmessage?:({data}:{data:SolverMessage|GeometryReply})=>void;
  onerror?:(event:{message:string})=>void;
  constructor(){WorkerStub.all.push(this);}
  postMessage(message:GeometryRequest){this.messages.push(message);}
  terminate(){this.terminated=true;}
  deliver(data:SolverMessage|GeometryReply){this.onmessage?.({data});}
}
function render(){hooks.cursor=0;const result=useSolver();for(const effect of hooks.effects.splice(0)){const cleanup=effect();if(cleanup)hooks.cleanups.push(cleanup);}return result;}
const doc:Document={...example(),parts:[{...newPart([[0,0],[10,0],[10,10],[0,10]]),id:'part',quantity:1}],settings:{materialWidthMm:20,clearanceMm:0,timeLimitSeconds:120}};
function candidate(runId:number,documentRevision:number,sequence:number,length:number):SolverMessage {
  return {type:'candidate',runId,documentRevision,sequence,report:'ExplFeas',elapsedMs:sequence*100,solution:{strip_width:length,layout:{placed_items:[{item_id:0,transformation:{rotation:0,translation:[0,0]}}]}}};
}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('Worker',WorkerStub);WorkerStub.all=[];hooks.slots=[];hooks.cursor=0;hooks.effects=[];hooks.cleanups=[];});
afterEach(()=>{for(const cleanup of hooks.cleanups)cleanup();vi.unstubAllGlobals();vi.useRealTimers();});

test('solver-feasible candidates are accepted directly and retain the shortest result',()=>{
  render().start(doc,7);const [solver,preview]=WorkerStub.all;
  expect(WorkerStub.all).toHaveLength(2);
  solver.deliver(candidate(1,7,1,20));solver.deliver(candidate(1,7,2,9));solver.deliver(candidate(1,7,3,18));
  vi.advanceTimersByTime(100);
  expect(render().result).toMatchObject({usedLengthMm:9,validation:{status:'passed',source:'solver',overlapAreaMm2:null}});
  expect(()=>exportSVG(doc,render().result)).not.toThrow();
  expect(()=>exportProject(doc,7,render().result)).not.toThrow();
  expect(preview.messages.every(message=>message.type==='live-preview')).toBe(true);
  solver.deliver({type:'finished',runId:1,documentRevision:7});
  expect(render().state).toBe('Complete');
  solver.onerror?.({message:'Queued error after worker disposal'});
  expect(render().state).toBe('Complete');
});

test('live clip failures are logged without stopping the preview worker',()=>{
  render().start(doc,7);const [solver,preview]=WorkerStub.all;
  solver.deliver({...candidate(1,7,1,20),type:'live'});
  vi.advanceTimersByTime(100);
  preview.deliver({type:'live-frame',runId:1,documentRevision:7,sequence:1,geometry:{world:[],overlaps:[],errors:['clip failed']}});
  expect(preview.terminated).toBe(false);
  expect(render().diagnostics.current?.liveErrors).toEqual([{sequence:1,message:'clip failed'}]);
});

test('old runs, revisions and messages after Stop cannot overwrite the current result',()=>{
  render().start(doc,7);const [oldSolver,oldPreview]=WorkerStub.all;
  oldSolver.deliver(candidate(1,7,1,20));
  render().stop();expect(render().state).toBe('Stopped');expect(render().result?.usedLengthMm).toBe(20);
  render().start(doc,8);const [solver]=WorkerStub.all.slice(2);
  expect(oldPreview.terminated).toBe(true);
  oldSolver.deliver({type:'finished',runId:1,documentRevision:7});oldSolver.onerror?.({message:'Old worker error'});
  solver.deliver(candidate(1,8,1,20));solver.deliver(candidate(2,7,1,20));
  expect(render().result).toBeUndefined();expect(render().state).toBe('Initializing');
  solver.deliver(candidate(2,8,1,20));
  render().stop();solver.deliver(candidate(2,8,2,15));
  expect(render().state).toBe('Stopped');expect(render().result).toMatchObject({documentRevision:8,usedLengthMm:20});
});

test('timed runs let Sparrow finish its current iteration beyond the requested budget',()=>{
  render().start({...doc,settings:{...doc.settings,timeLimitSeconds:10}},7);
  const [solver]=WorkerStub.all;
  vi.advanceTimersByTime(1);
  solver.deliver({type:'phase',runId:1,documentRevision:7,phase:'Exploration',workers:1,initializationMs:0});
  solver.deliver(candidate(1,7,1,20));
  vi.advanceTimersByTime(9500);
  solver.deliver({type:'phase',runId:1,documentRevision:7,phase:'Compression',workers:1,initializationMs:0});
  vi.advanceTimersByTime(3500);
  expect(render().state).toBe('Running');
  solver.deliver({...candidate(1,7,2,18),report:'Final'});
  solver.deliver({type:'finished',runId:1,documentRevision:7});
  expect(render().state).toBe('Complete');
  expect(render().result?.usedLengthMm).toBe(18);
});
