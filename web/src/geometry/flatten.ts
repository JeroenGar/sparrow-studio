import type { Point, Ring } from '../model';
import { pointSegmentDistance } from './validate';

export type Matrix=[number,number,number,number,number,number];
export const IDENTITY:Matrix=[1,0,0,1,0,0];
export const apply=(m:Matrix,p:Point):Point=>[m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]];
export const multiply=(a:Matrix,b:Matrix):Matrix=>[
  a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
  a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
export function append(ring:Ring,p:Point) {
  if(ring.length>=5001) throw Error('Curve approximation exceeds 5,000 vertices. Choose a coarser tolerance and preview again.');
  if(!p.every(Number.isFinite)) throw Error('Curve produced non-finite coordinates.');
  ring.push(p);
}
export function bezier(points:Point[],tolerance:number,output:Ring,depth=0) {
  if(depth>32) throw Error('Bezier subdivision exceeded its depth limit.');
  if(points.slice(1,-1).every(p=>pointSegmentDistance(p,points[0],points[points.length-1])<=tolerance)) {append(output,points[points.length-1]);return;}
  const left=[points[0]],right=[points[points.length-1]];
  let row=points;
  while(row.length>1) {row=row.slice(1).map((p,i)=>[(p[0]+row[i][0])/2,(p[1]+row[i][1])/2]);left.push(row[0]);right.unshift(row[row.length-1]);}
  bezier(left,tolerance,output,depth+1);bezier(right,tolerance,output,depth+1);
}
export function ellipse(center:Point,u:Point,v:Point,start:number,sweep:number,tolerance:number,output:Ring) {
  // For f(t)=c+u cos(t)+v sin(t), ||f''|| <= ||[u v]||F.
  // Linear interpolation error is bounded by M*dt²/8 after affine scaling.
  const curvatureBound=Math.hypot(...u,...v);
  const segments=Math.max(1,Math.ceil(Math.abs(sweep)*Math.sqrt(curvatureBound/(8*tolerance))));
  if(!Number.isFinite(segments)||output.length+segments>5001) throw Error('Arc approximation exceeds 5,000 vertices. Choose a coarser tolerance and preview again.');
  for(let i=1;i<=segments;i++) {const t=start+sweep*i/segments;append(output,[center[0]+u[0]*Math.cos(t)+v[0]*Math.sin(t),center[1]+u[1]*Math.cos(t)+v[1]*Math.sin(t)]);}
}
export function svgArc(from:Point,to:Point,rx:number,ry:number,rotation:number,large:number,sweep:number,m:Matrix,tolerance:number,output:Ring) {
  if(rx<0||ry<0||![0,1].includes(large)||![0,1].includes(sweep)) throw Error('Invalid SVG arc radii or flags.');
  if(from[0]===to[0]&&from[1]===to[1]) return;
  if(rx===0||ry===0) {append(output,apply(m,to));return;}
  const phi=rotation*Math.PI/180,c=Math.cos(phi),s=Math.sin(phi),dx=(from[0]-to[0])/2,dy=(from[1]-to[1])/2;
  const x=c*dx+s*dy,y=-s*dx+c*dy;
  const correction=Math.sqrt(x*x/(rx*rx)+y*y/(ry*ry));
  if(correction>1) {rx*=correction;ry*=correction;}
  const q=(large===sweep?-1:1)*Math.sqrt(Math.max(0,(rx*rx*ry*ry-rx*rx*y*y-ry*ry*x*x)/(rx*rx*y*y+ry*ry*x*x)));
  const cx=q*rx*y/ry,cy=-q*ry*x/rx;
  const center:Point=[c*cx-s*cy+(from[0]+to[0])/2,s*cx+c*cy+(from[1]+to[1])/2];
  const start=Math.atan2((y-cy)/ry,(x-cx)/rx),end=Math.atan2((-y-cy)/ry,(-x-cx)/rx);
  let delta=end-start;if(sweep&&delta<0)delta+=2*Math.PI;if(!sweep&&delta>0)delta-=2*Math.PI;
  const origin=apply(m,[0,0]),au=apply(m,[rx*c,rx*s]),av=apply(m,[-ry*s,ry*c]);
  ellipse(apply(m,center),[au[0]-origin[0],au[1]-origin[1]],[av[0]-origin[0],av[1]-origin[1]],start,delta,tolerance,output);
  output[output.length-1]=apply(m,to);
}
