import type {Project} from '../model';

async function access(mode:IDBTransactionMode,project?:Project):Promise<Project|undefined> {
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('sparrow-project',1);
    let blocked=false;
    request.onupgradeneeded=()=>request.result.createObjectStore('recovery');
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>{blocked=true;reject(Error('Project recovery storage is blocked by another tab.'));};
    request.onsuccess=()=>{if(blocked){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};
  });
  try {
    return await new Promise<Project|undefined>((resolve,reject)=>{
      const tx=db.transaction('recovery',mode),store=tx.objectStore('recovery');
      const request=project?store.put(project,'latest'):store.get('latest');
      tx.oncomplete=()=>resolve(project?undefined:request.result as Project|undefined);
      tx.onabort=()=>reject(tx.error??Error('Project recovery storage is unavailable.'));
      tx.onerror=()=>{};
    });
  } finally {db.close();}
}
export const readRecovery=()=>access('readonly');
export const saveRecovery=(project:Project)=>access('readwrite',project);
