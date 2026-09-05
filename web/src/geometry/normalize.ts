import { orient2d } from 'robust-predicates';
import { LIMITS, type Document, type Point, type Ring, type Part } from '../model';

export const area = (ring: Ring) => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;
export const bounds = (ring: Ring) => ring.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
export const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const orient = (a: Point, b: Point, c: Point) => orient2d(...a, ...b, ...c);
const on = (a: Point, b: Point, p: Point) => orient(a,b,p) === 0 && p[0] >= Math.min(a[0],b[0]) && p[0] <= Math.max(a[0],b[0]) && p[1] >= Math.min(a[1],b[1]) && p[1] <= Math.max(a[1],b[1]);
export function intersects(a: Point, b: Point, c: Point, d: Point) {
  // Strict separation only: touching boxes still reach the robust orientation tests.
  if(Math.max(a[0],b[0])<Math.min(c[0],d[0]) || Math.max(c[0],d[0])<Math.min(a[0],b[0])
    || Math.max(a[1],b[1])<Math.min(c[1],d[1]) || Math.max(c[1],d[1])<Math.min(a[1],b[1]))return false;
  const x = orient(a,b,c), y = orient(a,b,d), z = orient(c,d,a), w = orient(c,d,b);
  return (Math.sign(x) !== Math.sign(y) && x !== 0 && y !== 0 && Math.sign(z) !== Math.sign(w) && z !== 0 && w !== 0) || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b);
}
export function inside(p: Point, ring: Ring): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (on(a,b,p)) return false;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0]-a[0]) * (p[1]-a[1]) / (b[1]-a[1]) + a[0]) result = !result;
  }
  return result;
}
export function ringCrosses(a: Ring, b: Ring) {
  const aa = bounds(a), bb = bounds(b);
  if (aa[2] < bb[0] || bb[2] < aa[0] || aa[3] < bb[1] || bb[3] < aa[1]) return false;
  return a.some((p,i) => b.some((q,j) => intersects(p,a[(i+1)%a.length],q,b[(j+1)%b.length])));
}
export function normalizeRing(value: unknown): Ring {
  if (!Array.isArray(value) || value.length > LIMITS.verticesPerPart + 1) throw Error('Contour exceeds 5,000 vertices or is not an array.');
  const ring: Ring = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMITS.extent)) throw Error('Coordinates must be finite and within 100,000 mm.');
    if (!ring.length || !same(ring[ring.length-1], p as Point)) ring.push(p as Point);
  }
  if (ring.length && same(ring[0],ring[ring.length-1])) ring.pop();
  if (ring.length < 3 || Math.abs(area(ring)) <= 1e-10) throw Error('Contour has fewer than three vertices or is numerically degenerate.');
  for(let i=0;i<ring.length;i++) {
    const a=ring[(i+ring.length-1)%ring.length],b=ring[i],c=ring[(i+1)%ring.length];
    if(orient(a,b,c)===0 && (b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1])<0) throw Error('Contour doubles back along an adjacent edge.');
  }
  // ponytail: O(n²) validation is bounded at 5,000 vertices and runs in a worker;
  // replace with a sweep line if measured import latency requires it.
  for (let i=0;i<ring.length;i++) for (let j=i+1;j<ring.length;j++) {
    if (j === i+1 || (i === 0 && j === ring.length-1)) continue;
    if (intersects(ring[i],ring[(i+1)%ring.length],ring[j],ring[(j+1)%ring.length])) throw Error('Contour self-intersects or repeats an edge.');
  }
  return area(ring) < 0 ? ring.reverse() : ring;
}
export function normalizePart(part: Part): Part {
  if (typeof part.id !== 'string' || !part.id || typeof part.name !== 'string' || !part.source || !['svg','dxf','sparrow','drawn'].includes(part.source.format)) throw Error('Invalid part identity or provenance.');
  if (!Number.isInteger(part.quantity) || part.quantity < 1 || part.quantity > LIMITS.copies) throw Error('Quantity must be a positive integer, at most 500.');
  if (!Number.isFinite(part.approximationToleranceMm) || part.approximationToleranceMm < 0 || part.approximationToleranceMm > 100) throw Error('Invalid approximation tolerance.');
  if (!Array.isArray(part.preparationPosition) || part.preparationPosition.length !== 2 || !part.preparationPosition.every(Number.isFinite)) throw Error('Invalid preparation position.');
  if (!part.rotations || (part.rotations.kind !== 'continuous' && (part.rotations.kind !== 'discrete' || !Array.isArray(part.rotations.degrees) || !part.rotations.degrees.length || !part.rotations.degrees.every(Number.isFinite)))) throw Error('Discrete rotations require a nonempty list of finite degrees.');
  const outer = normalizeRing(part.outer);
  if (!Array.isArray(part.holes)) throw Error('Holes must be an array.');
  const holes = part.holes.map(normalizeRing);
  if (outer.length + holes.reduce((n,h) => n+h.length,0) > LIMITS.verticesPerPart) throw Error('Part exceeds 5,000 vertices including holes.');
  for (let i=0;i<holes.length;i++) {
    if (!inside(holes[i][0],outer) || ringCrosses(outer,holes[i])) throw Error('Hole must be strictly inside its outer contour.');
    for(let j=0;j<i;j++) if (ringCrosses(holes[i],holes[j]) || inside(holes[i][0],holes[j]) || inside(holes[j][0],holes[i])) throw Error('Holes overlap or contain each other.');
  }
  return { ...part, outer, holes: holes.map(h => [...h].reverse()) };
}
export function scalePart(part:Part,factor:number):Part {
  if(!Number.isFinite(factor)||factor<=0)throw Error('Scale must be finite and positive.');
  const scale=(ring:Ring):Ring=>ring.map(([x,y])=>[x*factor,y*factor]);
  return normalizePart({...part,outer:scale(part.outer),holes:part.holes.map(scale),approximationToleranceMm:part.approximationToleranceMm*factor});
}
export function normalizeDocument(doc: Document, allowEmpty=false): Document {
  if (typeof doc.name !== 'string' || !doc.name.trim() || !Array.isArray(doc.parts) || (!allowEmpty&&!doc.parts.length) || doc.parts.length > 500) throw Error('Project needs 1–500 part types.');
  const s = doc.settings;
  if (!s || !Number.isFinite(s.materialWidthMm) || s.materialWidthMm <= 0 || s.materialWidthMm > LIMITS.extent || !Number.isFinite(s.clearanceMm) || s.clearanceMm < 0 || s.clearanceMm >= s.materialWidthMm || (s.timeLimitSeconds!==null && ![10,30,60,120,300,600].includes(s.timeLimitSeconds))) throw Error('Invalid material width, clearance, or run duration.');
  const parts = doc.parts.map(normalizePart);
  if (new Set(parts.map(p=>p.id)).size !== parts.length) throw Error('Part IDs must be unique.');
  if (parts.reduce((n,p)=>n+p.quantity,0) > LIMITS.copies || parts.reduce((n,p)=>n+p.quantity*(p.outer.length+p.holes.reduce((m,h)=>m+h.length,0)),0) > LIMITS.verticesTotal) throw Error('Project exceeds 500 copies or 100,000 demanded vertices.');
  return { ...doc, parts };
}
