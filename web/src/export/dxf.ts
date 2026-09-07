import parseString from 'dxf/lib/parseString';
import type {Document,Result,Ring} from '../model';
import {validate,type WorldPart} from '../geometry/validate';

export const STUDIO_CREDIT='nested with sparrow/studio · https://sparrowstudio.app';

export function exportDXF(doc:Document,result:Result|undefined,world:WorldPart[]):string {
  let nextHandle=0x100;
  const handle=()=> (nextHandle++).toString(16).toUpperCase();
  const polyline=(ring:Ring,layer:string)=>`0\nLWPOLYLINE\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbPolyline\n90\n${ring.length}\n70\n1\n${ring.map(([x,y])=>`10\n${x}\n20\n${y}\n`).join('')}`;
  const layers=['0','PARTS','HOLES','SPARROW_INFO'].map(layer=>`0\nLAYER\n5\n${handle()}\n330\n10\n100\nAcDbSymbolTableRecord\n100\nAcDbLayerTableRecord\n2\n${layer}\n70\n0\n62\n7\n6\nCONTINUOUS\n${layer==='SPARROW_INFO'?'290\n0\n':''}`).join('');
  const entities=world.map(p=>polyline(p.outer,'PARTS')+p.holes.map(h=>polyline(h,'HOLES')).join('')).join('');
  const box=world.reduce((b,p)=>p.outer.reduce((b,[x,y])=>[Math.min(b[0],x),Math.max(b[1],x),Math.max(b[2],y)],b),[0,1,doc.settings.materialWidthMm]);
  const textHeight=Math.min(doc.settings.materialWidthMm*.025,(box[1]-box[0])/(STUDIO_CREDIT.length*.65));
  // Keep attribution as text on its own non-plotting layer, outside all contours.
  const credit=STUDIO_CREDIT.replace('·','\\U+00B7');
  const annotation=`0\nTEXT\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\nSPARROW_INFO\n100\nAcDbText\n10\n${box[0]}\n20\n${box[2]+textHeight}\n30\n0\n40\n${textHeight}\n1\n${credit}\n100\nAcDbText\n`;
  // R2000 readers such as QCAD require explicit model/paper-space ownership.
  const spaces=[['*Model_Space','21','23','24'],['*Paper_Space','22','25','26']];
  const records=spaces.map(([name,id])=>`0\nBLOCK_RECORD\n5\n${id}\n330\n20\n100\nAcDbSymbolTableRecord\n100\nAcDbBlockTableRecord\n2\n${name}\n70\n0\n`).join('');
  const blocks=spaces.map(([name,id,begin,end])=>`0\nBLOCK\n5\n${begin}\n330\n${id}\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockBegin\n2\n${name}\n70\n0\n10\n0\n20\n0\n30\n0\n3\n${name}\n1\n\n0\nENDBLK\n5\n${end}\n330\n${id}\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockEnd\n`).join('');
  const text=`0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$INSUNITS\n70\n4\n9\n$HANDSEED\n5\n${nextHandle.toString(16).toUpperCase()}\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n5\n10\n330\n0\n100\nAcDbSymbolTable\n70\n4\n${layers}0\nENDTAB\n0\nTABLE\n2\nBLOCK_RECORD\n5\n20\n330\n0\n100\nAcDbSymbolTable\n70\n2\n${records}0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}${annotation}0\nENDSEC\n0\nEOF\n`;
  const parsed=parseString(text) as {header:{insUnits:number};entities:{type:string;closed:boolean;layer:string;string?:string;vertices:{x:number;y:number}[]}[]};
  if(parsed.header.insUnits!==4)throw Error('Serialized DXF lost its millimeter units.');
  let at=0;
  const ring=(layer:string):Ring=>{
    const entity=parsed.entities[at++];
    if(entity?.type!=='LWPOLYLINE'||!entity.closed||entity.layer!==layer)throw Error('Serialized DXF lost a closed contour or layer.');
    return entity.vertices.map(p=>[p.x,p.y]);
  };
  const reparsed=world.map(p=>({...p,outer:ring('PARTS'),holes:p.holes.map(()=>ring('HOLES'))}));
  const note=parsed.entities[at++];
  if(note?.type!=='TEXT'||note.layer!=='SPARROW_INFO'||note.string!==credit)throw Error('Serialized DXF lost its attribution.');
  if(at!==parsed.entities.length||JSON.stringify(reparsed)!==JSON.stringify(world))throw Error('Serialized DXF changed canvas coordinates.');
  if(result){const check=validate(doc,result,reparsed);if(check.status!=='passed')throw Error(`Serialized DXF failed validation: ${check.errors.join(' ')}`);}
  return text;
}
