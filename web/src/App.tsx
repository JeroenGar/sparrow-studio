import RotationControl from './components/RotationControl';
import {readRecovery,saveRecovery} from './storage/recovery';
import {useDismissibleMenu} from './components/useDismissibleMenu';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, POLICY, rotationSummary, type Document, type Part, type Point, type Result, type RotationRule } from './model';
import { bounds } from './geometry/normalize';
import { netArea } from './geometry/validate';
import { pathData } from './geometry/path';
import { geometryTask } from './workers/geometryTask';
import {loadExample} from './datasets';
import { useSolver } from './workers/useSolver';
import type { ImportReview } from './import/sparrow';
import Workspace,{colors} from './components/Workspace';
import Modal from './components/Modal';
import SelectionControls from './components/SelectionControls';
import ShapeLibrary from './components/ShapeLibrary';
import ExamplePicker from './components/ExamplePicker';
import {displayLength,unitScale,type DisplayUnit} from './units';
import {selectionBounds,type GeometryEdit} from './geometry/manipulate';
import {isEditableTarget,preparationShortcut} from './geometry/gestures';
import {copyRefsFor,documentPlacements,duplicateCopies,removeCopies,rotateToNextOrientation,movePlacements,placementLayoutsEqual,rotatePlacements,syncQuantity,updatePlacements,withDocumentPlacements,type CopyRef} from './geometry/placements';

