import {useEffect,useState} from 'react';
import {DEFAULT_SETTINGS,type Part} from '../model';
import {bounds} from '../geometry/normalize';
import {pathData} from '../geometry/path';
import {geometryTask} from '../workers/geometryTask';
import {readShapes,saveShapes,removeShape} from '../storage/shapes';
import Modal from './Modal';
import SizeControls from './SizeControls';
import {unitScale,type DisplayUnit} from '../units';
import './ShapeLibrary.css';

type Dataset={id:string;file:string;group:string;continuous:boolean};
export default function ShapeLibrary({selectedParts=[],onAdd,onClose,onExample,unit='mm'}:{unit?:DisplayUnit;selectedParts?:Part[];onAdd:(part:Part)=>void|Promise<void>;onClose:()=>void;onExample?:(text:string,fileName:string)=>void|Promise<void>}) {
  const [catalog,setCatalog]=useState<Dataset[]>([]),[source,setSource]=useState('mine');
  const [mine,setMine]=useState<Part[]>([]),[parts,setParts]=useState<Part[]>([]),[chosen,setChosen]=useState<Part>();
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[valid,setValid]=useState(true);
  const [error,setError]=useState(''),[storageError,setStorageError]=useState(''),[notice,setNotice]=useState('');
  const [raw,setRaw]=useState<{text:string;fileName:string}>();
  useEffect(()=>{
    let current=true;
    readShapes().then(p=>{if(current)setMine(p);}).catch(e=>{if(current)setStorageError(String(e.message??e));}).finally(()=>{if(current)setLoading(false);});
    fetch(new URL('examples/catalog.json',document.baseURI)).then(async r=>{if(!r.ok)throw Error('Could not load datasets.');return r.json();}).then(data=>{if(current)setCatalog(data.datasets);}).catch(e=>{if(current)setError(String(e.message??e));});
    return()=>{current=false;};
  },[]);
  useEffect(()=>{
    let current=true;setChosen(undefined);setRaw(undefined);setError('');setNotice('');
    if(source==='mine'){setParts(mine);return;}
    const dataset=catalog.find(d=>d.id===source);if(!dataset)return;
    setParts([]);setBusy(true);
    (async()=>{
      const response=await fetch(new URL(`examples/${dataset.file}`,document.baseURI));
      if(!response.ok)throw Error(`Could not load ${dataset.id}.`);
      const text=await response.text();
      const reply=await geometryTask({type:'library',runId:0,documentRevision:0,text,fileName:dataset.file});
      if(current&&reply.type==='normalized'){setParts(reply.document.parts);setRaw({text,fileName:dataset.file});}
    })().catch(e=>{if(current)setError(String(e.message??e));}).finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;};
  },[source,mine,catalog]);
  async function perform(action:()=>Promise<void>) {
    setBusy(true);setError('');setNotice('');
    try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  function save(parts:Part[]) {
    void perform(async()=>{
      const saved=await saveShapes(parts);setMine(await readShapes());setNotice(`${saved.length===1?'Shape saved':`${saved.length} shapes saved`} on this device.`);
    });
  }
  function resize(axis:0|1,sizeMm:number) {
    if(!chosen)return;
    const b=bounds(chosen.outer);if(sizeMm===b[axis+2]-b[axis])return;
    void perform(async()=>{
      const reply=await geometryTask({type:'resize',runId:0,documentRevision:0,document:{name:'Library shape',parts:[chosen],settings:DEFAULT_SETTINGS},partId:chosen.id,axis,sizeMm});
      if(reply.type==='normalized')setChosen(reply.document.parts[0]);
    });
  }
  const blocked=busy||loading;
  return <Modal title="Shape library" onClose={onClose} locked={busy}>
    <div className="shape-library">
      <div className="library-source"><label>Collection<select value={source} disabled={blocked} onChange={e=>setSource(e.target.value)}><option value="mine">My shapes ({mine.length})</option>{['Main','Gardeyn'].map(group=><optgroup key={group} label={group}>{catalog.filter(d=>d.group===group).map(d=><option key={d.id} value={d.id}>{d.id}{d.continuous?' · free rotation':''}</option>)}</optgroup>)}</select></label>
        {selectedParts.length>0&&<button disabled={blocked||!!storageError} onClick={()=>save(selectedParts)}>Save selected {selectedParts.length===1?'shape':'shapes'}</button>}
      </div>
      <p className="library-note">{source==='mine'?'Saved in this browser on this device. Download projects as backups.':`Each dataset uses one scale factor, with median shape area ${unit==='mm'?'2,500':(2500/unitScale(unit)**2).toPrecision(4)} ${unit}². Relative sizes stay intact.`}</p>
      {storageError&&<p role="alert" className="field-error">{storageError}</p>}
      {error&&<p role="alert" className="field-error">{error}</p>}
      {(busy||loading)&&<p role="status">Loading shapes…</p>}
      {notice&&<p role="status">{notice}</p>}
      <div className="library-layout"><div className="library-grid" aria-label="Library shapes">
        {parts.map(p=><button key={p.id} aria-pressed={chosen?.id===p.id} disabled={blocked} onClick={()=>{setChosen(p);setNotice('');}}><Preview part={p}/><span>{p.name}</span></button>)}
        {!parts.length&&!blocked&&<p>{source==='mine'?'Select shapes in your drawing and save them here, or choose a dataset.':'No shapes in this collection.'}</p>}
      </div>
      {chosen&&<div className="library-detail"><h3>{chosen.name}</h3><Preview part={chosen}/><SizeControls unit={unit} key={chosen.id} part={chosen} disabled={blocked} onApply={resize} onValidity={setValid}/>
        <small>{chosen.holes.length?`${chosen.holes.length} hole${chosen.holes.length===1?'':'s'} · `:''}{chosen.rotations.kind==='continuous'?'Free rotation':`${chosen.rotations.degrees.join('°, ')}°`}</small>
        <button className="primary" disabled={blocked||!valid} onClick={()=>void perform(async()=>{await onAdd({...chosen,id:crypto.randomUUID(),quantity:1,preparationPosition:[0,0]});setNotice('Shape added to your drawing.');})}>Add to drawing</button>
        <button disabled={blocked||!valid||!!storageError} onClick={()=>save([chosen])}>Save as new personal shape</button>
        {source==='mine'&&<button disabled={blocked||!!storageError} onClick={()=>void perform(async()=>{await removeShape(chosen.id);setChosen(undefined);setMine(await readShapes());})}>Remove saved shape</button>}
      </div>}</div>
      <div className="library-footer">{raw&&onExample&&<button disabled={blocked} onClick={()=>void perform(async()=>{await onExample(raw.text,raw.fileName);})}>Open original benchmark</button>}<button disabled={busy} onClick={onClose}>Done</button></div>
    </div>
  </Modal>;
}
function Preview({part}:{part:Part}) {
  const [x0,y0,x1,y1]=bounds(part.outer),pad=Math.max(x1-x0,y1-y0)*.08;
  return <svg aria-hidden="true" viewBox={`${x0-pad} ${-y1-pad} ${x1-x0+pad*2} ${y1-y0+pad*2}`}><path transform="scale(1 -1)" d={pathData([part.outer,...part.holes])} fill="var(--accent)" fillOpacity=".22" fillRule="evenodd" stroke="var(--accent)" vectorEffect="non-scaling-stroke"/></svg>;
}
