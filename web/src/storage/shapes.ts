import {DEFAULT_SETTINGS,type Part} from '../model';
import {geometryTask} from '../workers/geometryTask';

async function validate(parts:Part[]) {
  if(!parts.length)return parts;
  const reply=await geometryTask({type:'normalize',runId:0,documentRevision:0,document:{name:'My shapes',settings:DEFAULT_SETTINGS,parts}});
  if(reply.type!=='normalized')throw Error('Could not validate saved shapes.');
  return reply.document.parts;
}
function open():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    let blocked=false;
    const request=indexedDB.open('sparrow-shapes',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('shapes',{keyPath:'id'});
    request.onerror=()=>reject(Error('Shape storage is unavailable. Download your project to keep a copy.'));
    request.onblocked=()=>{blocked=true;reject(Error('Close other sparrow tabs to open shape storage.'));};
    request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>db.close();resolve(db);};
  });
}
async function transaction<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
  const db=await open();
  try{return await new Promise<T>((resolve,reject)=>{
    const tx=db.transaction('shapes',mode),request=action(tx.objectStore('shapes'));
    tx.oncomplete=()=>resolve(request.result);
    tx.onabort=()=>reject(Error(tx.error?.name==='QuotaExceededError'?'Shape storage is full. Download your project, then remove unused saved shapes.':'Could not access saved shapes. Your project has not changed.'));
    tx.onerror=()=>{};
  });}finally{db.close();}
}
export async function readShapes():Promise<Part[]> {
  return validate(await transaction('readonly',store=>store.getAll()));
}
export async function saveShapes(parts:Part[]):Promise<Part[]> {
  if(!navigator.locks)throw Error('Saving shapes needs a browser with Web Locks support. Download your project instead.');
  return navigator.locks.request('sparrow-shapes-write',()=>appendShapes(parts));
}
async function appendShapes(parts:Part[]):Promise<Part[]> {
  if(!parts.length)return [];
  const fresh=parts.map(p=>({...p,id:crypto.randomUUID(),quantity:1,preparationPosition:[0,0] as [number,number]}));
  await validate(fresh);
  // Keep the personal library within the same geometry limits as a project.
  await validate([...(await readShapes()),...fresh]);
  await transaction('readwrite',store=>{const requests=fresh.map(p=>store.add(p));return requests[requests.length-1];});
  return fresh;
}
export async function removeShape(id:string) {
  if(!navigator.locks)throw Error('Removing saved shapes needs a browser with Web Locks support.');
  await navigator.locks.request('sparrow-shapes-write',()=>transaction('readwrite',store=>store.delete(id)));
}
