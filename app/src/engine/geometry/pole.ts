import type { Point, Ring } from '../model';
import { pointSegmentDistance } from './world';
import type { Outline } from './contour';

/** The distance from `p` to the material's edge, positive inside the material, negative outside. */
function signedDistance(p: Point, { outer, holes }: Outline): number {
  let inside = false;
  let distance = Infinity;
  for (const ring of [outer, ...holes])
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = [ring[i], ring[j]];
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
        inside = !inside;
      distance = Math.min(distance, pointSegmentDistance(p, a, b));
    }
  return inside ? distance : -distance;
}

type Cell = { x: number; y: number; half: number; distance: number; best: number };

const cell = (x: number, y: number, half: number, shape: Outline): Cell => {
  const distance = signedDistance([x, y], shape);
  // The farthest any point of the cell can lie from the edge.
  return { x, y, half, distance, best: distance + half * Math.SQRT2 };
};

const poles = new WeakMap<Outline, { point: Point; radius: number }>();

/**
 * The pole of inaccessibility of a shape: the point of its material farthest from any edge, holes
 * included, and that distance, found to within 1% of the shape's size. Unlike the centroid or the
 * middle of the bounds, it always lies inside the material, where a symbol can go.
 */
export function pole(shape: Outline): { point: Point; radius: number } {
  const known = poles.get(shape);
  if (known) return known;
  const ring: Ring = shape.outer;
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const size = Math.min(x1 - x0, y1 - y0);
  const precision = Math.max(x1 - x0, y1 - y0) * 0.01;
  // Start from a grid of square cells over the bounds, and the middle of the bounds.
  const half = Math.max(size, precision) / 2;
  const queue: Cell[] = [];
  for (let x = x0; x < x1; x += 2 * half)
    for (let y = y0; y < y1; y += 2 * half) queue.push(cell(x + half, y + half, half, shape));
  let best = cell((x0 + x1) / 2, (y0 + y1) / 2, 0, shape);
  // Split the cells that could still hold a farther point, most promising first.
  while (queue.length) {
    queue.sort((a, b) => b.best - a.best);
    const next = queue.shift()!;
    if (next.distance > best.distance) best = next;
    if (next.best - best.distance <= precision) break;
    const h = next.half / 2;
    for (const [dx, dy] of [
      [-h, -h],
      [h, -h],
      [-h, h],
      [h, h],
    ])
      queue.push(cell(next.x + dx, next.y + dy, h, shape));
  }
  const result = { point: [best.x, best.y] as Point, radius: Math.max(0, best.distance) };
  poles.set(shape, result);
  return result;
}
