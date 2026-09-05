import {useEffect,useState} from 'react';
import {example,type Document} from '../model';
import {geometryTask} from '../workers/geometryTask';
import Modal from './Modal';

type Dataset={id:string;file:string;group:string;continuous:boolean;partTypes:number;copies:number};
export default function ExamplePicker({onChoose,onClose}:{onChoose:(doc:Document)=>void|Promise<void>;onClose:()=>void}) {
  const [catalog,setCatalog]=useState<Dataset[]>([]),[selected,setSelected]=useState('workshop');
  const [doc,setDoc]=useState<Document|undefined>(example),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[catalogError,setCatalogError]=useState(''),[warnings,setWarnings]=useState<string[]>([]);
  useEffect(()=>{
    const controller=new AbortController();
    fetch(new URL('examples/catalog.json',document.baseURI),{signal:controller.signal})
      .then(async response=>{if(!response.ok)throw Error('Could not load benchmarks.');return response.json();})
      .then(data=>setCatalog(data.datasets))
      .catch(e=>{if(!controller.signal.aborted)setCatalogError(e instanceof Error?e.message:String(e));});
    return()=>controller.abort();
  },[]);
  async function choose(id:string) {
    setSelected(id);setError('');setWarnings([]);setDoc(undefined);
    if(id==='workshop'){setDoc(example());return;}
    const dataset=catalog.find(d=>d.id===id);if(!dataset)return;
    setBusy(true);
    try {
      const response=await fetch(new URL(`examples/${dataset.file}`,document.baseURI));
      if(!response.ok)throw Error(`Could not load ${dataset.id}.`);
      const reply=await geometryTask({type:'import',runId:0,documentRevision:0,scale:1,files:[{name:dataset.file,text:await response.text()}]});
      if(reply.type!=='import-review')throw Error('Could not read this benchmark.');
      if(reply.review.issues?.length)throw Error(reply.review.issues.join(' '));
      setDoc(reply.review.document);setWarnings(reply.review.warnings);
    } catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  async function run() {
    if(!doc||busy)return;setBusy(true);
    try{await onChoose(doc);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  const dataset=catalog.find(d=>d.id===selected);
  return <Modal title="Try an example" onClose={onClose} locked={busy}>
    <label>Dataset<select value={selected} disabled={busy} onChange={e=>void choose(e.target.value)}>
      <option value="workshop">Workshop example</option>
      {['Main','Gardeyn'].map(group=><optgroup key={group} label={group}>{catalog.filter(d=>d.group===group).map(d=><option key={d.id} value={d.id}>{d.id}{d.continuous?' · free rotation':''}</option>)}</optgroup>)}
    </select></label>
    <p>{dataset?`${dataset.partTypes} shapes · ${dataset.copies} copies`:'4 shapes · 12 copies'} · up to 10 seconds</p>
    {busy&&<p role="status">Loading example…</p>}
    {catalogError&&<p role="alert" className="field-error">{catalogError} The workshop example is still available.</p>}
    {error&&<p role="alert" className="field-error">{error}</p>}
    {!!warnings.length&&<ul>{warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>}
    <div className="modal-actions"><button disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy||!doc} onClick={()=>void run()}>Run example</button></div>
  </Modal>;
}
