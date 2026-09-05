import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import type {GeometryRequest,GeometryReply,SolverMessage} from '../src/workers/protocol';
import {example,newPart,type Document} from '../src/model';
import {validate} from '../src/geometry/validate';

// Exercise the real hook's worker callbacks without a DOM or a second React renderer.
const hooks=vi.hoisted(()=>({slots:[] as unknown[],cursor:0,effects:[] as (()=>void|(()=>void))[],cleanups:[] as (()=>void)[]}));
vi.mock('react',()=>({
  useState:(initial:unknown)=>{const i=hooks.cursor++;if(!(i in hooks.slots))hooks.slots[i]=typeof initial==='function'?initial():initial;return [hooks.slots[i],(value:unknown)=>{hooks.slots[i]=typeof value==='function'?value(hooks.slots[i]):value;}];},
  useRef:(initial:unknown)=>{const i=hooks.cursor++;if(!(i in hooks.slots))hooks.slots[i]={current:initial};return hooks.slots[i];},
  useEffect:(effect:()=>void|(()=>void))=>{const i=hooks.cursor++;if(!(i in hooks.slots)){hooks.slots[i]=true;hooks.effects.push(effect);}},
}));
import {useSolver} from '../src/workers/useSolver';

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
function check(worker:WorkerStub) {
  const request=worker.messages.at(-1)!;if(request.type!=='validate')throw Error('Expected a validation request');
  worker.deliver({type:'validation-result',runId:request.runId,documentRevision:request.documentRevision,sequence:request.sequence,validation:validate(request.document,request.result),elapsedMs:1});
}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('Worker',WorkerStub);WorkerStub.all=[];hooks.slots=[];hooks.cursor=0;hooks.effects=[];hooks.cleanups=[];});
afterEach(()=>{for(const cleanup of hooks.cleanups)cleanup();vi.unstubAllGlobals();vi.useRealTimers();});

test('latest-only queue retains a longer passed result over a shorter failed candidate',()=>{
  render().start(doc,7);const [solver,checker]=WorkerStub.all;
  solver.deliver(candidate(1,7,1,20));solver.deliver(candidate(1,7,2,18));solver.deliver(candidate(1,7,3,9));
  expect(checker.messages).toHaveLength(1);
  check(checker);expect(checker.messages).toHaveLength(2);
  expect(checker.messages[1]).toMatchObject({sequence:3}); // Candidate 2 was superseded, not queued.
  check(checker);vi.advanceTimersByTime(100);
  expect(render().result).toMatchObject({usedLengthMm:20,validation:{status:'passed'}});
  expect(render().diagnostics.current?.history.at(-1)).toMatchObject({lengthMm:9,validation:'failed'});
  solver.deliver(candidate(1,7,4,15));check(checker);
  solver.deliver({type:'finished',runId:1,documentRevision:7});
  expect(render().state).toBe('Complete');expect(render().result?.usedLengthMm).toBe(15);
  solver.onerror?.({message:'Queued error after worker disposal'});
  checker.onerror?.({message:'Queued checker error after settlement'});
  checker.deliver({type:'error',runId:1,documentRevision:7,message:'Late checker reply'});
  expect(render().state).toBe('Complete');
});

test('old runs, revisions and validation sequences cannot overwrite the current result',()=>{
  render().start(doc,7);const [oldSolver,oldChecker]=WorkerStub.all;
  oldSolver.deliver(candidate(1,7,1,20));
  render().stop();expect(render().state).toBe('Checking');
  render().start(doc,8);const [solver,checker]=WorkerStub.all.slice(3);
  expect(oldChecker.terminated).toBe(true);
  check(oldChecker);oldSolver.deliver({type:'finished',runId:1,documentRevision:7});oldSolver.onerror?.({message:'Old worker error'});
  solver.deliver(candidate(1,8,1,20));solver.deliver(candidate(2,7,1,20));
  expect(checker.messages).toHaveLength(0);expect(render().result).toBeUndefined();expect(render().state).toBe('Initializing');
  solver.deliver(candidate(2,8,1,20));
  checker.deliver({type:'validation-result',runId:2,documentRevision:8,sequence:99,validation:{status:'passed',overlapAreaMm2:0,maxBoundaryViolationMm:0,minClearanceMm:null,errors:[]},elapsedMs:1});
  expect(render().result).toBeUndefined();
  render().stop();solver.deliver(candidate(2,8,2,15));expect(checker.messages).toHaveLength(1);
  check(checker);expect(render().state).toBe('Stopped');expect(render().result).toMatchObject({documentRevision:8,usedLengthMm:20});
});