const emptyProject=(name='Untitled project'):Document=>({name,parts:[],settings:{...DEFAULT_SETTINGS}});
type ProjectSwitch={document:Document;result?:Result;warnings?:string[];saved?:boolean;nest?:boolean};
const rotationValue=(rule:RotationRule)=>rule.kind==='continuous'?'free':JSON.stringify([...new Set(rule.degrees.map(d=>((d%360)+360)%360))].sort((a,b)=>a-b));
const validQuantity=(n:number)=>Number.isInteger(n)&&n>=0&&n<=500;
function download(name:string,text:BlobPart,type='application/json') {
  const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// Reuse the initial HTML inside About instead of maintaining a second copy.
function mountNestingAbout(container:HTMLDivElement|null) {
  const content=document.getElementById('about-nesting') as HTMLDetailsElement|null;
  if(!container||!content)return;
  container.append(content);content.hidden=false;
  return ()=>{content.hidden=true;content.open=false;document.body.append(content);};
}
export default function App({initialDocument=emptyProject(),initialError='',loadDefaultExample=false}:{initialDocument?:Document;initialError?:string;loadDefaultExample?:boolean}) {
  const [doc,setDoc]=useState<Document>(()=>withDocumentPlacements(initialDocument)),[revision,setRevision]=useState(1),[selectedCopies,setSelectedCopies]=useState<CopyRef[]>([]);
  const [unusedSelection,setUnusedSelection]=useState<string[]>([]);
  // Safari clears the focus selection on mouse-up; preserve it for the first click only.
  const partAnchor=useRef(0),focusClick=useRef<HTMLInputElement|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(initialError);
  const [fitRequest,setFitRequest]=useState(0);
  const [resultMode,setResultMode]=useState<'live'|'checked'>('live');
  const [threads,setThreads]=useState(0),[library,setLibrary]=useState(false),[examples,setExamples]=useState(false);
  const [sizeValid,setSizeValid]=useState(true),[downloadedResult,setDownloadedResult]=useState(false);
  const [theme,setTheme]=useState<'system'|'light'|'dark'>(()=>{try{const saved=localStorage.getItem('sparrow-theme');return saved==='light'||saved==='dark'||saved==='system'?saved:'system';}catch{return 'system';}});
  useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('sparrow-theme',theme);}catch{/* The theme still works when storage is unavailable. */}},[theme]);
  const [unit,setUnit]=useState<DisplayUnit>(()=>{try{return localStorage.getItem('sparrow-units')==='in'?'in':'mm';}catch{return 'mm';}});
  useEffect(()=>{try{localStorage.setItem('sparrow-units',unit);}catch{/* Display units work without persistence. */}},[unit]);
  const factor=unitScale(unit),length=(mm:number)=>(mm/factor).toLocaleString(undefined,{maximumFractionDigits:unit==='mm'?2:4});
  const inputLength=(mm:number)=>Number.isFinite(mm)?displayLength(mm,unit):'';
  const [panel,setPanel]=useState(true),[info,setInfo]=useState<'about'|'contact'|'help'>();
  const [files,setFiles]=useState<{name:string;text:string}[]>(),[scale,setScale]=useState(1),[review,setReview]=useState<ImportReview>();
  const [tolerance,setTolerance]=useState(.01),[enclosed,setEnclosed]=useState<'holes'|'parts'>('holes');
  const [layers,setLayers]=useState<string[]>(),[availableLayers,setAvailableLayers]=useState<string[]>([]),[excludeIssues,setExcludeIssues]=useState(false);
  const [previewStale,setPreviewStale]=useState(false);
  const [importWarnings,setImportWarnings]=useState<string[]>([]);
  const [exportFormat,setExportFormat]=useState<'svg'|'dxf'>('svg');
  const [materialWidthFocused,setMaterialWidthFocused]=useState(false);
  const [nameDialog,setNameDialog]=useState<'new'|'rename'>(),[projectName,setProjectName]=useState('');
  const [pendingProject,setPendingProject]=useState<ProjectSwitch>();
  const [fileIntent,setFileIntent]=useState<'project'|'shapes'|'auto'>('auto');
  const projectInput=useRef<HTMLInputElement>(null),projectMenu=useRef<HTMLDetailsElement>(null);
  useDismissibleMenu(projectMenu);
  const [shape,setShape]=useState<'rectangle'|'circle'|'polygon'>(),[shapeWidth,setShapeWidth]=useState(40),[shapeHeight,setShapeHeight]=useState(30),[polygon,setPolygon]=useState<Point[]>();
  const history=useRef<{doc:Document;geometry:boolean;selection:CopyRef[];unused:string[]}[]>([]),future=useRef<{doc:Document;geometry:boolean;selection:CopyRef[];unused:string[]}[]>([]),operation=useRef(0);
  const input=useRef<HTMLInputElement>(null),solver=useSolver();
  const fieldEdit=useRef<{key:string;document:Document}|undefined>(undefined);
  const running=['Initializing','Running','Checking'].includes(solver.state),locked=running||busy;
  const result=solver.result?.documentRevision===revision?solver.result:undefined;
  const [saved,setSaved]=useState<{document:Document;result?:Result}>(()=>({document:doc}));
  const [loadingExample,setLoadingExample]=useState(loadDefaultExample);
  const [recoveryReady,setRecoveryReady]=useState(false),[recoveryError,setRecoveryError]=useState('');
  useEffect(()=>{
    if(loadingExample)return;
    const worker=new Worker(new URL('./workers/solver-runtime.worker.ts',import.meta.url),{type:'module'});
    const timeout=setTimeout(()=>worker.terminate(),15_000);
    const done=()=>{clearTimeout(timeout);worker.terminate();};
    worker.onmessage=done;
    worker.onerror=event=>{event.preventDefault();done();};
    worker.postMessage({type:'preload',threads:crossOriginIsolated&&typeof SharedArrayBuffer!=='undefined'&&navigator.hardwareConcurrency>2?3:1});
    return done;
  },[loadingExample]);
  const defaultExampleCancelled=useRef(false);
  function cancelDefaultExample() {defaultExampleCancelled.current=true;setLoadingExample(false);}
  useEffect(()=>{
    if(!loadDefaultExample)return;
    let disposed=false;
    void (async()=>{
      try {
        try {
          const saved=await readRecovery();
          if(disposed)return;
          if(defaultExampleCancelled.current){setRecoveryReady(true);return;}
          if(saved) {
            const reply=await geometryTask({type:'import',runId:0,documentRevision:0,files:[{name:'recovery.json',text:JSON.stringify(saved)}],scale:1});
            if(disposed)return;
            if(defaultExampleCancelled.current){setRecoveryReady(true);return;}
            if(reply.type!=='import-review')throw Error('Could not restore the previous project.');
            switchProject({...reply.review,saved:false});
            setRecoveryReady(true);
            return;
          }
          setRecoveryReady(true);
        } catch {
          if(!disposed)setRecoveryError('Automatic recovery is unavailable. Use Save project to keep a copy.');
        }
        const imported=await loadExample('gardeyn2.json',AbortSignal.timeout(10000));
        if(disposed||defaultExampleCancelled.current)return;
        const prepared=await geometryTask({type:'prepare-layout',runId:0,documentRevision:0,document:imported.document,pinnedIds:[],compact:true});
        if(disposed||defaultExampleCancelled.current)return;
        if(prepared.type!=='normalized')throw Error('Could not arrange gardeyn2.json.');
        const document=withDocumentPlacements(prepared.document);
        setDoc(document);setSaved({document});setFitRequest(n=>n+1);
      } catch(error) {
        if(!disposed&&!defaultExampleCancelled.current)setError(`The demo could not load. You can still create or open a project. ${String(error)}`);
      } finally {if(!disposed)setLoadingExample(false);}
    })();
    return ()=>{disposed=true;};
  },[loadDefaultExample]);
  const dirty=doc.name!==saved.document.name||doc.parts!==saved.document.parts||doc.placements!==saved.document.placements||Object.keys(doc.settings).some(key=>doc.settings[key as keyof typeof doc.settings]!==saved.document.settings[key as keyof typeof doc.settings])||result!==saved.result;
  const live=solver.live?.result.documentRevision===revision?solver.live:undefined;
  const showingLive=resultMode==='live'&&!!live;
  const selected=useMemo(()=>[...new Set([...selectedCopies.map(copy=>copy.partId),...unusedSelection])],[selectedCopies,unusedSelection]);
  const visibleResult=showingLive?live?.result:result;
  const canvasDocument=useMemo(()=>visibleResult?{...doc,placements:visibleResult.placements}:doc,[doc,visibleResult]);
  const chosen=doc.parts.find(p=>p.id===selected[0]);
  const mixedRotations=chosen&&doc.parts.some(part=>selected.includes(part.id)&&rotationValue(part.rotations)!==rotationValue(chosen.rotations));
  const selectedBox=useMemo(()=>selectionBounds(canvasDocument,selected,selectedCopies),[canvasDocument,selected,selectedCopies]);
  const invalidSettings=!sizeValid||!Number.isFinite(doc.settings.materialWidthMm)||doc.settings.materialWidthMm<=0||doc.settings.materialWidthMm>100_000||!Number.isFinite(doc.settings.clearanceMm)||doc.settings.clearanceMm<0||doc.settings.clearanceMm>=doc.settings.materialWidthMm||doc.parts.some(p=>!validQuantity(p.quantity))||doc.parts.reduce((n,p)=>n+p.quantity,0)>500;
  const recoveryResult=running?undefined:result;
  useEffect(()=>{
    if(!recoveryReady||loadingExample||invalidSettings||!doc.name.trim())return;
    const project={...doc,...(recoveryResult?{placements:recoveryResult.placements,result:recoveryResult}:{}),schemaVersion:1 as const,revision};
    let written=false;
    const write=()=>{
      if(written)return;written=true;
      void saveRecovery(project).then(()=>setRecoveryError(''),()=>setRecoveryError('Automatic recovery could not be saved. Use Save project to keep a copy.'));
    };
    const timer=setTimeout(write,500);
    const hidden=()=>{if(document.visibilityState==='hidden')write();};
    window.addEventListener('pagehide',write);document.addEventListener('visibilitychange',hidden);
    return ()=>{clearTimeout(timer);window.removeEventListener('pagehide',write);document.removeEventListener('visibilitychange',hidden);};
  },[doc,recoveryResult,revision,loadingExample,recoveryReady,invalidSettings]);
  useEffect(()=>{
    if(running||!result) return;
    const next=withDocumentPlacements(doc,result.placements);
    if(!placementLayoutsEqual(doc,next)) setDoc(next);
  },[running,result,doc]);
  useEffect(()=>{if(!running&&result)setResultMode('checked');},[running,result]);
  function commit(next:Document,geometry=true,field?:string) {
    const parts=new Map(next.parts.map(part=>[part.id,part]));
    const placements=next.placements?.filter(copy=>parts.has(copy.partId)&&copy.copyIndex<(Number.isInteger(parts.get(copy.partId)!.quantity)?Math.max(0,parts.get(copy.partId)!.quantity):1));
    let canonical:Document;
    try {canonical=withDocumentPlacements({...next,placements});} catch(error) {setError(String(error));return;}
    setUnusedSelection(previous=>previous.filter(id=>canonical.parts.some(part=>part.id===id&&part.quantity===0)));
    setSelectedCopies(previous=>previous.filter(copy=>canonical.parts.some(part=>part.id===copy.partId&&copy.copyIndex<part.quantity)));
    // Keep live field feedback, but record only the value before this editing session.
    if(!field||fieldEdit.current?.key!==field||fieldEdit.current.document!==doc)
      history.current=[...history.current.slice(-49),{doc,geometry,selection:selectedCopies,unused:unusedSelection}];
    fieldEdit.current=field?{key:field,document:canonical}:undefined;future.current=[];
    cancelDefaultExample();setDoc(canonical);setError('');
    if(geometry) {setRevision(r=>r+1);solver.invalidate();}
  }
  async function prepareDocument(next:Document,pinnedIds:string[]=[],compact=false) {
    const reply=await geometryTask({type:'prepare-layout',runId:++operation.current,documentRevision:revision,document:next,pinnedIds,compact});
    if(reply.type!=='normalized')throw Error('Could not arrange the preparation drawing.');
    const parts=next.parts.map((part,i)=>({...part,preparationPosition:reply.document.parts[i].preparationPosition}));
    const placements=documentPlacements(next).map(placement=>{
      const before=next.parts.find(part=>part.id===placement.partId)!.preparationPosition;
      const after=parts.find(part=>part.id===placement.partId)!.preparationPosition;
      return {...placement,xMm:placement.xMm+after[0]-before[0],yMm:placement.yMm+after[1]-before[1]};
    });
    return withDocumentPlacements({...next,parts},placements);
  }
  function restore(redo=false) {
    if(locked) return;
    fieldEdit.current=undefined;
    const from=redo?future:history,to=redo?history:future,entry=from.current.pop();
    if(!entry) return;
    to.current.push({doc,geometry:entry.geometry,selection:selectedCopies,unused:unusedSelection});setDoc(withDocumentPlacements(entry.doc));
    setUnusedSelection(entry.unused);
    setSelectedCopies(entry.selection.filter(copy=>entry.doc.parts.some(part=>part.id===copy.partId&&copy.copyIndex<part.quantity)));
    if(entry.geometry) {setRevision(r=>r+1);solver.invalidate();}
  }
  useEffect(()=>{
    if(solver.state!=='Initializing'&&solver.state!=='Running')return;
    const leave=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
    window.addEventListener('beforeunload',leave);return ()=>window.removeEventListener('beforeunload',leave);
  },[solver.state]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{try {
      if(document.querySelector('dialog[open]'))return;
      const editable=isEditableTarget(e.target);
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!editable) {e.preventDefault();restore(e.shiftKey);return;}
      if(e.key==='Escape') {setUnusedSelection([]);setSelectedCopies([]);setPolygon(undefined);}
      if(e.key==='Enter'&&polygon&&!locked&&!editable) {e.preventDefault();void addShape('polygon');return;}
      if(editable||locked||e.altKey||!selected.length)return;
      if(e.key==='Backspace'||e.key==='Delete') {e.preventDefault();if(!selectedCopies.length)return;commit(removeCopies(canvasDocument,selectedCopies));setSelectedCopies([]);return;}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='d') {
        e.preventDefault();if(!selectedCopies.length)return;try {
          const next=duplicateCopies(canvasDocument,selectedCopies),oldCounts=new Map(doc.parts.map(part=>[part.id,part.quantity]));
          commit(next);setSelectedCopies(documentPlacements(next).filter(copy=>copy.copyIndex>=oldCounts.get(copy.partId)!).map(({partId,copyIndex})=>({partId,copyIndex})));
        }catch(error){setError(String(error));}return;
      }
      if(e.metaKey||e.ctrlKey)return;
      const action=preparationShortcut(e.key);
      const refs=selectedCopies.length?selectedCopies:copyRefsFor(doc,selected);
      if(action==='rotate'&&selectedBox){e.preventDefault();const next=rotateToNextOrientation(canvasDocument,refs);if(!placementLayoutsEqual(canvasDocument,next))commit(next);return;}
      if(action!=='increase-quantity'&&action!=='decrease-quantity')return;
      const parts=doc.parts.filter(part=>selected.includes(part.id));
      if(!parts.length||parts.some(part=>!validQuantity(part.quantity)))return;
      const delta=action==='increase-quantity'?1:-1,total=doc.parts.reduce((sum,part)=>sum+part.quantity,0);
      if(delta>0?(total+parts.length>500||parts.some(part=>part.quantity>=500)):parts.some(part=>part.quantity<=0))return;
      e.preventDefault();
      const parents=parts.flatMap(part=>{const copy=refs.find(copy=>copy.partId===part.id);return copy?[copy]:[];});
      if(delta>0) {
        const duplicated=parents.length?duplicateCopies(canvasDocument,parents):canvasDocument;
        const next=syncQuantity({...duplicated,parts:duplicated.parts.map(part=>unusedSelection.includes(part.id)?{...part,quantity:1}:part)});commit(next);setUnusedSelection([]);
        setSelectedCopies(parts.map(part=>({partId:part.id,copyIndex:part.quantity})));
      } else {
        const next=removeCopies(canvasDocument,parents);commit(next);
        setSelectedCopies(parents.filter(copy=>next.parts.find(part=>part.id===copy.partId)!.quantity>0)
          .map(copy=>({...copy,copyIndex:Math.min(copy.copyIndex,next.parts.find(part=>part.id===copy.partId)!.quantity-1)})));
      }
    }catch(error){setError(String(error));}};
    window.addEventListener('keydown',key);return ()=>window.removeEventListener('keydown',key);
  });
  async function run(document=doc,rev=revision) {
    const requestedAt=performance.now();
    setBusy(true);setError('');setResultMode('live');
    const id=++operation.current;
    try {
      const reply=await geometryTask({type:'normalize',runId:id,documentRevision:rev,document});
      if(id!==operation.current || reply.type!=='normalized') return;
      solver.start(reply.document,rev,threads||undefined,requestedAt);
    } catch(e) {setError(String(e));} finally {if(id===operation.current)setBusy(false);}
  }
  async function openFiles(list:FileList|File[],intent:'project'|'shapes'|'auto'='auto') {
    if(locked) return;
    const batch=Array.from(list);
    if(batch.some(f=>f.size>(/\.zip$/i.test(f.name)?25:10)*1024*1024)||batch.reduce((n,f)=>n+f.size,0)>25*1024*1024) {setError('Import limit: 10 MiB per drawing, 25 MiB per project ZIP or batch.');return;}
    if(!batch.length)return;cancelDefaultExample();setBusy(true);setError('');
    try{const read=await Promise.all(batch.map(async f=>({name:f.name,text:/\.zip$/i.test(f.name)?(await import('./zip')).projectArchiveText(new Uint8Array(await f.arrayBuffer())):await f.text()})));setFileIntent(intent);setReview(undefined);setScale(1);setLayers(undefined);setAvailableLayers([]);setExcludeIssues(false);setFiles(read);}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function preview() {
    if(!files) return;setBusy(true);setError('');setExcludeIssues(false);
    try {const reply=await geometryTask({type:'import',runId:++operation.current,documentRevision:revision,files,scale,tolerance,enclosed,layers});if(reply.type==='import-review'){setReview(reply.review);setPreviewStale(false);setAvailableLayers(reply.review.layers??[]);}}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function addParts(parts:Part[],warnings:string[]=[]) {
    cancelDefaultExample();
    const reply=await geometryTask({type:'normalize',runId:++operation.current,documentRevision:revision,document:{...doc,parts:[...doc.parts,...parts]}});
    if(reply.type!=='normalized')throw Error('Could not add these shapes.');
    const next=await prepareDocument(reply.document,doc.parts.map(p=>p.id));
    commit(next);
    setUnusedSelection([]);setSelectedCopies(copyRefsFor(next,parts.map(part=>part.id)));setImportWarnings(previous=>[...previous,...warnings]);
  }
  function switchProject(next:ProjectSwitch) {
    cancelDefaultExample();
    const nextRevision=revision+1,checked=next.result?{...next.result,documentRevision:nextRevision}:undefined;
    const document=withDocumentPlacements(next.document,checked?.placements ?? next.document.placements);
    ++operation.current;solver.invalidate();setRevision(nextRevision);setDoc(document);
    history.current=[];future.current=[];fieldEdit.current=undefined;partAnchor.current=0;setUnusedSelection([]);setSelectedCopies([]);setPolygon(undefined);setFiles(undefined);setReview(undefined);setPendingProject(undefined);setError('');setImportWarnings(next.warnings??[]);setFitRequest(n=>n+1);setResultMode(checked?'checked':'live');
    if(checked)solver.load(checked);
    setSaved({document:next.saved?document:withDocumentPlacements(emptyProject()),result:next.saved?checked:undefined});
    if(next.nest)void run(document,nextRevision);
  }
  function requestProject(next:ProjectSwitch) {
    if(dirty||polygon?.length)setPendingProject(next);else switchProject(next);
  }
  async function accept(asProject=false) {
    if(!review||previewStale||(!review.replace&&!review.document.parts.length)||review.issues?.length&&!excludeIssues)return;
    setBusy(true);setError('');
    try {
      if(review.replace){
        // A saved project already contains its exact per-copy layout. Preserve
        // those coordinates and angles byte-for-byte instead of re-running the
        // preparation arranger and introducing floating-point drift.
        requestProject({document:review.document,result:review.result,warnings:review.warnings,saved:true});
      } else if(asProject){
        const document=await prepareDocument(review.document,[],true);
        requestProject({document,result:review.result,warnings:review.warnings,saved:false});
      }
      else{await addParts(review.document.parts,review.warnings);setFiles(undefined);setReview(undefined);setFitRequest(n=>n+1);}
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  function editPart(change:Partial<Part>,geometry=true,field?:string) {if(chosen)commit({...doc,parts:doc.parts.map(p=>selected.includes(p.id)?{...p,...change}:p)},geometry,field);}
  function positionSelection(axis:0|1,value:number) {
    if(!selectedBox||locked)return;
    const delta=value-selectedBox[axis];
    const refs=selectedCopies.length?selectedCopies:copyRefsFor(doc,selected);
    commit(movePlacements(canvasDocument,refs,axis===0?[delta,0]:[0,delta]));
  }
  async function transformSelection(edit:GeometryEdit,refs=selectedCopies.length?selectedCopies:copyRefsFor(doc,selected)) {
    if(locked||!selected.length)return;setBusy(true);setError('');
    try {
      if(edit.kind==='rotate'){commit(rotatePlacements(canvasDocument,refs,edit.degrees,edit.pivot));return;}
      const reply=await geometryTask({type:'edit-selection',runId:++operation.current,documentRevision:revision,document:canvasDocument,ids:selected,edit,refs});
      if(reply.type==='normalized')commit(reply.document);
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function addShape(kind:'rectangle'|'circle'|'polygon') {
    cancelDefaultExample();setBusy(true);setError('');
    try {
      const reply=await geometryTask({type:'shape',runId:++operation.current,documentRevision:revision,shape:kind,width:shapeWidth,height:shapeHeight,points:polygon});
      if(reply.type==='part') {
        await addParts([reply.part]);setShape(undefined);setPolygon(undefined);
      }
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function exportLayout() {
    if(!result||running)return;
    setBusy(true);setError('');
    try {
      const reply=await geometryTask({type:'export',runId:++operation.current,documentRevision:revision,document:doc,result});
      if(reply.type==='export-result'){download(`${exportName}.${exportFormat}`,reply.bundle[exportFormat],exportFormat==='svg'?'image/svg+xml':'application/dxf');setDownloadedResult(true);}
    } catch(e){setError(String(e));}finally{setBusy(false);}
  }
  function diagnostics() {download('sparrow-studio-diagnostics.json',JSON.stringify({document:doc,documentRevision:revision,policy:POLICY,importWarnings,...solver.diagnostics.current,result},null,2));}
  async function saveProject() {
    if(locked)return false;setBusy(true);setError('');
    try {
      const reply=await geometryTask({type:'archive',runId:++operation.current,documentRevision:revision,document:doc,result});
      if(reply.type!=='archive-result')throw Error('Could not save the project.');
      download(`${exportName}.zip`,reply.archive,'application/zip');if(result)setDownloadedResult(true);setSaved({document:doc,result});return true;
    }catch(e){setError(String(e));return false;}finally{setBusy(false);}
  }
  const exportName='sparrow_studio_'+(doc.name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').slice(0,100)||'project');
  const maxApprox=useMemo(()=>Math.max(0,...doc.parts.map(p=>p.approximationToleranceMm)),[doc.parts]);
  const totalArea=useMemo(()=>doc.parts.reduce((n,p)=>n+netArea(p)*p.quantity,0),[doc.parts]);
  const utilization=result?totalArea/(doc.settings.materialWidthMm*result.usedLengthMm)*100:0;
  const first=solver.diagnostics.current?.history.find(t=>t.validation==='passed');
  return <div className="app" onBlurCapture={()=>{fieldEdit.current=undefined;}} onKeyDown={e=>{if(e.key==='Enter'&&e.target instanceof HTMLInputElement&&e.target.hasAttribute('data-undo-field')){e.preventDefault();e.target.blur();}}} onMouseDownCapture={e=>{const target=e.target;focusClick.current=target instanceof HTMLInputElement&&['text','number'].includes(target.type)&&document.activeElement!==target?target:null;}} onMouseUpCapture={e=>{if(focusClick.current===e.target){e.preventDefault();focusClick.current.select();}focusClick.current=null;}} onFocusCapture={e=>{const input=e.target;if(input instanceof HTMLInputElement&&['text','number'].includes(input.type))input.select();}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!document.querySelector('dialog[open]'))void openFiles(e.dataTransfer.files);}}>
    <header className="header"><div className="brand-block"><a className="brand" aria-label="sparrow/studio" href={import.meta.env.BASE_URL}>sparrow<span>/studio</span><small className="demo-badge">demo</small></a><p className="tagline">An interactive sparrow demo, on your device</p></div>
      <div className="header-primary project-bar"><details className="project-menu" ref={projectMenu}><summary aria-label={`Project: ${doc.name}`}>{doc.name}<span aria-hidden="true"> ▾</span></summary><div>
        <button disabled={locked} onClick={()=>{projectMenu.current!.open=false;setProjectName('Untitled project');setNameDialog('new');}}>New project</button>
        <button disabled={locked} onClick={()=>{projectMenu.current!.open=false;projectInput.current?.click();}}>Open project</button>
        <button disabled={locked} onClick={()=>{projectMenu.current!.open=false;setExamples(true);}}>Load example project</button>
        <button disabled={locked} onClick={()=>{projectMenu.current!.open=false;setProjectName(doc.name);setNameDialog('rename');}}>Rename project</button>
      </div></details><button title="Downloads a ZIP with your editable project, CLI input, and any checked SVG/DXF. Open it later to continue." onClick={()=>void saveProject()} disabled={locked||invalidSettings||!!polygon}>Save project</button><small className="project-status">{dirty?'Unsaved changes':'No unsaved changes'}</small></div>
      <nav><button className="theme-toggle" title="Toggle light/dark mode" aria-label="Toggle light/dark mode" onClick={()=>setTheme(theme==='dark'||theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches?'light':'dark')}><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/></svg></button><a href="https://arxiv.org/abs/2509.13329" target="_blank" rel="noreferrer"><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H5v20h14V7zM14 2v5h5M8 12h8M8 16h8"/></svg>Read the paper</a><a className="github-link" href="https://github.com/JeroenGar/sparrow" target="_blank" rel="noreferrer" aria-label="☆ Star sparrow on GitHub"><span aria-hidden="true">☆</span>Star sparrow on GitHub</a><button aria-label="About sparrow/studio" onClick={()=>setInfo('about')}><span aria-hidden="true">ⓘ</span>About</button><button className="hello-button" aria-label="Say hello 👋" onClick={()=>setInfo('contact')}><span className={downloadedResult?'hello-wave':undefined} aria-hidden="true">👋</span>Say hello</button></nav>
      <input ref={input} hidden type="file" multiple accept=".json,.svg,.dxf" onChange={e=>{if(e.target.files)void openFiles(e.target.files,'shapes');e.target.value='';}}/>
      <input ref={projectInput} hidden type="file" accept=".zip,.sparrow-project.json,.json" onChange={e=>{if(e.target.files)void openFiles(e.target.files,'project');e.target.value='';}}/>
    </header>
    {(error||solver.error)&&<div className="error-banner" role="alert">{error||solver.error}</div>}
    {recoveryError&&<div className="error-banner" role="alert">{recoveryError}</div>}
    <main className="main-workspace">
      <aside id="parts-settings" className={`sidebar ${panel?'open':''}`}>
        <div className="panel-title"><h2>Parts <span>{doc.parts.reduce((n,p)=>n+p.quantity,0)}</span></h2><button onClick={()=>setInfo('help')}>Format help</button><button aria-label="Remove unused parts" title="Remove parts with quantity 0" disabled={locked||!doc.parts.some(p=>p.quantity===0)} onClick={()=>commit({...doc,parts:doc.parts.filter(p=>p.quantity!==0)})}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg></button></div>
        <div className="parts-list">{doc.parts.map((p,i)=>{const b=bounds(p.outer);return <div key={p.id} className={`part-row ${selected.includes(p.id)?'selected':''}`}>
          <button className="part-select" aria-pressed={selected.includes(p.id)} onClick={e=>{
            const additive=e.metaKey||e.ctrlKey;
            let next:string[];
            if(e.shiftKey){
              const range=doc.parts.slice(Math.min(partAnchor.current,i),Math.max(partAnchor.current,i)+1).map(part=>part.id);
              next=additive?[...new Set([...selected,...range])]:range;
            }else{
              partAnchor.current=i;
              next=additive?(selected.includes(p.id)?selected.filter(id=>id!==p.id):[...selected,p.id]):[p.id];
            }
            setSelectedCopies(copyRefsFor(doc,next));
            setUnusedSelection(next.filter(id=>doc.parts.some(part=>part.id===id&&part.quantity===0)));
          }}>
            <svg aria-hidden="true" viewBox={`${b[0]-2} ${-b[3]-2} ${b[2]-b[0]+4} ${b[3]-b[1]+4}`}><path d={pathData([p.outer,...p.holes])} transform="scale(1 -1)" fillRule="evenodd" fill={colors[i%colors.length]}/></svg>
            <span>{p.name}<small>{length(b[2]-b[0])} × {length(b[3]-b[1])} {unit}</small><small className="rotation-summary">{rotationSummary(p.rotations)}</small></span>
          </button><input data-undo-field aria-label={`Quantity for ${p.name}`} type="number" min="0" max="500" aria-invalid={!validQuantity(p.quantity)} value={Number.isFinite(p.quantity)?p.quantity:''} disabled={locked} onChange={e=>commit(syncQuantity({...doc,parts:doc.parts.map(part=>part.id===p.id?{...part,quantity:e.target.valueAsNumber}:part)}),true,`quantity:${p.id}`)}/>
          {!validQuantity(p.quantity)&&<small role="alert" className="field-error quantity-error">Enter a whole number from 0 to 500.</small>}
        </div>;})}</div>
        {doc.parts.reduce((n,p)=>n+(Number.isFinite(p.quantity)?p.quantity:0),0)>500&&<p role="alert" className="field-error quantity-total">This drawing exceeds the 500-copy limit. Reduce quantities to continue.</p>}
        <div className="add-shape"><button disabled={locked} onClick={()=>setShape('rectangle')}>Draw shape</button><button disabled={locked} onClick={()=>input.current?.click()}>Import shapes</button><button disabled={locked} onClick={()=>setLibrary(true)}>Shape library</button></div>
        <p className="import-formats">Import SVG, DXF or sparrow instance JSON.</p>
        <div className="row-actions history"><button disabled={locked||!history.current.length} onClick={()=>restore()}>Undo</button><button disabled={locked||!future.current.length} onClick={()=>restore(true)}>Redo</button></div>
        <section className="settings"><h2>Material & run</h2>
          <label>Material width <span>{unit}</span><input data-undo-field type="number" min={0.001/factor} max={100000/factor} step="any" value={inputLength(doc.settings.materialWidthMm)} onFocus={()=>setMaterialWidthFocused(true)} onBlur={()=>setMaterialWidthFocused(false)} disabled={locked} onChange={e=>commit({...doc,settings:{...doc.settings,materialWidthMm:e.target.valueAsNumber*factor}},true,'material-width')}/></label>
          {(!Number.isFinite(doc.settings.materialWidthMm)||doc.settings.materialWidthMm<=0||doc.settings.materialWidthMm>100_000)&&<small role="alert" className="field-error">Enter a positive material width up to {length(100000)} {unit}.</small>}
          <label>Clearance <span>{unit}</span><input data-undo-field type="number" min="0" step="any" value={inputLength(doc.settings.clearanceMm)} disabled={locked} onChange={e=>commit({...doc,settings:{...doc.settings,clearanceMm:e.target.valueAsNumber*factor}},true,'clearance')}/></label>
          {doc.settings.clearanceMm>0&&<small>sparrow also reserves {length(doc.settings.clearanceMm)} {unit} at material edges. This is not cutting kerf.</small>}
          {(!Number.isFinite(doc.settings.clearanceMm)||doc.settings.clearanceMm<0||doc.settings.clearanceMm>=doc.settings.materialWidthMm)&&<small role="alert" className="field-error">Enter zero or a positive clearance smaller than the material width.</small>}
          <label>Stop condition<select value={doc.settings.timeLimitSeconds??'auto'} disabled={locked} onChange={e=>commit({...doc,settings:{...doc.settings,timeLimitSeconds:e.target.value==='auto'?null:Number(e.target.value) as 10|30|60|120|300|600}},false)}><option value="auto">Automatic</option>{[10,30,60,120,300,600].map(s=><option value={s} key={s}>{s<60?`Up to ${s} seconds`:`Up to ${s/60} minute${s>60?'s':''}`}</option>)}</select></label>
          <details className="solver-options"><summary>Solver options</summary><label>Search preset<select disabled={locked} value={doc.settings.solverPreset??'standard'} aria-describedby="preset-description" onChange={e=>commit({...doc,settings:{...doc.settings,solverPreset:e.target.value as 'standard'|'fast'}},false)}><option value="standard">Standard</option><option value="fast">Fast</option></select></label><small id="preset-description">{doc.settings.solverPreset==='fast'?'Good layouts sooner. A greedier search that may miss the best final layout.':'A more thorough search for the best final layout.'}</small><label>Solver threads<select disabled={locked} value={threads} onChange={e=>setThreads(Number(e.target.value))}><option value={0}>Automatic</option>{[1,2,3].map(n=><option key={n} value={n}>{n}</option>)}</select></label>{solver.workers&&<small>Last initialized run: {solver.workers.actual} solver worker{solver.workers.actual===1?'':'s'}.{solver.workers.reason&&` ${solver.workers.reason}`}</small>}<small>{crossOriginIsolated?'Automatic leaves a core free, up to 3 threads.':'This browser session uses one thread.'}</small></details>
          <small>Stops automatically when the search stalls. You can stop at any time.</small>
        </section>
      </aside>
      <section className="drawing-panel"><div className="view-tabs"><strong>Editable canvas</strong><button className="mobile-settings" aria-expanded={panel} aria-controls="parts-settings" onClick={()=>setPanel(!panel)}>Settings</button></div>
        <Workspace optimizing={running} onSelectCopies={copies=>{setUnusedSelection([]);setSelectedCopies(copies);}} materialWidthFocused={materialWidthFocused} unit={unit} fitRequest={fitRequest} document={canvasDocument} result={visibleResult} live={showingLive?live:undefined} selected={selected} selectedCopies={selectedCopies} disabled={locked} onTransform={transformSelection}
          polygon={polygon} onDraw={point=>{if(!locked)setPolygon(p=>[...(p??[]),point]);}}
          onSelect={(copy,toggle)=>{setUnusedSelection([]);if(!copy){setSelectedCopies([]);return;}const key=`${copy.partId}:${copy.copyIndex}`,already=selectedCopies.some(p=>`${p.partId}:${p.copyIndex}`===key);const nextCopies=toggle?(already?selectedCopies.filter(p=>`${p.partId}:${p.copyIndex}`!==key):[...selectedCopies,copy]):already?selectedCopies:[copy];setSelectedCopies(nextCopies);}}
          onMove={positions=>{const current=documentPlacements(canvasDocument);const updates=positions.map(position=>{const previous=current.find(p=>p.partId===position.partId&&p.copyIndex===position.copyIndex);return previous?{...previous,xMm:position.position[0],yMm:position.position[1]}:undefined;}).filter((position):position is NonNullable<typeof position>=>!!position);commit(updatePlacements(canvasDocument,updates));}}/>
        {!doc.parts.length&&!polygon&&<div className="empty-project"><h2>Your project is empty</h2><p>Draw a shape, import SVG/DXF/JSON, or add shapes from your library.</p><div className="empty-project-actions"><button disabled={locked} onClick={()=>input.current?.click()}>Import shapes</button><button onClick={()=>setExamples(true)}>Choose an example</button></div></div>}
        {polygon&&<div className="polygon-actions"><span>{polygon.length} vertices</span><button disabled={locked||polygon.length<3} onClick={()=>void addShape('polygon')}>Finish polygon</button><button onClick={()=>setPolygon(undefined)}>Cancel polygon</button></div>}
        {(live||result)&&<div className={`result-details${showingLive?' live-details':''}`}><div className="result-mode" role="group" aria-label="Result display"><button aria-pressed={resultMode==='live'} disabled={!live} onClick={()=>setResultMode('live')}>{running&&<i className="live-dot" aria-hidden="true"/>}Live search</button><button aria-pressed={resultMode==='checked'} disabled={!result} onClick={()=>setResultMode('checked')}>Best valid solution</button></div><div className="result-copy">{showingLive?<><span><i className="overlap-key"/>Overlaps in red</span><p>Intermediate layouts may overlap. {result?'Downloads use the best valid layout.':'Waiting for a valid solution before downloads are available.'}</p></>:result&&<><span className="checked">✓ Geometry checked</span><span>{maxApprox?`Curves approximated to ${displayLength(maxApprox,unit)} ${unit}`:'Polygonal contours'}</span><details><summary>Check details</summary><p>Outer footprints, holes, copy counts, rotations, boundaries, overlap, and clearance. Boundary/clearance tolerance {POLICY.linearMm} mm; overlap threshold {POLICY.overlapMm2} mm² per pair. This is not manufacturing certification.</p></details></>}</div></div>}
        {solver.liveError&&<p className="field-error">Live preview unavailable: {solver.liveError}</p>}
      </section>
        {chosen&&<aside className="selection-panel" aria-label="Part properties"><div className="panel-title"><h2>Part properties</h2><button aria-label="Clear selection" onClick={()=>{setUnusedSelection([]);setSelectedCopies([]);}}>×</button></div><section className="part-settings">{selected.length===1?<label>Name<input data-undo-field value={chosen.name} disabled={locked} onChange={e=>editPart({name:e.target.value},false,`name:${chosen.id}`)}/></label>:<h2>{selected.length} parts selected</h2>}
          {selectedBox?<SelectionControls key={JSON.stringify(selectedCopies)} unit={unit} box={selectedBox} disabled={locked} onPosition={positionSelection} onSize={(axis,value)=>void transformSelection({kind:'scale',factor:value/(selectedBox[axis+2]-selectedBox[axis]),pivot:[selectedBox[0],selectedBox[1]]})} onRotate={degrees=>void transformSelection({kind:'rotate',degrees,pivot:[(selectedBox[0]+selectedBox[2])/2,(selectedBox[1]+selectedBox[3])/2]})} onValidity={setSizeValid}/>:<p className="muted">No copies selected. Add a copy using its quantity to move or resize this part.</p>}
          <RotationControl key={JSON.stringify([selected,mixedRotations,chosen.rotations])} rule={chosen.rotations} mixed={!!mixedRotations} disabled={locked} onChange={rotations=>editPart({rotations})}/>

        </section></aside>}
    </main>
    <footer className="statusbar"><div className="run-controls">{running?<button className="run-button" onClick={solver.stop}>Stop</button>:<button className="run-button" disabled={locked||invalidSettings||!doc.parts.some(part=>part.quantity>0)||!!polygon} onClick={()=>void run()}>{result?'Run again':'Nest parts'}</button>}</div>
      <div className="run-status"><span className="status-symbol" aria-hidden="true"><i className={running||busy?'active':undefined}/></span><span role="status" className="run-state"><span>{busy?'Checking inputs':loadingExample?'Loading example…':solver.state}{running&&` · ${solver.elapsed.toFixed(1)} s`}</span></span>{solver.workers&&<small className="worker-status" title={solver.workers.reason} data-worker-count={solver.workers.actual}>{`${solver.workers.actual} solver worker${solver.workers.actual===1?'':'s'}`}{solver.workers.requested?` / ${solver.workers.requested} requested`:' · automatic'}{solver.workers.reason&&' · fallback'}</small>}</div>
      <div className="metrics"><span>{showingLive?'Best checked length':'Used length'} <strong>{result?`${length(result.usedLengthMm)} ${unit}`:'—'}</strong></span><span>Material utilization <strong>{result?`${utilization.toFixed(1)}%`:'—'}</strong></span>{result&&first&&<span>Length improvement <strong>{((1-result.usedLengthMm/first.lengthMm)*100).toFixed(1)}%</strong></span>}</div>
      {!running&&<div className="export-actions"><select aria-label="Export format" value={exportFormat} onChange={e=>setExportFormat(e.target.value as 'svg'|'dxf')}><option value="svg">SVG</option><option value="dxf">DXF</option></select><button disabled={locked||!result} className="primary" onClick={()=>void exportLayout()}>Download {exportFormat.toUpperCase()}</button></div>}<button className="diagnostics-button" onClick={diagnostics}>Diagnostics</button>

    </footer>
    {files&&<Modal title="Review import" locked={busy} onClose={()=>{setFiles(undefined);setReview(undefined);setError('');}}><p>{files.map(f=>f.name).join(', ')}</p><p className="muted">{fileIntent==='project'?'Project files restore a complete job. Drawing files can be added as shapes.':'SVG, DXF and instance JSON add shapes. A saved project restores a complete job.'}</p>
      {!review?.replace&&<><label>One drawing unit<select value={scale} disabled={busy} onChange={e=>{setScale(Number(e.target.value));setPreviewStale(true);}}><option value="1">1 mm</option><option value="25.4">1 inch · 25.4 mm</option></select></label><p className="muted">Physical SVG dimensions and recognized DXF units are honored. Instance JSON and drawings without units use the selected scale.</p></>}
      {files.some(f=>!f.text.trimStart().startsWith('{'))&&<><label>Maximum curve deviation, {unit}<input type="number" min={0.000001/factor} max={100/factor} step="any" value={inputLength(tolerance)} disabled={busy} onChange={e=>{setTolerance(e.target.valueAsNumber*factor);setPreviewStale(true);}}/></label>{files.some(f=>!['<','{'].includes(f.text.trimStart()[0]))&&<label>Enclosed contours<select value={enclosed} disabled={busy} onChange={e=>{const value=e.target.value as 'holes'|'parts';setEnclosed(value);setPreviewStale(true);}}><option value="holes">Treat as holes</option><option value="parts">Treat as separate parts</option></select></label>}</>}
      {availableLayers.length>0&&<fieldset><legend>DXF layers</legend>{availableLayers.map(layer=><label className="checkbox" key={layer}><input type="checkbox" disabled={busy} checked={(layers??availableLayers).includes(layer)} onChange={e=>{setLayers(e.target.checked?[...(layers??availableLayers),layer]:(layers??availableLayers).filter(l=>l!==layer));setPreviewStale(true);}}/>{layer}</label>)}</fieldset>}
      {error&&<p role="alert" className="field-error">{error}</p>}
      {review&&<>{previewStale&&<p role="status">Preview outdated. Update preview to apply your settings.</p>}<p>{review.document.parts.length} part types · {review.document.parts.reduce((n,p)=>n+p.quantity,0)} copies · {review.document.parts.reduce((n,p)=>n+p.holes.length,0)} holes</p><p>Material width {length(review.document.settings.materialWidthMm)} {unit}</p><div className="import-parts" aria-label="Imported shapes">{review.document.parts.map((p,i)=>{const b=bounds(p.outer);return <div key={p.id}><svg aria-hidden="true" viewBox={`${b[0]-1} ${-b[3]-1} ${b[2]-b[0]+2} ${b[3]-b[1]+2}`}><path d={pathData([p.outer,...p.holes])} transform="scale(1 -1)" fillRule="evenodd" fill={colors[i%colors.length]}/></svg><span>{p.name}<small>{length(b[2]-b[0])} × {length(b[3]-b[1])} {unit} · {p.quantity} copies{p.holes.length?` · ${p.holes.length} holes`:''}</small></span></div>;})}</div><ul>{review.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>{review.replace?<p>This is a saved project. Opening it restores its name, material, shapes and checked result.</p>:<p>Shapes will be added to {doc.name}. Its name and material settings stay the same.</p>}</>}
      {!!review?.issues?.length&&<><p className="field-error">These contours cannot be imported:</p><ul>{review.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul><label className="checkbox"><input type="checkbox" checked={excludeIssues} onChange={e=>setExcludeIssues(e.target.checked)}/>Exclude the listed invalid contours</label></>}
      {review&&!review.replace&&files.length===1&&review.document.parts.length>0&&review.document.parts.every(part=>part.source.format==='sparrow')&&<button disabled={busy||previewStale||!!review.issues?.length&&!excludeIssues} onClick={()=>void accept(true)}>Open as new project</button>}
      <div className="modal-actions"><button disabled={busy} onClick={()=>{setFiles(undefined);setReview(undefined);setError('');}}>Cancel</button>{review&&!previewStale?<button disabled={busy||!review.replace&&!review.document.parts.length||!!review.issues?.length&&!excludeIssues} className="primary" onClick={()=>void accept()}>{review.replace?'Open project':`Add ${review.document.parts.length} shape${review.document.parts.length===1?'':'s'} to project`}</button>:<button disabled={busy} className="primary" onClick={()=>void preview()}>{busy?'Checking…':review?'Update preview':'Preview import'}</button>}</div>
    </Modal>}
    {shape&&<Modal title="Add shape" locked={busy} onClose={()=>setShape(undefined)}><form onSubmit={e=>{e.preventDefault();if(busy)return;if(shape==='polygon'){cancelDefaultExample();setShape(undefined);setPolygon([]);}else void addShape(shape);}}><label>Shape<select value={shape} onChange={e=>setShape(e.target.value as typeof shape)} disabled={busy}><option value="rectangle">Rectangle</option><option value="circle">Circle</option><option value="polygon">Draw polygon</option></select></label>
      {shape!=='polygon'&&<label>{`${shape==='circle'?'Diameter':'Width'}, ${unit}`}<input type="number" min={0.000001/factor} max={100000/factor} step="any" value={inputLength(shapeWidth)} onChange={e=>setShapeWidth(e.target.valueAsNumber*factor)} disabled={busy}/></label>}
      {shape==='rectangle'&&<label>Height, {unit}<input type="number" min={0.000001/factor} max={100000/factor} step="any" value={inputLength(shapeHeight)} onChange={e=>setShapeHeight(e.target.valueAsNumber*factor)} disabled={busy}/></label>}
      {shape==='polygon'&&<p>Click each vertex in the canvas. Enter closes the polygon; Escape cancels. The contour is checked before it is added.</p>}{error&&<p role="alert" className="field-error">{error}</p>}
      <div className="modal-actions"><button type="button" disabled={busy} onClick={()=>setShape(undefined)}>Cancel</button><button disabled={busy} className="primary">{shape==='polygon'?'Start drawing':'Add shape'}</button></div></form>
    </Modal>}
    {examples&&<ExamplePicker onClose={()=>setExamples(false)} onChoose={async(next,nest)=>{const document=await prepareDocument(next,[],true);setExamples(false);requestProject({document,nest});}}/>}
    {library&&<ShapeLibrary unit={unit} selectedParts={doc.parts.filter(p=>selected.includes(p.id))} onClose={()=>setLibrary(false)} onAdd={async parts=>{setBusy(true);try{await addParts(parts);}finally{setBusy(false);}}}/>}
    {nameDialog&&<Modal title={nameDialog==='new'?'New project':'Rename project'} onClose={()=>setNameDialog(undefined)}><form onSubmit={e=>{e.preventDefault();const name=projectName.trim();if(!name)return;if(nameDialog==='new')requestProject({document:emptyProject(name),saved:true});else if(name!==doc.name)commit({...doc,name},false);setNameDialog(undefined);}}><label>Project name<input autoFocus onFocus={e=>e.currentTarget.select()} required maxLength={200} value={projectName} onChange={e=>setProjectName(e.target.value)}/></label><div className="modal-actions"><button type="button" onClick={()=>setNameDialog(undefined)}>Cancel</button><button className="primary" disabled={!projectName.trim()}>{nameDialog==='new'?'Create project':'Rename'}</button></div></form></Modal>}
    {pendingProject&&<Modal title="Unsaved project" locked={busy} onClose={()=>setPendingProject(undefined)}><p>Save {doc.name} before opening {pendingProject.document.name}?</p><p className="muted">Downloads a ZIP with your editable project, CLI input, and any checked SVG/DXF. Open it later to continue.</p>{polygon&&<p>Finish or cancel the polygon before saving, or discard it to continue.</p>}{error&&<p role="alert" className="field-error">{error}</p>}<div className="modal-actions"><button disabled={busy} onClick={()=>setPendingProject(undefined)}>Cancel</button><button disabled={busy} onClick={()=>switchProject(pendingProject)}>Discard changes</button><button className="primary" disabled={busy||invalidSettings||!!polygon} onClick={async()=>{if(await saveProject())switchProject(pendingProject);}}>Save project and continue</button></div></Modal>}
    {info&&<Modal title={info==='about'?'About sparrow/studio':info==='contact'?'Say hello':'Supported formats'} onClose={()=>setInfo(undefined)}>
      {info==='about'?<><label>Display units<select value={unit} onChange={e=>setUnit(e.target.value as DisplayUnit)}><option value="mm">Millimetres</option><option value="in">Inches</option></select></label><label>Appearance<select value={theme} onChange={e=>setTheme(e.target.value as typeof theme)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><p>Explore true-shape nesting in your browser. Arrange irregular shapes to use less material, for projects such as textile and garment cutting, CNC routing, laser cutting, and woodworking. Import SVG or DXF shapes and export the nested layout for your cutting software.</p><p>A native sparrow binary runs about 2× as fast as this browser demo.</p><p>Powered by sparrow, Jeroen Gardeyn’s irregular strip packing algorithm for fitting parts into a strip of fixed material width while minimizing the length used.</p><p><a href="https://arxiv.org/abs/2509.13329" target="_blank" rel="noreferrer">Read the paper</a></p><p>Files and geometry stay on your device. No accounts or cloud file storage. Cloudflare Web Analytics measures site traffic and performance without cookies. Project names, shapes, and uploaded files are not sent to analytics.</p><p><a href="https://github.com/JeroenGar/sparrow-studio" target="_blank" rel="noreferrer">Source code on GitHub ↗</a></p><button onClick={diagnostics}>Download diagnostics</button><div ref={mountNestingAbout}/></>:info==='contact'?<><p>I’d like to hear how you’re using sparrow and what you’d like to do with it next.</p><div className="contact-links"><a href="https://www.linkedin.com/in/jeroengardeyn/" target="_blank" rel="noreferrer" aria-label="LinkedIn ↗"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="3" fill="currentColor"/><path d="M7 10v8m0-12v1m4 11v-8m0 4c0-5 6-5 6 0v4" fill="none" stroke="var(--panel)" strokeWidth="2.5"/></svg>in/jeroengardeyn/</a><a href="mailto:jeroen.gardeyn@gmail.com"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m3 6 9 7 9-7"/></svg>jeroen.gardeyn@gmail.com</a></div></>:<><h2>Preparation shortcuts</h2><p><kbd>R</kbd> cycles permitted orientations (90° for free rotation). <kbd>⌘/Ctrl+D</kbd> adds copies of the selection. <kbd>Backspace</kbd> removes selected copies; zero-quantity shapes stay in the parts pane. <kbd>+</kbd> or <kbd>=</kbd> increases their quantity. <kbd>−</kbd> or <kbd>_</kbd> decreases it.</p><p>Shortcuts work while the canvas or another non-editable control has focus. Quantity changes stay within the 500-copy project limit.</p><p>Open sparrow instance JSON or SVG closed paths, rectangles, circles, ellipses, polygons, and local references. Text must be outlined elsewhere. SVG styles, transforms and repeated shapes are resolved on import. Separate paths become independent parts; holes come from subpaths within the same path. Clipping, masks, filters and external references are unsupported.</p><p>ASCII DXF supports closed outlines built from lines, arcs, circles, ellipses, polylines, and degree 1–3 splines with positive weights. Transformed blocks and repeated inserts are expanded. Select layers in the preview. Open or invalid contours are listed for exclusion. Binary DXF, hatches, dimensions, text, and 3D entities are unsupported.</p><p>Holes are preserved; nesting inside holes is not supported. Clearance is a part-to-part gap, not cutting kerf.</p></>}
      <div className="modal-actions"><button onClick={()=>setInfo(undefined)}>Close</button></div></Modal>}
  </div>;
}
