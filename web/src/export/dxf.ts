import parseString from 'dxf/lib/parseString';
import {DxfWriter,LWPolylineFlags,Units,point2d,point3d} from '@tarikjabiri/dxf';
import type {WorldPart} from '../geometry/validate';
import {SHEET_LAYER,type Document,type Ring} from '../model';

export const STUDIO_CREDIT='nested with sparrow/studio · https://sparrowstudio.app';

export function exportDXF(doc:Document,world:WorldPart[],sheetLengthMm:number):string {
  const sheetWidth=doc.settings.materialWidthMm;
  const sheet:Ring=[[0,0],[sheetLengthMm,0],[sheetLengthMm,sheetWidth],[0,sheetWidth]];
  const rings=[sheet,...world.flatMap(p=>[p.outer,...p.holes])];
  if(rings.some(ring=>ring.length<3||ring.flat().some(v=>!Number.isFinite(v))))throw Error('DXF contour is invalid.');
  const [minX,minY,maxX,maxY]=rings.flat().reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
  // Attribution in ASCII above all contours: Autodesk renders the \U+00B7 escape for '·' as '?'.
  const credit=STUDIO_CREDIT.replace('·','-');
  const textHeight=Math.min(sheetWidth*.025,(maxX-minX)/(credit.length*.65)),textY=maxY+textHeight;
  // Extents allow a full text height per character, since substituted fonts render wider than the sizing estimate.
  const ext=[minX,minY,Math.max(maxX,minX+credit.length*textHeight),textY+textHeight];
  const [width,height]=[ext[2]-ext[0],ext[3]-ext[1]];

  const dxf=new DxfWriter();
  dxf.setUnits(Units.Millimeters);
  dxf.setVariable('$EXTMIN',{10:ext[0],20:ext[1],30:0});
  dxf.setVariable('$EXTMAX',{10:ext[2],20:ext[3],30:0});
  // Autodesk Viewer clips the drawing to the saved view. The library fits that view to approximate
  // bounds with a fixed 2:1 aspect, so frame the exact extents, with a 5% margin, ourselves.
  Object.assign(dxf.modelSpace,{centerView:()=>point3d(ext[0]+width/2,ext[1]+height/2),viewHeight:()=>Math.max(height,width/2)*1.1});
  for(const [layer,color] of [[SHEET_LAYER,8],['PARTS',7],['HOLES',7],['SPARROW_INFO',7]] as const)dxf.addLayer(layer,color);
  const polyline=(ring:Ring,layerName:string)=>dxf.addLWPolyline(ring.map(([x,y])=>({point:point2d(x,y)})),{flags:LWPolylineFlags.Closed,layerName});
  polyline(sheet,SHEET_LAYER);
  for(const p of world){polyline(p.outer,'PARTS');for(const hole of p.holes)polyline(hole,'HOLES');}
  dxf.addText(point3d(minX,textY),textHeight,credit,{layerName:'SPARROW_INFO'});
  const text=dxf.stringify();

  const parsed=parseString(text) as {header:{insUnits:number};entities:{type:string;closed:boolean;layer:string;string?:string;vertices:{x:number;y:number}[]}[]};
  if(parsed.header.insUnits!==4)throw Error('Serialized DXF lost its millimeter units.');
  let at=0;
  const ring=(layer:string):Ring=>{
    const entity=parsed.entities[at++];
    if(entity?.type!=='LWPOLYLINE'||!entity.closed||entity.layer!==layer)throw Error('Serialized DXF lost a closed contour or layer.');
    return entity.vertices.map(p=>[p.x,p.y]);
  };
  if(JSON.stringify(ring(SHEET_LAYER))!==JSON.stringify(sheet))throw Error('Serialized DXF changed the sheet.');
  const reparsed=world.map(p=>({...p,outer:ring('PARTS'),holes:p.holes.map(()=>ring('HOLES'))}));
  const note=parsed.entities[at++];
  if(note?.type!=='TEXT'||note.layer!=='SPARROW_INFO'||note.string!==credit)throw Error('Serialized DXF lost its attribution.');
  if(at!==parsed.entities.length||JSON.stringify(reparsed)!==JSON.stringify(world))throw Error('Serialized DXF changed canvas coordinates.');
  return text;
}
