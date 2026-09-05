import { createRoot } from 'react-dom/client';
import App from './App';
import {loadCatalog,loadExample} from './datasets';
import {geometryTask} from './workers/geometryTask';
import type {Document} from './model';
import './styles.css';
import { prepareIsolation } from './isolation';
void prepareIsolation().then(async () => {
  let initialDocument:Document|undefined,initialError='';
  try {
    const imported=await loadExample('gardeyn2.json',AbortSignal.timeout(10000));
    const prepared=await geometryTask({type:'prepare-layout',runId:0,documentRevision:0,document:imported.document,pinnedIds:[],compact:true});
    if(prepared.type!=='normalized')throw Error('Could not arrange gardeyn2.json.');
    initialDocument=prepared.document;
  } catch(error) {initialError=`The demo could not load. You can still create or open a project. ${String(error)}`;}
  createRoot(document.getElementById('root')!).render(<App initialDocument={initialDocument} initialError={initialError}/>);
  void loadCatalog().catch(()=>{});
});
