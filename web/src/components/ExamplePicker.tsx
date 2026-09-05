import {useEffect,useState} from 'react';
import {example,type Document} from '../model';
import {loadCatalog,loadExample,type Dataset} from '../datasets';
import Modal from './Modal';

export default function ExamplePicker({onChoose,onClose}:{onChoose:(doc:Document,nest:boolean)=>void|Promise<void>;onClose:()=>void}) {
  const [catalog,setCatalog]=useState<Dataset[]>([]),[selected,setSelected]=useState('workshop');
  const [doc,setDoc]=useState<Document|undefined>(example),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[catalogError,setCatalogError]=useState(''),[warnings,setWarnings]=useState<string[]>([]);
  useEffect(()=>{
    let current=true;
    loadCatalog().then(data=>{if(current)setCatalog(data);})
      .catch(e=>{if(current)setCatalogError(e instanceof Error?e.message:String(e));});
    return()=>{current=false;};
  },[]);
  async function choose(id:string) {
    setSelected(id);setError('');setWarnings([]);setDoc(undefined);
    if(id==='workshop'){setDoc(example());return;}
    const dataset=catalog.find(d=>d.id===id);if(!dataset)return;
    setBusy(true);
    try {
      const reply=await loadExample(dataset);
      setDoc(reply.document);setWarnings(reply.warnings);
    } catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  async function open(nest=false) {
    if(!doc||busy)return;setBusy(true);
    try{await onChoose(doc,nest);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  const dataset=catalog.find(d=>d.id===selected);
  return <Modal title="Try an example" onClose={onClose} locked={busy}>
    <label>Dataset<select value={selected} disabled={busy} onChange={e=>void choose(e.target.value)}>
      <option value="workshop">Workshop example</option>
      {['Main','Gardeyn'].map(group=><optgroup key={group} label={group}>{catalog.filter(d=>d.group===group).map(d=><option key={d.id} value={d.id}>{d.id}{d.continuous?' · free rotation':''}</option>)}</optgroup>)}
    </select></label>
    <p>{dataset?`${dataset.partTypes} shapes · ${dataset.copies} copies`:'4 shapes · 12 copies'} · nesting stops automatically</p>
    {busy&&<p role="status">Loading example…</p>}
    {catalogError&&<p role="alert" className="field-error">{catalogError} The workshop example is still available.</p>}
    {error&&<p role="alert" className="field-error">{error}</p>}
    {!!warnings.length&&<ul>{warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>}
    <div className="modal-actions"><button disabled={busy} onClick={onClose}>Cancel</button><button disabled={busy||!doc} onClick={()=>void open(true)}>Open and nest</button><button className="primary" disabled={busy||!doc} onClick={()=>void open()}>Open example</button></div>
  </Modal>;
}
