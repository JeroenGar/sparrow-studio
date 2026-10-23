import bSpline from 'dxf/lib/util/bSpline';
import type { Point, Ring } from '../model';
import { pointSegmentDistance } from './world';

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
export function bulge(from:Point,to:Point,b:number,tolerance:number,output:Ring) {
  if(!Number.isFinite(b))throw Error('Non-finite polyline bulge.');
  const dx=to[0]-from[0],dy=to[1]-from[1],chord=Math.hypot(dx,dy);
  if(b===0||chord*Math.abs(b)/2<=tolerance) {append(output,to);return;}
  if(chord===0)throw Error('A bulged edge has coincident endpoints.');
  const k=(1-b*b)/(4*b),center:Point=[(from[0]+to[0])/2-dy*k,(from[1]+to[1])/2+dx*k],radius=chord*(1+b*b)/(4*Math.abs(b));
  ellipse(center,[radius,0],[0,radius],Math.atan2(from[1]-center[1],from[0]-center[0]),4*Math.atan(b),tolerance,output);
  output[output.length-1]=to;
}
/**
 * A NURBS curve, as DXF SPLINE and the job format describe it, flattened within `tolerance`. It is
 * evaluated relative to its first control point: evaluation precision depends on the size of the
 * coordinates, not only of the curve.
 */
export function nurbs(curve:{points:Point[];knots:number[];degree:number;weights?:number[]},tolerance:number):Ring {
  const [ox,oy]=curve.points[0]??[0,0];
  return relativeNurbs({...curve,points:curve.points.map(([x,y])=>[x-ox,y-oy])},tolerance).map(([x,y])=>[x+ox,y+oy]);
}
function relativeNurbs({points,knots,degree,weights:given}:{points:Point[];knots:number[];degree:number;weights?:number[]},tolerance:number):Ring {
  if(!Number.isInteger(degree)||degree<1||degree>3||points.length<=degree||points.length>5000)throw Error('SPLINE needs degree 1–3 and a valid control-point count.');
  const weights=given??points.map(()=>1);
  if(weights.length!==points.length||weights.some(w=>!Number.isFinite(w)||w<=0))throw Error('SPLINE weights must be finite and positive.');
  if(knots.length!==points.length+degree+1||knots.some((v,i)=>!Number.isFinite(v)||i>0&&v<knots[i-1]))throw Error('Invalid SPLINE knot vector.');
  if(points.some(p=>!p.every(Number.isFinite)))throw Error('Invalid SPLINE control points.');
  const low=knots[degree],high=knots[points.length];if(!(high>low))throw Error('Empty SPLINE parameter domain.');
  const spans=[...new Set(knots.slice(degree,points.length+1))];
  if(spans.slice(1,-1).some(k=>knots.filter(v=>v===k).length>degree))throw Error('Discontinuous SPLINE cannot form one contour.');
  // Evaluate each polynomial knot span in homogeneous coordinates using dxf.
  // Degrees 1–3 can all be represented exactly as cubic rational Beziers.
  const homogeneous=points.map((p,i)=>[p[0]*weights[i],p[1]*weights[i],weights[i]]);
  const project=(p:number[]):Point=>[p[0]/p[2],p[1]/p[2]];
  const output:Ring=[];
  const flatten=(control:number[][],budget:number,depth=0)=>{
    if(depth>32)throw Error('SPLINE subdivision exceeded its depth limit.');
    const projected=control.map(project);
    if(projected.slice(1,-1).every(p=>pointSegmentDistance(p,projected[0],projected[3])<=budget)) {append(output,projected[3]);return;}
    const left=[control[0]],right=[control[3]];let row=control;
    while(row.length>1){row=row.slice(1).map((p,i)=>p.map((v,j)=>(v+row[i][j])/2));left.push(row[0]);right.unshift(row[row.length-1]);}
    flatten(left,budget,depth+1);flatten(right,budget,depth+1);
  };
  for(let i=1;i<spans.length;i++) {
    const samples=[0,1/3,2/3,1].map(t=>bSpline(Math.max(0,Math.min(1,(spans[i-1]+t*(spans[i]-spans[i-1])-low)/(high-low))),degree,homogeneous,knots));
    const [p0,a,b,p3]=samples;
    const p1=p0.map((v,j)=>(2*(27*a[j]-8*v-p3[j])-(27*b[j]-v-8*p3[j]))/18);
    const p2=p0.map((v,j)=>(2*(27*b[j]-v-8*p3[j])-(27*a[j]-8*v-p3[j]))/18);
    const control=[p0,p1,p2,p3];
    if(control.some(p=>p.some(v=>!Number.isFinite(v))||p[2]<=0))throw Error('Invalid SPLINE span.');
    // dxf rounds evaluations to nine decimal places; reserve an error budget
    // before applying the rational Bezier convex-hull subdivision bound.
    const precision=1e-7*(1+Math.max(...control.flatMap(p=>project(p).map(Math.abs))))/Math.min(...control.map(p=>p[2]));
    if(precision>=tolerance)throw Error('Requested tolerance is below SPLINE evaluation precision.');
    if(!output.length)append(output,project(p0));
    flatten(control,tolerance-precision);
  }
  return output;
}
