import {DxfWriter,LWPolylineFlags,Units,point2d,point3d} from '@tarikjabiri/dxf';
import type {WorldPart} from '../geometry/world';
import {SHEET_LAYER,type Job,type Point,type Ring,type Sheet} from '../model';
import {flattenContour,type Contour} from '../geometry/contour';
import {bounds} from '../geometry/normalize';

export const STUDIO_CREDIT='nested with sparrow studio · https://sparrowstudio.app';

/** The layout as DXF: on its sheet, with its defects and cut, or else on the strip up to `stripLengthMm`. */
export function exportDXF(doc:Job,world:WorldPart[],stripLengthMm:number,sheet?:Sheet):string {
  const stripWidth=doc.settings.materialWidthMm;
  const material:Ring[]=sheet
    ?[sheet.shape.outer,...(sheet.shape.holes??[]),...sheet.defects].map(c=>flattenContour(c,.001))
    :[[[0,0],[stripLengthMm,0],[stripLengthMm,stripWidth],[0,stripWidth]]];
  const rings=[...material,...world.flatMap(p=>[p.outer,...p.holes])];
  if(rings.some(ring=>ring.length<3||ring.flat().some(v=>!Number.isFinite(v))))throw Error('DXF contour is invalid.');
  const [minX,minY,maxX,maxY]=rings.flat().reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
  // Attribution in ASCII above all contours: Autodesk renders the \U+00B7 escape for '·' as '?'.
  const credit=STUDIO_CREDIT.replace('·','-');
  const textHeight=Math.min((maxY-minY)*.025,(maxX-minX)/(credit.length*.65)),textY=maxY+textHeight;
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
  for(const [layer,color] of [[SHEET_LAYER,8],['PARTS',7],['SPARROW_INFO',7]] as const)dxf.addLayer(layer,color);
  const polyline=(ring:Ring,layerName:string)=>dxf.addLWPolyline(ring.map(([x,y])=>({point:point2d(x,y)})),{flags:LWPolylineFlags.Closed,layerName});
  // Arcs stay arcs, as polyline bulges, and circles circles; other curves become fine polylines.
  const contour=(c:Contour,layerName:string)=>{
    if(c.type==='circle')return dxf.addCircle(point3d(c.center[0],c.center[1]),c.radius,{layerName});
    if(c.type!=='path'||c.segments.some(s=>s.type!=='line'&&s.type!=='arc'))return polyline(flattenContour(c,.001),layerName);
    const vertices:{point:Point;bulge:number}[]=[];let at=c.start as Point;
    for(const s of c.segments){if(s.type!=='line'&&s.type!=='arc')continue;vertices.push({point:at,bulge:s.type==='arc'?s.bulge:0});at=s.to as Point;}
    if(at[0]!==c.start[0]||at[1]!==c.start[1])vertices.push({point:at,bulge:0});
    dxf.addLWPolyline(vertices.map(({point:[x,y],bulge})=>({point:point2d(x,y),bulge})),{flags:LWPolylineFlags.Closed,layerName});
  };
  if(!sheet)polyline(material[0],SHEET_LAYER);
  else {
    for(const c of [sheet.shape.outer,...(sheet.shape.holes??[]),...sheet.defects])contour(c,SHEET_LAYER);
    if(sheet.cutX!==null){const [,y0,,y1]=bounds(material[0]);dxf.addLine(point3d(sheet.cutX,y0),point3d(sheet.cutX,y1),{layerName:SHEET_LAYER});}
  }
  // Holes on their part's layer: an outline inside another of the same layer is its hole.
  for(const p of world){contour(p.shape.outer,'PARTS');for(const hole of p.shape.holes??[])contour(hole,'PARTS');}
  dxf.addText(point3d(minX,textY),textHeight,credit,{layerName:'SPARROW_INFO'});
  return dxf.stringify();
}
