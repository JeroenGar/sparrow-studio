import {path} from 'd3-path';
import type {Point,Ring} from '../model';
import {flattenContour,type Contour,type Shape} from './contour';

// Closed SVG path data for polygon rings.
export function pathData(rings:Ring[]):string {
  const d=path();
  for(const ring of rings){
    ring.forEach(([x,y],i)=>i?d.lineTo(x,y):d.moveTo(x,y));
    d.closePath();
  }
  return d.toString();
}

/** The circle an arc of `bulge` from `from` to `to` lies on, and the angles it runs between. */
export function arcOf(from:Point,to:Point,bulge:number) {
  const dx=to[0]-from[0],dy=to[1]-from[1],k=(1-bulge*bulge)/(4*bulge);
  const center:Point=[(from[0]+to[0])/2-dy*k,(from[1]+to[1])/2+dx*k];
  const start=Math.atan2(from[1]-center[1],from[0]-center[0]);
  return {center,radius:Math.hypot(from[0]-center[0],from[1]-center[1]),start,end:start+4*Math.atan(bulge)};
}

/** Closed SVG path data for a shape, its curves kept: arcs, Béziers, and NURBS as fine polylines. */
export function shapePath(shape:Shape):string {
  const parts:string[]=[];
  const xy=([x,y]:number[])=>`${x},${y}`;
  const contour=(c:Contour)=>{
    if(c.type==='polygon'||c.type==='rectangle'){flattenContour(c,0).forEach((p,i)=>parts.push(`${i?'L':'M'}${xy(p)}`));parts.push('Z');return;}
    if(c.type==='circle'){
      // Two half circles: one arc command cannot end where it starts.
      const [x,y]=c.center,r=c.radius;
      parts.push(`M${xy([x+r,y])}A${r},${r},0,1,1,${xy([x-r,y])}A${r},${r},0,1,1,${xy([x+r,y])}Z`);
      return;
    }
    let at=c.start as Point;parts.push(`M${xy(at)}`);
    for(const s of c.segments) {
      if(s.type==='nurbs'){const ring=flattenContour({type:'path',start:at,segments:[s]},.001);for(const p of ring.slice(1))parts.push(`L${xy(p)}`);at=s.control_points.at(-1) as Point;parts.push(`L${xy(at)}`);continue;}
      const to=s.to as Point;
      if(s.type==='line'||(s.type==='arc'&&s.bulge===0))parts.push(`L${xy(to)}`);
      // An arc by its end, radius and flags: large when it sweeps more than half a turn, and sweeping
      // in the positive angle direction when it runs counterclockwise.
      else if(s.type==='arc'){const {radius}=arcOf(at,to,s.bulge);parts.push(`A${radius},${radius},0,${Math.abs(s.bulge)>1?1:0},${s.bulge>0?1:0},${xy(to)}`);}
      else if(s.type==='quadratic')parts.push(`Q${xy(s.control)},${xy(to)}`);
      else parts.push(`C${xy(s.control1)},${xy(s.control2)},${xy(to)}`);
      at=to;
    }
    parts.push('Z');
  };
  contour(shape.outer);
  for(const hole of shape.holes??[])contour(hole);
  return parts.join('');
}
