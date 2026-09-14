import {readFile} from 'node:fs/promises';
export function archiveEntry(bytes:Uint8Array,name:string):string {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let offset=0;offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50;){
    const size=view.getUint32(offset+18,true),length=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);
    const start=offset+30+length+extra;
    if(new TextDecoder().decode(bytes.subarray(offset+30,offset+30+length))===name)return new TextDecoder().decode(bytes.subarray(start,start+size));
    offset=start+size;
  }
  throw Error(`Missing ZIP entry: ${name}`);
}
export async function readDiagnostics(path:string){return JSON.parse(archiveEntry(await readFile(path),'diagnostics.json'));}
