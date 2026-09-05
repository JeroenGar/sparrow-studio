import { createRoot } from 'react-dom/client';
import App from './App';
import {geometryTask} from './workers/geometryTask';
import type {Document} from './model';
import './styles.css';
import { prepareIsolation } from './isolation';
void prepareIsolation().then(async () => {
  let initialDocument:Document|undefined,initialError='';
  try {
    const response=await fetch(new URL('examples/swim.json',document.baseURI),{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Could not load swim.json.');
    const imported=await geometryTask({type:'import',runId:0,documentRevision:0,scale:1,files:[{name:'swim.json',text:await response.text()}]});
    if(imported.type!=='import-review'||imported.review.issues?.length)throw Error('Could not read swim.json.');
    const prepared=await geometryTask({type:'prepare-layout',runId:0,documentRevision:0,document:imported.review.document,pinnedIds:[],compact:true});
    if(prepared.type!=='normalized')throw Error('Could not arrange swim.json.');
    initialDocument=prepared.document;
  } catch(error) {initialError=`The demo could not load. You can still create or open a project. ${String(error)}`;}
  createRoot(document.getElementById('root')!).render(<App initialDocument={initialDocument} initialError={initialError}/>);
});
