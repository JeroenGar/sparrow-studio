import parseString from 'dxf/lib/parseString';
import type {Job,Ring} from '../model';
import type {WorldPart} from '../geometry/validate';

export const STUDIO_CREDIT='nested with sparrow studio · https://sparrowstudio.app';

// AutoCAD-family readers (Fusion, Autodesk Viewer) reject real-valued group codes written without a decimal point.
const real=(v:number)=>Number.isInteger(v)?v.toFixed(1):String(v);

export function exportDXF(doc:Job,world:WorldPart[]):string {
  let nextHandle=0x100;
  const handle=()=> (nextHandle++).toString(16).toUpperCase();
  const polyline=(ring:Ring,layer:string)=>`0\nLWPOLYLINE\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbPolyline\n90\n${ring.length}\n70\n1\n${ring.map(([x,y])=>`10\n${real(x)}\n20\n${real(y)}\n`).join('')}`;
  const entities=world.map(p=>polyline(p.outer,'PARTS')+p.holes.map(h=>polyline(h,'HOLES')).join('')).join('');
  const box=world.reduce((b,p)=>p.outer.reduce((b,[x,y])=>[Math.min(b[0],x),Math.max(b[1],x),Math.max(b[2],y)],b),[0,1,doc.settings.materialWidthMm]);
  const textHeight=Math.min(doc.settings.materialWidthMm*.025,(box[1]-box[0])/(STUDIO_CREDIT.length*.65));
  // Keep attribution as text on its own non-plotting layer, outside all contours.
  const credit=STUDIO_CREDIT.replace('·','\\U+00B7');
  const annotation=`0\nTEXT\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\nSPARROW_INFO\n100\nAcDbText\n10\n${real(box[0])}\n20\n${real(box[2]+textHeight)}\n30\n0.0\n40\n${real(textHeight)}\n1\n${credit}\n100\nAcDbText\n`;
  // Write every symbol table and a root dictionary, as a minimal AutoCAD R2000 file does.
  const record=(type:string,subclass:string,owner:string,name:string,body='',id=handle())=>`0\n${type}\n5\n${id}\n330\n${owner}\n100\nAcDbSymbolTableRecord\n100\n${subclass}\n2\n${name}\n70\n0\n${body}`;
  const table=(type:string,id:string,records:string[]=[],extra='')=>`0\nTABLE\n2\n${type}\n5\n${id}\n330\n0\n100\nAcDbSymbolTable\n70\n${records.length}\n${extra}${records.join('')}0\nENDTAB\n`;
  const linetypes=['ByBlock','ByLayer','Continuous'].map(name=>record('LTYPE','AcDbLinetypeTableRecord','2',name,'3\n\n72\n65\n73\n0\n40\n0.0\n'));
  const layers=['0','PARTS','HOLES','SPARROW_INFO'].map(name=>record('LAYER','AcDbLayerTableRecord','1',name,`62\n7\n6\nContinuous\n${name==='SPARROW_INFO'?'290\n0\n':''}370\n-3\n390\nD\n`));
  const style=record('STYLE','AcDbTextStyleTableRecord','5','Standard','40\n0.0\n41\n1.0\n50\n0.0\n71\n0\n42\n2.5\n3\ntxt\n4\n\n');
  const appid=record('APPID','AcDbRegAppTableRecord','3','ACAD');
  // R2000 readers such as QCAD require explicit model/paper-space ownership.
  const spaces=[['*Model_Space','21','23','24'],['*Paper_Space','22','25','26']];
  const records=spaces.map(([name,id])=>record('BLOCK_RECORD','AcDbBlockTableRecord','9',name,'',id));
  const blocks=spaces.map(([name,id,begin,end])=>`0\nBLOCK\n5\n${begin}\n330\n${id}\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockBegin\n2\n${name}\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n3\n${name}\n1\n\n0\nENDBLK\n5\n${end}\n330\n${id}\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockEnd\n`).join('');
  const tables=table('VPORT','8')+table('LTYPE','2',linetypes)+table('LAYER','1',layers)+table('STYLE','5',[style])+table('VIEW','7')+table('UCS','6')+table('APPID','3',[appid])+table('DIMSTYLE','4',[],'100\nAcDbDimStyleTable\n')+table('BLOCK_RECORD','9',records);
  // Every R2000 layer must point at a plot style, here the default 'Normal' placeholder.
  const objects='0\nDICTIONARY\n5\nA\n330\n0\n100\nAcDbDictionary\n281\n1\n3\nACAD_GROUP\n350\nB\n3\nACAD_PLOTSTYLENAME\n350\nC\n0\nDICTIONARY\n5\nB\n330\nA\n100\nAcDbDictionary\n281\n1\n0\nACDBDICTIONARYWDFLT\n5\nC\n330\nA\n100\nAcDbDictionary\n281\n1\n3\nNormal\n350\nD\n100\nAcDbDictionaryWithDefault\n340\nD\n0\nACDBPLACEHOLDER\n5\nD\n330\nC\n';
  const text=`0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$INSUNITS\n70\n4\n9\n$HANDSEED\n5\n${nextHandle.toString(16).toUpperCase()}\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n${tables}0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}${annotation}0\nENDSEC\n0\nSECTION\n2\nOBJECTS\n${objects}0\nENDSEC\n0\nEOF\n`;
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
  if(at!==parsed.entities.length||JSON.stringify(reparsed)!==JSON.stringify(world))throw Error('Serialized DXF changed layout coordinates.');
  return text;
}
