import parseString from 'dxf/lib/parseString';
import type {Document,Ring} from '../model';
import type {WorldPart} from '../geometry/validate';

export const STUDIO_CREDIT='nested with sparrow/studio · https://sparrowstudio.app';

// AutoCAD-family readers (Fusion, Autodesk Viewer) reject real-valued group codes without a decimal point.
// Write every finite double exactly, in plain decimal notation, so simpler readers need no exponent support.
export const real=(v:number):string=>{
  if(!Number.isFinite(v))throw Error('DXF contains a non-finite number.');
  const [mantissa,exponent]=String(v).split('e');
  if(exponent===undefined)return mantissa.includes('.')?mantissa:mantissa+'.0';
  const sign=v<0?'-':'',unsigned=mantissa.replace('-',''),digits=unsigned.replace('.','');
  const point=unsigned.split('.')[0].length+Number(exponent);
  return sign+(point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length)+'.0':digits.slice(0,point)+'.'+digits.slice(point));
};

// R2000 drawing with the structure AutoCAD itself writes: units, extents, a saved view that frames the
// drawing (Autodesk Viewer clips to it), symbol tables, layouts and plot styles. Handles below 0x100 are fixed.
export function exportDXF(doc:Document,world:WorldPart[],sheetLengthMm:number):string {
  let nextHandle=0x100;
  const handle=()=> (nextHandle++).toString(16).toUpperCase();
  const sheetWidth=doc.settings.materialWidthMm;
  const sheet:Ring=[[0,0],[sheetLengthMm,0],[sheetLengthMm,sheetWidth],[0,sheetWidth]];
  const rings=[sheet,...world.flatMap(p=>[p.outer,...p.holes])];
  if(rings.some(ring=>ring.length<3))throw Error('DXF contour has fewer than three vertices.');
  const polyline=(ring:Ring,layer:string)=>`0\nLWPOLYLINE\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbPolyline\n90\n${ring.length}\n70\n1\n${ring.map(([x,y])=>`10\n${real(x)}\n20\n${real(y)}\n`).join('')}`;
  const entities=polyline(sheet,'SHEET')+world.map(p=>polyline(p.outer,'PARTS')+p.holes.map(h=>polyline(h,'HOLES')).join('')).join('');
  const [minX,minY,maxX,maxY]=rings.flat().reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
  // Keep attribution as ASCII text on its own non-plotting layer, above all contours.
  // Autodesk renders the \U+00B7 escape for '·' as '?'.
  const credit=STUDIO_CREDIT.replace('·','-');
  const textHeight=Math.min(sheetWidth*.025,(maxX-minX)/(credit.length*.65));
  if(!(textHeight>0))throw Error('DXF attribution has no positive height.');
  const textY=maxY+textHeight;
  const annotation=`0\nTEXT\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\nSPARROW_INFO\n100\nAcDbText\n10\n${real(minX)}\n20\n${real(textY)}\n30\n0.0\n40\n${real(textHeight)}\n1\n${credit}\n100\nAcDbText\n`;
  // Extents cover the contours and the text, including descenders; the view adds a 5% margin on each side.
  const ext=[minX,minY,maxX,textY+textHeight];
  const [width,height]=[ext[2]-ext[0],ext[3]-ext[1]],[cx,cy]=[ext[0]+width/2,ext[1]+height/2];
  const lim=[cx-width*.55,cy-height*.55,cx+width*.55,cy+height*.55];
  const point=(code:number,x:number,y:number,z?:number)=>`${code}\n${real(x)}\n${code+10}\n${real(y)}\n${z===undefined?'':`${code+20}\n${real(z)}\n`}`;
  const variable=(name:string,body:string)=>`9\n$${name}\n${body}`;
  const record=(type:string,subclass:string,owner:string,name:string,body='')=>`0\n${type}\n5\n${handle()}\n330\n${owner}\n100\nAcDbSymbolTableRecord\n100\n${subclass}\n2\n${name}\n70\n0\n${body}`;
  const table=(type:string,id:string,records:string[]=[],extra='')=>`0\nTABLE\n2\n${type}\n5\n${id}\n330\n0\n100\nAcDbSymbolTable\n70\n${records.length}\n${extra}${records.join('')}0\nENDTAB\n`;
  const active=record('VPORT','AcDbViewportTableRecord','8','*Active',`${point(10,0,0)}${point(11,1,1)}${point(12,cx,cy)}${point(13,0,0)}${point(14,.5,.5)}${point(15,.5,.5)}${point(16,0,0,1)}${point(17,0,0,0)}40\n${real(height*1.1)}\n41\n${real(width/height)}\n42\n50.0\n43\n0.0\n44\n0.0\n50\n0.0\n51\n0.0\n71\n0\n72\n1000\n73\n1\n74\n3\n75\n0\n76\n0\n77\n0\n78\n0\n`);
  const linetypes=['ByBlock','ByLayer','Continuous'].map(name=>record('LTYPE','AcDbLinetypeTableRecord','2',name,'3\n\n72\n65\n73\n0\n40\n0.0\n'));
  // Every R2000 layer must point at a plot style, here the default 'Normal' placeholder D.
  const layers=[['0',7],['SHEET',8],['PARTS',7],['HOLES',7],['SPARROW_INFO',7]].map(([name,color])=>record('LAYER','AcDbLayerTableRecord','1',`${name}`,`62\n${color}\n6\nContinuous\n${name==='SPARROW_INFO'?'290\n0\n':''}370\n-3\n390\nD\n`));
  const style=record('STYLE','AcDbTextStyleTableRecord','5','Standard','40\n0.0\n41\n1.0\n50\n0.0\n71\n0\n42\n2.5\n3\ntxt\n4\n\n');
  const appid=record('APPID','AcDbRegAppTableRecord','3','ACAD');
  // Model space (block record 21, layout F) holds every entity; paper space (22, layout 10) stays empty.
  const spaces=[['*Model_Space','21','23','24','F',''],['*Paper_Space','22','25','26','10','67\n1\n']];
  const records=spaces.map(([name,id,,,layout])=>`0\nBLOCK_RECORD\n5\n${id}\n330\n9\n100\nAcDbSymbolTableRecord\n100\nAcDbBlockTableRecord\n2\n${name}\n340\n${layout}\n`).join('');
  const blocks=spaces.map(([name,id,begin,end,,paper])=>`0\nBLOCK\n5\n${begin}\n330\n${id}\n100\nAcDbEntity\n${paper}8\n0\n100\nAcDbBlockBegin\n2\n${name}\n70\n0\n${point(10,0,0,0)}3\n${name}\n1\n\n0\nENDBLK\n5\n${end}\n330\n${id}\n100\nAcDbEntity\n${paper}8\n0\n100\nAcDbBlockEnd\n`).join('');
  const tables=table('VPORT','8',[active])+table('LTYPE','2',linetypes)+table('LAYER','1',layers)+table('STYLE','5',[style])+table('VIEW','7')+table('UCS','6')+table('APPID','3',[appid])+table('DIMSTYLE','4',[],'100\nAcDbDimStyleTable\n')+`0\nTABLE\n2\nBLOCK_RECORD\n5\n9\n330\n0\n100\nAcDbSymbolTable\n70\n2\n${records}0\nENDTAB\n`;
  const layout=(id:string,name:string,flags:number,tab:number,block:string,limits:number[],extents:number[])=>`0\nLAYOUT\n5\n${id}\n102\n{ACAD_REACTORS\n330\nE\n102\n}\n330\nE\n100\nAcDbPlotSettings\n1\n\n4\nA3\n6\n\n40\n7.5\n41\n20.0\n42\n7.5\n43\n20.0\n44\n420.0\n45\n297.0\n46\n0.0\n47\n0.0\n48\n0.0\n49\n0.0\n140\n0.0\n141\n0.0\n142\n1.0\n143\n1.0\n70\n${flags}\n72\n1\n73\n0\n74\n5\n7\n\n75\n16\n76\n0\n77\n2\n78\n300\n147\n1.0\n148\n0.0\n149\n0.0\n100\nAcDbLayout\n1\n${name}\n70\n1\n71\n${tab}\n${point(10,limits[0],limits[1])}${point(11,limits[2],limits[3])}${point(12,0,0,0)}${point(14,extents[0],extents[1],0)}${point(15,extents[2],extents[3],0)}146\n0.0\n${point(13,0,0,0)}${point(16,1,0,0)}${point(17,0,1,0)}76\n1\n330\n${block}\n`;
  const dictionary=(id:string,owner:string,entries:[string,string][])=>`0\nDICTIONARY\n5\n${id}\n330\n${owner}\n100\nAcDbDictionary\n281\n1\n${entries.map(([key,value])=>`3\n${key}\n350\n${value}\n`).join('')}`;
  const objects=dictionary('A','0',[['ACAD_GROUP','B'],['ACAD_LAYOUT','E'],['ACAD_PLOTSTYLENAME','C']])+dictionary('B','A',[])
    +'0\nACDBDICTIONARYWDFLT\n5\nC\n330\nA\n100\nAcDbDictionary\n281\n1\n3\nNormal\n350\nD\n100\nAcDbDictionaryWithDefault\n340\nD\n0\nACDBPLACEHOLDER\n5\nD\n330\nC\n'
    +dictionary('E','A',[['Layout1','10'],['Model','F']])
    +layout('F','Model',1024,0,'21',lim,ext)+layout('10','Layout1',0,1,'22',[0,0,420,297],[1e20,1e20,-1e20,-1e20]);
  const classes=[['ACDBDICTIONARYWDFLT','AcDbDictionaryWithDefault'],['ACDBPLACEHOLDER','AcDbPlaceHolder'],['LAYOUT','AcDbLayout']].map(([name,cpp])=>`0\nCLASS\n1\n${name}\n2\n${cpp}\n3\nObjectDBX Classes\n90\n0\n280\n0\n281\n0\n`).join('');
  const header=variable('ACADVER','1\nAC1015\n')+variable('DWGCODEPAGE','3\nANSI_1252\n')+variable('INSBASE',point(10,0,0,0))+variable('EXTMIN',point(10,ext[0],ext[1],0))+variable('EXTMAX',point(10,ext[2],ext[3],0))
    +variable('LIMMIN',point(10,lim[0],lim[1]))+variable('LIMMAX',point(10,lim[2],lim[3]))+variable('TILEMODE','70\n1\n')+variable('INSUNITS','70\n4\n')+variable('MEASUREMENT','70\n1\n')+variable('HANDSEED',`5\n${nextHandle.toString(16).toUpperCase()}\n`);
  const text=`0\nSECTION\n2\nHEADER\n${header}0\nENDSEC\n0\nSECTION\n2\nCLASSES\n${classes}0\nENDSEC\n0\nSECTION\n2\nTABLES\n${tables}0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}${annotation}0\nENDSEC\n0\nSECTION\n2\nOBJECTS\n${objects}0\nENDSEC\n0\nEOF\n`;
  const parsed=parseString(text) as {header:{insUnits:number};entities:{type:string;closed:boolean;layer:string;string?:string;vertices:{x:number;y:number}[]}[]};
  if(parsed.header.insUnits!==4)throw Error('Serialized DXF lost its millimeter units.');
  let at=0;
  const ring=(layer:string):Ring=>{
    const entity=parsed.entities[at++];
    if(entity?.type!=='LWPOLYLINE'||!entity.closed||entity.layer!==layer)throw Error('Serialized DXF lost a closed contour or layer.');
    return entity.vertices.map(p=>[p.x,p.y]);
  };
  if(JSON.stringify(ring('SHEET'))!==JSON.stringify(sheet))throw Error('Serialized DXF changed the sheet.');
  const reparsed=world.map(p=>({...p,outer:ring('PARTS'),holes:p.holes.map(()=>ring('HOLES'))}));
  const note=parsed.entities[at++];
  if(note?.type!=='TEXT'||note.layer!=='SPARROW_INFO'||note.string!==credit)throw Error('Serialized DXF lost its attribution.');
  if(at!==parsed.entities.length||JSON.stringify(reparsed)!==JSON.stringify(world))throw Error('Serialized DXF changed canvas coordinates.');
  return text;
}
