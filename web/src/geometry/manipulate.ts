import type {Document,Point,Placement} from '../model';
import {bounds,normalizeDocument} from './normalize';
import {localize} from '../import/sparrow';
import {documentPlacements,placementKey,type CopyRef,withDocumentPlacements} from './placements';

export type GeometryEdit={kind:'rotate';degrees:number;pivot:Point}|{kind:'scale';factor:number;pivot:Point};
export function placementBounds(part:Document['parts'][number],placement:Placement):[number,number,number,number] {
  const radians=placement.angleDeg*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  const points=part.outer.map(([x,y])=>[x*c-y*s+placement.xMm,x*s+y*c+placement.yMm] as Point);
  return bounds(points) as [number,number,number,number];
}
export function selectionBounds(doc:Document,ids:string[],refs?:CopyRef[]) {
  const wanted=new Set(ids),selected=refs?.length
    ? new Set(refs.map(placementKey)) : undefined;
  const parts=new Map(doc.parts.map(p=>[p.id,p]));
  const boxes=documentPlacements(doc).filter(p=>wanted.has(p.partId)&&(!selected||selected.has(placementKey(p))))
    .map(p=>placementBounds(parts.get(p.partId)!,p));
  if(!boxes.length)return undefined;
  return boxes.reduce((a,b)=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])]);
}
export function editSelection(doc:Document,ids:string[],edit:GeometryEdit,refs?:CopyRef[]):Document {
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!doc.parts.some(p=>p.id===id)))throw Error('Select existing parts to transform.');
  if(!Array.isArray(edit.pivot)||edit.pivot.length!==2||!edit.pivot.every(Number.isFinite))throw Error('Invalid transform pivot.');
  let c:number,s:number,factor=1;
  if(edit.kind==='rotate') {
    if(!Number.isFinite(edit.degrees))throw Error('Rotation must be finite.');
    const degrees=edit.degrees%360,radians=degrees*Math.PI/180;
    c=Math.cos(radians);s=Math.sin(radians);
    if(Number.isInteger(degrees/90)){c=Math.round(c);s=Math.round(s);}
  }else {
    factor=edit.factor;if(!Number.isFinite(factor)||factor<=0)throw Error('Scale must be positive and finite.');
    c=factor;s=0;
  }
  const transform=([x,y]:Point):Point=>[x*c-y*s,x*s+y*c];
  const selected=new Set((refs?.length?refs:documentPlacements(doc).filter(p=>ids.includes(p.partId))).map(placementKey));
  const oldPlacements=documentPlacements(doc),nextParts=doc.parts.map(part=>{
    if(!ids.includes(part.id))return part;
    const outer=part.outer.map(transform),holes=part.holes.map(r=>r.map(transform));
    return localize({...part,outer,holes,approximationToleranceMm:part.approximationToleranceMm*factor});
  });
  const nextPlacements=oldPlacements.map(placement=>{
    if(!ids.includes(placement.partId)||!selected.has(placementKey(placement)))return placement;
    const offset=transform([placement.xMm-edit.pivot[0],placement.yMm-edit.pivot[1]]);
    const part=doc.parts.find(p=>p.id===placement.partId)!;
    const transformed=part.outer.map(transform),b=bounds(transformed);
    const radians=placement.angleDeg*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
    const rebased:[number,number]=[b[0]*cos-b[1]*sin,b[0]*sin+b[1]*cos];
    return {...placement,xMm:edit.pivot[0]+offset[0]+rebased[0],yMm:edit.pivot[1]+offset[1]+rebased[1]};
  });
  return withDocumentPlacements(normalizeDocument({...doc,parts:nextParts}),nextPlacements);
}
