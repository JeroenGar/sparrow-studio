import type { Job, Part, Placement, Point, Result, Ring } from '../model';
import { area } from './normalize';
import { outline, placeShape, type Outline, type Shape } from './contour';

/** One placed copy of a part, in strip coordinates. */
/** One placed copy of a part: its outline for drawing, and its shape as placed, for exports. */
export type WorldPart = { partId: string; copyIndex: number; outer: Ring; holes: Ring[]; shape: Shape };
export const transform = (ring: Ring, p: Placement): Ring => {
  const angle = p.angleDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), f = p.mirrored ? -1 : 1;
  return ring.map(([x,y]) => [x*c-f*y*s+p.xMm, x*s+f*y*c+p.yMm]);
};
export function worldParts(doc: Job, result: Pick<Result,'placements'>): WorldPart[] {
  const parts = new Map(doc.parts.map(p => [p.id,p]));
  return result.placements.map(p => {
    const part = parts.get(p.partId);
    if (!part) throw Error(`Unknown part ${p.partId}.`);
    const { outer, holes } = outline(part.shape);
    return { partId: p.partId, copyIndex: p.copyIndex, outer: transform(outer,p), holes: holes.map(h=>transform(h,p)), shape: placeShape(part.shape,p.angleDeg,[p.xMm,p.yMm],p.mirrored) };
  });
}
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx=b[0]-a[0], dy=b[1]-a[1], d=dx*dx+dy*dy;
  const t=d === 0 ? 0 : Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d));
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}
/** The material area of a part, holes left out. */
export const netArea = (part: Pick<Part,'shape'>) => {
  const { outer, holes }: Outline = outline(part.shape);
  return Math.abs(area(outer))-holes.reduce((n,h)=>n+Math.abs(area(h)),0);
};
