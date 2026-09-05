import { useEffect, useMemo, useRef, useState } from 'react';
import { example, POLICY, type Document, type Part, type Point } from './model';
import { bounds } from './geometry/normalize';
import { netArea } from './geometry/validate';
import { pathData } from './geometry/path';
import { geometryTask } from './workers/geometryTask';
import { useSolver } from './workers/useSolver';
import type { ImportReview } from './import/sparrow';
import Workspace,{colors} from './components/Workspace';
import Modal from './components/Modal';
import SelectionControls from './components/SelectionControls';
import ShapeLibrary from './components/ShapeLibrary';
import ExamplePicker from './components/ExamplePicker';
import {displayLength,unitScale,type DisplayUnit} from './units';
import {selectionBounds,type GeometryEdit} from './geometry/manipulate';

const validQuantity=(n:number)=>Number.isInteger(n)&&n>=1&&n<=500;
function download(name:string,text:string,type='application/json') {
  const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function App() {
  const [doc,setDoc]=useState<Document>(example),[revision,setRevision]=useState(1),[selected,setSelected]=useState<string[]>([]);
  const [view,setView]=useState<'prepare'|'result'>('prepare'),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [fitRequest,setFitRequest]=useState(0);
  const [resultMode,setResultMode]=useState<'live'|'checked'>('live');
  const [threads,setThreads]=useState(0),[library,setLibrary]=useState(false),[examples,setExamples]=useState(false);
  const [sizeValid,setSizeValid]=useState(true),[engaged,setEngaged]=useState(false);
  const [theme,setTheme]=useState<'system'|'light'|'dark'>(()=>{try{const saved=localStorage.getItem('sparrow-theme');return saved==='light'||saved==='dark'||saved==='system'?saved:'dark';}catch{return 'dark';}});
  useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('sparrow-theme',theme);}catch{/* The theme still works when storage is unavailable. */}},[theme]);
  const [unit,setUnit]=useState<DisplayUnit>(()=>{try{return localStorage.getItem('sparrow-units')==='in'?'in':'mm';}catch{return 'mm';}});
  useEffect(()=>{try{localStorage.setItem('sparrow-units',unit);}catch{/* Display units work without persistence. */}},[unit]);
  const factor=unitScale(unit),length=(mm:number)=>(mm/factor).toLocaleString(undefined,{maximumFractionDigits:unit==='mm'?2:4});
  const inputLength=(mm:number)=>Number.isFinite(mm)?displayLength(mm,unit):'';
  const [panel,setPanel]=useState(true),[info,setInfo]=useState<'about'|'contact'|'help'>();
  const [files,setFiles]=useState<{name:string;text:string}[]>(),[scale,setScale]=useState(1),[review,setReview]=useState<ImportReview>(),[append,setAppend]=useState(false);
  const [tolerance,setTolerance]=useState(.01),[enclosed,setEnclosed]=useState<'holes'|'parts'>('holes');
  const [layers,setLayers]=useState<string[]>(),[availableLayers,setAvailableLayers]=useState<string[]>([]),[excludeIssues,setExcludeIssues]=useState(false);
  const [importWarnings,setImportWarnings]=useState<string[]>([]);
  const [exportFormat,setExportFormat]=useState<'svg'|'dxf'>('svg');
  const [replaceConfirmed,setReplaceConfirmed]=useState(false);
  const [shape,setShape]=useState<'rectangle'|'circle'|'polygon'>(),[shapeWidth,setShapeWidth]=useState(40),[shapeHeight,setShapeHeight]=useState(30),[polygon,setPolygon]=useState<Point[]>();
  const history=useRef<{doc:Document;geometry:boolean}[]>([]),future=useRef<{doc:Document;geometry:boolean}[]>([]),operation=useRef(0);
  const input=useRef<HTMLInputElement>(null),solver=useSolver();
  const running=['Initializing','Running','Checking'].includes(solver.state),locked=running||busy;
  const result=solver.result?.documentRevision===revision?solver.result:undefined;
  const live=solver.live?.result.documentRevision===revision?solver.live:undefined;
  const showingLive=resultMode==='live'&&!!live;
  const chosen=doc.parts.find(p=>p.id===selected[0]);
  const selectedBox=useMemo(()=>selectionBounds(doc,selected),[doc,selected]);
  const invalidSettings=!sizeValid||!Number.isFinite(doc.settings.materialWidthMm)||doc.settings.materialWidthMm<=0||doc.settings.materialWidthMm>100_000||!Number.isFinite(doc.settings.clearanceMm)||doc.settings.clearanceMm<0||doc.settings.clearanceMm>=doc.settings.materialWidthMm||doc.parts.some(p=>!validQuantity(p.quantity))||doc.parts.reduce((n,p)=>n+p.quantity,0)>500;
  function commit(next:Document,geometry=true) {
    history.current=[...history.current.slice(-49),{doc,geometry}];future.current=[];
    setDoc(next);setDirty(true);setEngaged(true);setError('');
    if(geometry) {setRevision(r=>r+1);solver.invalidate();setView('prepare');}
  }
  async function prepareDocument(next:Document,pinnedIds:string[]=[],compact=false) {
    const reply=await geometryTask({type:'prepare-layout',runId:++operation.current,documentRevision:revision,document:next,pinnedIds,compact});
    if(reply.type!=='normalized')throw Error('Could not arrange the preparation drawing.');
    return {...next,parts:next.parts.map((part,i)=>({...part,preparationPosition:reply.document.parts[i].preparationPosition}))};
  }
  async function arrange(next:Document,geometry=false,pinnedIds:string[]=[],compact=false) {
    if(locked)return;setBusy(true);setError('');
    try {
      if(geometry){const check=await geometryTask({type:'normalize',runId:++operation.current,documentRevision:revision,document:next});if(check.type!=='normalized')return;next=check.document;}
      commit(await prepareDocument(next,pinnedIds,compact),geometry);
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  function restore(redo=false) {
    if(locked) return;
    const from=redo?future:history,to=redo?history:future,entry=from.current.pop();
    if(!entry) return;
    to.current.push({doc,geometry:entry.geometry});setDoc(entry.doc);setDirty(true);
    if(entry.geometry) {setRevision(r=>r+1);solver.invalidate();setView('prepare');}
  }
  useEffect(()=>{
    const leave=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',leave);return ()=>window.removeEventListener('beforeunload',leave);
  },[dirty]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(document.querySelector('dialog[open]'))return;
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {e.preventDefault();restore(e.shiftKey);}
      if(e.key==='Escape') {setSelected([]);setPolygon(undefined);}
      if(e.key==='Enter'&&polygon&&!locked) {e.preventDefault();void addShape('polygon');}
    };
    window.addEventListener('keydown',key);return ()=>window.removeEventListener('keydown',key);
  });
  const hasLayout=!!(result||live);
  useEffect(()=>{if(hasLayout&&running)setView('result');},[hasLayout,running]);
  async function run(document=doc,rev=revision,seconds?:10) {
    setEngaged(true);setBusy(true);setError('');
    const id=++operation.current;
    try {
      const reply=await geometryTask({type:'normalize',runId:id,documentRevision:rev,document});
      if(id!==operation.current || reply.type!=='normalized') return;
      solver.start(seconds?{...reply.document,settings:{...reply.document.settings,timeLimitSeconds:seconds}}:reply.document,rev,threads||undefined);
    } catch(e) {setError(String(e));} finally {if(id===operation.current)setBusy(false);}
  }
  async function openFiles(list:FileList|File[]) {
    if(locked) return;
    const batch=Array.from(list);
    if(batch.some(f=>f.size>10*1024*1024)||batch.reduce((n,f)=>n+f.size,0)>25*1024*1024) {setError('Import limit: 10 MiB per file and 25 MiB per batch.');return;}
    setError('');setReview(undefined);setScale(1);setAppend(dirty||batch.length>1);setLayers(undefined);setAvailableLayers([]);setExcludeIssues(false);setReplaceConfirmed(false);setFiles(await Promise.all(batch.map(async f=>({name:f.name,text:await f.text()}))));
  }
  async function preview(contours=enclosed) {
    if(!files) return;setBusy(true);setError('');setReview(undefined);setExcludeIssues(false);
    try {const reply=await geometryTask({type:'import',runId:++operation.current,documentRevision:revision,files,scale,tolerance,enclosed:contours,layers});if(reply.type==='import-review'){setReview(reply.review);setAvailableLayers(reply.review.layers??[]);}}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function accept() {
    if(!review||!review.document.parts.length||review.issues?.length&&!excludeIssues||review.replace&&dirty&&!replaceConfirmed) return;
    const next=append&&!review.replace?{...doc,parts:[...doc.parts,...review.document.parts]}:review.document;
    setBusy(true);
    try {
      const reply=await geometryTask({type:'normalize',runId:++operation.current,documentRevision:revision,document:next});
      if(reply.type==='normalized') {
        commit(await prepareDocument(reply.document,[],!review.replace));setFitRequest(n=>n+1);setImportWarnings(previous=>append&&!review.replace?[...previous,...review.warnings]:review.warnings);setFiles(undefined);setReview(undefined);setSelected([]);
        if(review.replace) {setDirty(false);if(review.result){solver.load({...review.result,documentRevision:revision+1});setResultMode('checked');setView('result');}}
      }
    } catch(e){setError(String(e));}finally{setBusy(false);}
  }
  function editPart(change:Partial<Part>,geometry=true) {if(chosen)commit({...doc,parts:doc.parts.map(p=>selected.includes(p.id)?{...p,...change}:p)},geometry);}
  function positionSelection(axis:0|1,value:number) {
    if(!selectedBox||locked)return;
    const delta=value-selectedBox[axis];
    void arrange({...doc,parts:doc.parts.map(p=>selected.includes(p.id)?{...p,preparationPosition:p.preparationPosition.map((v,i)=>i===axis?v+delta:v) as Point}:p)},false,selected);
  }
  async function transformSelection(edit:GeometryEdit) {
    if(locked||!selected.length)return;setBusy(true);setError('');
    try {
      const reply=await geometryTask({type:'edit-selection',runId:++operation.current,documentRevision:revision,document:doc,ids:selected,edit});
      if(reply.type==='normalized')commit(await prepareDocument(reply.document,selected));
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function addShape(kind:'rectangle'|'circle'|'polygon') {
    setBusy(true);setError('');
    try {
      const reply=await geometryTask({type:'shape',runId:++operation.current,documentRevision:revision,shape:kind,width:shapeWidth,height:shapeHeight,points:polygon});
      if(reply.type==='part') {
        const next={...doc,parts:[...doc.parts,reply.part]};
        const check=await geometryTask({type:'normalize',runId:++operation.current,documentRevision:revision,document:next});
        if(check.type==='normalized'){commit(await prepareDocument(check.document,doc.parts.map(p=>p.id)));setSelected([reply.part.id]);setShape(undefined);setPolygon(undefined);}
      }
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function exportLayout() {
    if(!result||running)return;setBusy(true);setError('');
    try {
      const reply=await geometryTask({type:'export',runId:++operation.current,documentRevision:revision,document:doc,result});
      if(reply.type==='export-result')download(`sparrow-studio-layout.${exportFormat}`,reply.bundle[exportFormat],exportFormat==='svg'?'image/svg+xml':'application/dxf');
    } catch(e){setError(String(e));}finally{setBusy(false);}
  }
  function diagnostics() {download('sparrow-studio-diagnostics.json',JSON.stringify({document:doc,documentRevision:revision,policy:POLICY,importWarnings,...solver.diagnostics.current,result},null,2));}
  async function saveProject() {
    if(locked)return;setBusy(true);setError('');
    try {
      const reply=await geometryTask({type:'save-project',runId:++operation.current,documentRevision:revision,document:doc,result});
      if(reply.type==='project-file'){download('sparrow-studio.sparrow-project.json',reply.text);setDirty(false);}
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function swim() {
    setBusy(true);setError('');
    try {const response=await fetch(`${import.meta.env.BASE_URL}examples/swim.json`);if(!response.ok)throw Error('Could not load swim.');
      setFiles([{name:'swim.json',text:await response.text()}]);setScale(1);setAppend(false);setReview(undefined);
    } catch(e){setError(String(e));}finally{setBusy(false);}
  }
  const maxApprox=useMemo(()=>Math.max(0,...doc.parts.map(p=>p.approximationToleranceMm)),[doc.parts]);
  const totalArea=useMemo(()=>doc.parts.reduce((n,p)=>n+netArea(p)*p.quantity,0),[doc.parts]);
  const utilization=result?totalArea/(doc.settings.materialWidthMm*result.usedLengthMm)*100:0;
  const first=solver.diagnostics.current?.history.find(t=>t.validation==='passed');
  return <div className="app" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void openFiles(e.dataTransfer.files);}}>
    <header className="header"><div className="brand-block"><a className="brand" aria-label="sparrow-studio" href={import.meta.env.BASE_URL}>sparrow<span> / studio</span></a><p className="tagline">State-of-the-art nesting, on your device</p></div>
      <div className="header-primary"><button onClick={()=>input.current?.click()} disabled={locked}>Open files</button><button onClick={()=>setExamples(true)} disabled={locked} aria-haspopup="dialog">Try example</button><button onClick={()=>void saveProject()} disabled={locked||invalidSettings||!doc.parts.length}>Save project</button></div>
      <nav><a className="github-link" href="https://github.com/JeroenGar/sparrow" target="_blank" rel="noreferrer" aria-label="☆ Star sparrow on GitHub"><span aria-hidden="true">☆</span>Star sparrow on GitHub</a><button onClick={()=>setInfo('about')}><span aria-hidden="true">ⓘ</span>About sparrow-studio</button>{engaged&&<button aria-label="Say hello 👋" onClick={()=>setInfo('contact')}><span aria-hidden="true">👋</span>Say hello</button>}</nav>
      <input ref={input} hidden type="file" multiple accept=".json,.svg,.dxf" onChange={e=>{if(e.target.files)void openFiles(e.target.files);e.target.value='';}}/>
    </header>
    {(error||solver.error)&&<div className="error-banner" role="alert">{error||solver.error}</div>}
    <main className="main-workspace">
      <aside id="parts-settings" className={`sidebar ${panel?'open':''}`}>
        <div className="panel-title"><h2>Parts <span>{doc.parts.reduce((n,p)=>n+p.quantity,0)}</span></h2><button onClick={()=>setInfo('help')}>Format help</button></div>
        <div className="parts-list">{doc.parts.map((p,i)=>{const b=bounds(p.outer);return <div key={p.id} className={`part-row ${selected.includes(p.id)?'selected':''}`}>
          <button className="part-select" aria-pressed={selected.includes(p.id)} onClick={e=>setSelected(e.shiftKey?(selected.includes(p.id)?selected.filter(id=>id!==p.id):[...selected,p.id]):selected.length===1&&selected[0]===p.id?[]:[p.id])}>
            <svg aria-hidden="true" viewBox={`${b[0]-2} ${-b[3]-2} ${b[2]-b[0]+4} ${b[3]-b[1]+4}`}><path d={pathData([p.outer,...p.holes])} transform="scale(1 -1)" fillRule="evenodd" fill={colors[i%colors.length]}/></svg>
            <span>{p.name}<small>{length(b[2]-b[0])} × {length(b[3]-b[1])} {unit}</small></span>
          </button><input aria-label={`Quantity for ${p.name}`} type="number" min="1" max="500" aria-invalid={!validQuantity(p.quantity)} value={Number.isFinite(p.quantity)?p.quantity:''} disabled={locked} onChange={e=>commit({...doc,parts:doc.parts.map(part=>part.id===p.id?{...part,quantity:e.target.valueAsNumber}:part)})}/>
          {!validQuantity(p.quantity)&&<small role="alert" className="field-error quantity-error">Enter a whole number from 1 to 500.</small>}
        </div>;})}</div>
        {doc.parts.reduce((n,p)=>n+(Number.isFinite(p.quantity)?p.quantity:0),0)>500&&<p role="alert" className="field-error quantity-total">This drawing exceeds the 500-copy limit. Reduce quantities to continue.</p>}
        <div className="add-shape"><button disabled={locked} onClick={()=>setShape('rectangle')}>Add shape</button><button disabled={locked} onClick={()=>setLibrary(true)}>Shape library</button></div>
        <div className="row-actions history"><button disabled={locked||!history.current.length} onClick={()=>restore()}>Undo</button><button disabled={locked||!future.current.length} onClick={()=>restore(true)}>Redo</button></div>
        <section className="settings"><h2>Material & run</h2>
          <label>Material width <span>{unit}</span><input type="number" min={0.001/factor} max={100000/factor} step="any" value={inputLength(doc.settings.materialWidthMm)} disabled={locked} onChange={e=>commit({...doc,settings:{...doc.settings,materialWidthMm:e.target.valueAsNumber*factor}})}/></label>
          {(!Number.isFinite(doc.settings.materialWidthMm)||doc.settings.materialWidthMm<=0||doc.settings.materialWidthMm>100_000)&&<small role="alert" className="field-error">Enter a positive material width up to {length(100000)} {unit}.</small>}
          <label>Clearance <span>{unit}</span><input type="number" min="0" step="any" value={inputLength(doc.settings.clearanceMm)} disabled={locked} onChange={e=>commit({...doc,settings:{...doc.settings,clearanceMm:e.target.valueAsNumber*factor}})}/></label>
          {doc.settings.clearanceMm>0&&<small>sparrow also reserves {length(doc.settings.clearanceMm)} {unit} at material edges. This is not cutting kerf.</small>}
          {(!Number.isFinite(doc.settings.clearanceMm)||doc.settings.clearanceMm<0||doc.settings.clearanceMm>=doc.settings.materialWidthMm)&&<small role="alert" className="field-error">Enter zero or a positive clearance smaller than the material width.</small>}
          <label>Run for<select value={doc.settings.timeLimitSeconds} disabled={locked} onChange={e=>commit({...doc,settings:{...doc.settings,timeLimitSeconds:Number(e.target.value) as 10|30|60|120}},false)}>{[10,30,60,120].map(s=><option value={s} key={s}>{s<60?`${s} seconds`:`${s/60} minute${s>60?'s':''}`}</option>)}</select></label>
          <details className="solver-options"><summary>Solver options</summary><label>Solver threads<select disabled={locked} value={threads} onChange={e=>setThreads(Number(e.target.value))}><option value={0}>Automatic</option>{[1,2,3].map(n=><option key={n} value={n}>{n}</option>)}</select></label><small>{crossOriginIsolated?'Automatic leaves a core free, up to 3 threads.':'This browser session uses one thread.'}</small></details>
          <small>Initialization precedes search. 80% exploration, 20% compression.</small>
          <button className="text-button" disabled={locked} onClick={()=>void swim()}>Open swim benchmark</button>
        </section>
      </aside>
      <section className="drawing-panel"><div className="view-tabs"><div role="tablist" aria-label="Workspace view"><button role="tab" aria-selected={view==='prepare'} onClick={()=>setView('prepare')}>Prepare</button><button role="tab" aria-selected={view==='result'} disabled={!result&&!live} onClick={()=>setView('result')}>Result</button></div>{view==='result'&&<div className="result-mode" role="group" aria-label="Result display"><button aria-pressed={resultMode==='live'} disabled={!live} onClick={()=>setResultMode('live')}>Live</button><button aria-pressed={resultMode==='checked'} disabled={!result} onClick={()=>setResultMode('checked')}>Checked {result&&'✓'}</button></div>}<button className="mobile-settings" aria-expanded={panel} aria-controls="parts-settings" onClick={()=>setPanel(!panel)}>Settings</button><span>{doc.name}</span></div>
        <Workspace unit={unit} fitRequest={fitRequest} document={doc} result={showingLive?live.result:result} live={showingLive?live:undefined} view={view} selected={selected} disabled={locked} onTransform={transformSelection}
          polygon={polygon} onDraw={point=>{if(!locked)setPolygon(p=>[...(p??[]),point]);}}
          onSelect={(id,toggle)=>setSelected(!id?[]:toggle?(selected.includes(id)?selected.filter(p=>p!==id):[...selected,id]):[id])}
          onMove={positions=>{const moved=new Map(positions.map(p=>[p.id,p.position]));return arrange({...doc,parts:doc.parts.map(p=>moved.has(p.id)?{...p,preparationPosition:moved.get(p.id)!}:p)},false,positions.map(p=>p.id));}}/>
        {polygon&&<div className="polygon-actions"><span>{polygon.length} vertices</span><button disabled={locked||polygon.length<3} onClick={()=>void addShape('polygon')}>Finish polygon</button><button onClick={()=>setPolygon(undefined)}>Cancel polygon</button></div>}
        {showingLive&&view==='result'&&<div className="result-details live-details"><span className="live-label">{running?'Live search':'Last live layout'}</span><span><i className="overlap-key"/>Overlaps in red</span><p>Intermediate layouts may overlap. {result?'Downloads use the best checked layout.':'Waiting for a checked layout before downloads are available.'}</p></div>}
        {solver.liveError&&<p className="field-error">Live preview unavailable: {solver.liveError}</p>}
        {result&&(!showingLive||view==='prepare')&&<div className="result-details"><span className="checked">✓ Geometry checked</span><span>{maxApprox?`Curves approximated to ${displayLength(maxApprox,unit)} ${unit}`:'Polygonal contours'}</span>
          <details><summary>Check details</summary><p>Outer footprints, holes, copy counts, rotations, boundaries, overlap, and clearance. Boundary/clearance tolerance {POLICY.linearMm} mm; overlap threshold {POLICY.overlapMm2} mm² per pair. This is not manufacturing certification.</p></details>
        </div>}
      </section>
        {chosen&&selectedBox&&<aside className="selection-panel" aria-label="Part properties"><div className="panel-title"><h2>Part properties</h2><button aria-label="Clear selection" onClick={()=>setSelected([])}>×</button></div><section className="part-settings">{selected.length===1?<label>Name<input value={chosen.name} disabled={locked} onChange={e=>editPart({name:e.target.value},false)}/></label>:<h2>{selected.length} parts selected</h2>}
          <SelectionControls key={JSON.stringify(selected)} unit={unit} box={selectedBox} disabled={locked} onPosition={positionSelection} onSize={(axis,value)=>void transformSelection({kind:'scale',factor:value/(selectedBox[axis+2]-selectedBox[axis]),pivot:[selectedBox[0],selectedBox[1]]})} onRotate={degrees=>void transformSelection({kind:'rotate',degrees,pivot:[(selectedBox[0]+selectedBox[2])/2,(selectedBox[1]+selectedBox[3])/2]})} onValidity={setSizeValid}/>
          <label>Permitted rotations<select disabled={locked} value={chosen.rotations.kind==='continuous'?'free':JSON.stringify(chosen.rotations.degrees)} onChange={e=>{if(e.target.value==='custom'){const text=prompt('Allowed degrees, separated by commas',chosen.rotations.kind==='discrete'?chosen.rotations.degrees.join(', '):'0, 180');if(text!==null){const degrees=text.split(',').map(s=>s.trim()===''?NaN:Number(s));if(degrees.length&&degrees.every(Number.isFinite))editPart({rotations:{kind:'discrete',degrees}});else setError('Enter a nonempty list of finite degrees.');}}else editPart({rotations:e.target.value==='free'?{kind:'continuous'}:{kind:'discrete',degrees:JSON.parse(e.target.value)}});}}>
            <option value="[0]">Fixed 0°</option><option value="[0,180]">Half-turns · 0°, 180°</option><option value="[0,90,180,270]">Quarter-turns</option><option value="free">Free rotation</option>
            {chosen.rotations.kind==='discrete'&&!['[0]','[0,180]','[0,90,180,270]'].includes(JSON.stringify(chosen.rotations.degrees))&&<option value={JSON.stringify(chosen.rotations.degrees)}>{chosen.rotations.degrees.join(', ')}°</option>}<option value="custom">Custom degrees…</option>
          </select></label>
          <div className="row-actions"><button disabled={locked} onClick={()=>void arrange({...doc,parts:[...doc.parts,...doc.parts.filter(p=>selected.includes(p.id)).map(p=>({...structuredClone(p),id:crypto.randomUUID(),name:`${p.name} copy`}))]},true,doc.parts.map(p=>p.id))}>Duplicate</button><button disabled={locked} onClick={()=>{commit({...doc,parts:doc.parts.filter(p=>!selected.includes(p.id))});setSelected([]);}}>Delete</button></div>
        </section></aside>}
    </main>
    <footer className="statusbar"><div className="run-controls">{running?<button className="run-button" onClick={solver.stop}>Stop</button>:<button className="run-button" disabled={locked||invalidSettings||!doc.parts.length||!!polygon} onClick={()=>void run()}>{result?'Run again':'Nest parts'}</button>}<span role="status" className="run-status"><i className={running||busy?'active':''}/>{busy?'Checking inputs':solver.state}{running&&` · ${solver.elapsed.toFixed(1)} s`}</span></div>
      <div className="metrics"><span>{showingLive?'Best checked length':'Used length'} <strong>{result?`${length(result.usedLengthMm)} ${unit}`:'—'}</strong></span><span>Material utilization <strong>{result?`${utilization.toFixed(1)}%`:'—'}</strong></span>{result&&first&&<span>Length improvement <strong>{((1-result.usedLengthMm/first.lengthMm)*100).toFixed(1)}%</strong></span>}</div>
      {!running&&<><select aria-label="Export format" value={exportFormat} onChange={e=>setExportFormat(e.target.value as 'svg'|'dxf')}><option value="svg">SVG</option><option value="dxf">DXF</option></select><button disabled={locked||!result} className="primary" onClick={()=>void exportLayout()}>Download {exportFormat.toUpperCase()}</button></>}<button onClick={diagnostics}>Diagnostics</button>
    </footer>
    {files&&<Modal title="Review import" locked={busy} onClose={()=>{setFiles(undefined);setReview(undefined);setError('');}}><p>{files.map(f=>f.name).join(', ')}</p>
      {!review?.replace&&<><label>One drawing unit<select value={scale} disabled={busy} onChange={e=>{setScale(Number(e.target.value));setReview(undefined);}}><option value="1">1 mm</option><option value="25.4">1 inch · 25.4 mm</option></select></label><p className="muted">Physical SVG dimensions and recognized DXF units are honored. Instance JSON and drawings without units use the selected scale.</p></>}
      {files.some(f=>!f.text.trimStart().startsWith('{'))&&<><label>Maximum curve deviation, {unit}<input type="number" min={0.000001/factor} max={100/factor} step="any" value={inputLength(tolerance)} disabled={busy} onChange={e=>{setTolerance(e.target.valueAsNumber*factor);setReview(undefined);}}/></label><label>Enclosed contours<select value={enclosed} disabled={busy} onChange={e=>{const value=e.target.value as 'holes'|'parts';setEnclosed(value);if(review)void preview(value);}}><option value="holes">Treat as holes</option><option value="parts">Treat as separate parts</option></select></label></>}
      {availableLayers.length>0&&<fieldset><legend>DXF layers</legend>{availableLayers.map(layer=><label className="checkbox" key={layer}><input type="checkbox" disabled={busy} checked={(layers??availableLayers).includes(layer)} onChange={e=>{setLayers(e.target.checked?[...(layers??availableLayers),layer]:(layers??availableLayers).filter(l=>l!==layer));setReview(undefined);}}/>{layer}</label>)}</fieldset>}
      {error&&<p role="alert" className="field-error">{error}</p>}
      {review&&<><p>{review.document.parts.length} part types · {review.document.parts.reduce((n,p)=>n+p.quantity,0)} copies · {review.document.parts.reduce((n,p)=>n+p.holes.length,0)} holes</p><p>Material width {length(review.document.settings.materialWidthMm)} {unit}</p><div className="import-parts" aria-label="Imported shapes">{review.document.parts.map((p,i)=>{const b=bounds(p.outer);return <div key={p.id}><svg aria-hidden="true" viewBox={`${b[0]-1} ${-b[3]-1} ${b[2]-b[0]+2} ${b[3]-b[1]+2}`}><path d={pathData([p.outer,...p.holes])} transform="scale(1 -1)" fillRule="evenodd" fill={colors[i%colors.length]}/></svg><span>{p.name}<small>{length(b[2]-b[0])} × {length(b[3]-b[1])} {unit} · {p.quantity} copies{p.holes.length?` · ${p.holes.length} holes`:''}</small></span></div>;})}</div><ul>{review.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>{review.replace?<><p>This project replaces the current parts and settings.</p>{dirty&&<label className="checkbox"><input type="checkbox" checked={replaceConfirmed} onChange={e=>setReplaceConfirmed(e.target.checked)}/>Replace my unsaved changes</label>}</>:<label className="checkbox"><input type="checkbox" checked={append} onChange={e=>setAppend(e.target.checked)}/>Append to current parts</label>}</>}
      {!!review?.issues?.length&&<><p className="field-error">These contours cannot be imported:</p><ul>{review.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul><label className="checkbox"><input type="checkbox" checked={excludeIssues} onChange={e=>setExcludeIssues(e.target.checked)}/>Exclude the listed invalid contours</label></>}
      <div className="modal-actions"><button disabled={busy} onClick={()=>{setFiles(undefined);setReview(undefined);setError('');}}>Cancel</button>{review?<button disabled={busy||!review.document.parts.length||!!review.issues?.length&&!excludeIssues||review.replace&&dirty&&!replaceConfirmed} className="primary" onClick={()=>void accept()}>{review.replace?'Load project':'Import parts'}</button>:<button disabled={busy} className="primary" onClick={()=>void preview()}>{busy?'Checking…':'Preview import'}</button>}</div>
    </Modal>}
    {shape&&<Modal title="Add shape" locked={busy} onClose={()=>setShape(undefined)}><label>Shape<select value={shape} onChange={e=>setShape(e.target.value as typeof shape)} disabled={busy}><option value="rectangle">Rectangle</option><option value="circle">Circle</option><option value="polygon">Draw polygon</option></select></label>
      {shape!=='polygon'&&<label>{`${shape==='circle'?'Diameter':'Width'}, ${unit}`}<input type="number" min={0.000001/factor} max={100000/factor} step="any" value={inputLength(shapeWidth)} onChange={e=>setShapeWidth(e.target.valueAsNumber*factor)} disabled={busy}/></label>}
      {shape==='rectangle'&&<label>Height, {unit}<input type="number" min={0.000001/factor} max={100000/factor} step="any" value={inputLength(shapeHeight)} onChange={e=>setShapeHeight(e.target.valueAsNumber*factor)} disabled={busy}/></label>}
      {shape==='polygon'&&<p>Click each vertex in the preparation view. Enter closes the polygon; Escape cancels. The contour is checked before it is added.</p>}{error&&<p role="alert" className="field-error">{error}</p>}
      <div className="modal-actions"><button disabled={busy} onClick={()=>setShape(undefined)}>Cancel</button><button disabled={busy} className="primary" onClick={()=>{if(shape==='polygon'){setShape(undefined);setPolygon([]);setView('prepare');}else void addShape(shape);}}>{shape==='polygon'?'Start drawing':'Add shape'}</button></div>
    </Modal>}
    {examples&&<ExamplePicker onClose={()=>setExamples(false)} onChoose={async next=>{const timed=await prepareDocument({...next,settings:{...next.settings,timeLimitSeconds:10 as const}},[],true);setExamples(false);commit(timed);setSelected([]);await run(timed,revision+1);}}/>}
    {library&&<ShapeLibrary unit={unit} selectedParts={doc.parts.filter(p=>selected.includes(p.id))} onClose={()=>setLibrary(false)}
      onAdd={async part=>{
        const added={...part,preparationPosition:[0,0] as Point};
        setBusy(true);
        try {
          const reply=await geometryTask({type:'normalize',runId:++operation.current,documentRevision:revision,document:{...doc,parts:[...doc.parts,added]}});
          if(reply.type!=='normalized')throw Error('Could not add this shape.');
          commit(await prepareDocument(reply.document,doc.parts.map(p=>p.id)));setSelected([added.id]);
        } finally {setBusy(false);}
      }}
      onExample={async(text,fileName)=>{await openFiles([new File([text],fileName,{type:'application/json'})]);setAppend(false);setLibrary(false);}}/>}
    {info&&<Modal title={info==='about'?'About sparrow-studio':info==='contact'?'Say hello':'Supported formats'} onClose={()=>setInfo(undefined)}>
      {info==='about'?<><label>Display units<select value={unit} onChange={e=>setUnit(e.target.value as DisplayUnit)}><option value="mm">Millimetres</option><option value="in">Inches</option></select></label><label>Appearance<select value={theme} onChange={e=>setTheme(e.target.value as typeof theme)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><p>sparrow-studio is a local workspace for preparing and nesting irregular parts.</p><p>Powered by sparrow, Jeroen Gardeyn’s heuristic for packing irregular parts into a strip of fixed material width.</p><p><a href="https://arxiv.org/abs/2509.13329" target="_blank" rel="noreferrer">Read the paper</a></p><p>Files and geometry stay on your device. No accounts, analytics, or cloud file storage.</p><p><a href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`} target="_blank" rel="noreferrer">Open-source licenses and source code</a> · <a href={`${import.meta.env.BASE_URL}sparrow-source.zip`} download>Download source</a></p><button onClick={diagnostics}>Download diagnostics</button></>:info==='contact'?<><p>I’d like to hear from you if you’re using sparrow-studio in an application or need extra features.</p><div className="contact-links"><a href="https://www.linkedin.com/in/jeroengardeyn/" target="_blank" rel="noreferrer"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="3" fill="currentColor"/><path d="M7 10v8m0-12v1m4 11v-8m0 4c0-5 6-5 6 0v4" fill="none" stroke="var(--panel)" strokeWidth="2.5"/></svg>LinkedIn ↗</a><a href="mailto:jeroen.gardeyn@gmail.com"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m3 6 9 7 9-7"/></svg>jeroen.gardeyn@gmail.com</a></div></>:<><p>Open sparrow instance JSON or SVG closed paths, rectangles, circles, ellipses, polygons, and local references. Text must be outlined elsewhere. Clipping, masks, external references, and CSS geometry are unsupported.</p><p>ASCII DXF supports planar LINE, ARC, CIRCLE, LWPOLYLINE with bulges, and ordinary 2D POLYLINE. Select layers in the preview. Binary DXF, splines, ellipses, blocks, hatches, dimensions, and 3D entities are unsupported.</p><p>Holes are preserved; nesting inside holes is not supported. Clearance is a part-to-part gap, not cutting kerf.</p></>}
      <div className="modal-actions"><button onClick={()=>setInfo(undefined)}>Close</button></div></Modal>}
  </div>;
}
