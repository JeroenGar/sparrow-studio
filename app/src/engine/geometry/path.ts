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
  const d=path();
  const contour=(c:Contour)=>{
    if(c.type==='polygon'||c.type==='rectangle'){flattenContour(c,0).forEach(([x,y],i)=>i?d.lineTo(x,y):d.moveTo(x,y));d.closePath();return;}
    if(c.type==='circle'){const [x,y]=c.center;d.moveTo(x+c.radius,y);d.arc(x,y,c.radius,0,2*Math.PI);d.closePath();return;}
    let at=c.start as Point;d.moveTo(at[0],at[1]);
    for(const s of c.segments) {
      if(s.type==='nurbs'){const ring=flattenContour({type:'path',start:at,segments:[s]},.001);for(const [x,y] of ring.slice(1))d.lineTo(x,y);at=s.control_points.at(-1) as Point;d.lineTo(at[0],at[1]);continue;}
      const to=s.to as Point;
      if(s.type==='line'||(s.type==='arc'&&s.bulge===0))d.lineTo(to[0],to[1]);
      else if(s.type==='arc'){const a=arcOf(at,to,s.bulge);d.arc(a.center[0],a.center[1],a.radius,a.start,a.end,s.bulge<0);}
      else if(s.type==='quadratic')d.quadraticCurveTo(s.control[0],s.control[1],to[0],to[1]);
      else d.bezierCurveTo(s.control1[0],s.control1[1],s.control2[0],s.control2[1],to[0],to[1]);
      at=to;
    }
    d.closePath();
  };
  contour(shape.outer);
  for(const hole of shape.holes??[])contour(hole);
  return d.toString();
}
