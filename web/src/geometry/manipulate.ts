import type {Document,Point} from '../model';
import {bounds,normalizeDocument} from './normalize';
import {localize} from '../import/sparrow';

export type GeometryEdit={kind:'rotate';degrees:number;pivot:Point}|{kind:'scale';factor:number;pivot:Point};
export function selectionBounds(doc:Document,ids:string[]) {
  const boxes=doc.parts.filter(p=>ids.includes(p.id)).map(p=>{
    const b=bounds(p.outer),[x,y]=p.preparationPosition;return [b[0]+x,b[1]+y,b[2]+x,b[3]+y];
  });
  if(!boxes.length)return undefined;
  return boxes.reduce((a,b)=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])]);
}
export function editSelection(doc:Document,ids:string[],edit:GeometryEdit):Document {
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
  return normalizeDocument({...doc,parts:doc.parts.map(part=>{
    if(!ids.includes(part.id))return part;
    const outer=part.outer.map(transform),holes=part.holes.map(r=>r.map(transform)),b=bounds(outer);
    const offset=transform([part.preparationPosition[0]-edit.pivot[0],part.preparationPosition[1]-edit.pivot[1]]);
    return localize({...part,outer,holes,approximationToleranceMm:part.approximationToleranceMm*factor,
      preparationPosition:[edit.pivot[0]+offset[0]+b[0],edit.pivot[1]+offset[1]+b[1]]});
  })});
}
