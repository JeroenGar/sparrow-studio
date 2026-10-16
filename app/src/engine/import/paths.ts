import { polygon, type Contour, type Segment } from '../geometry/contour';
import type { Matrix } from '../geometry/flatten';
import type { Point, Ring } from '../model';

/** A piece of a contour as the job format describes it: where it starts, and its segments. */
export type Path = { start: Point; segments: Segment[] };

/** Where a segment ends. */
export const end = (segment: Segment): Point =>
  (segment.type === 'nurbs' ? segment.control_points.at(-1)! : segment.to) as Point;

/** The same piece, run the other way. */
export function reverse({ start, segments }: Path): Path {
  const ends = [start, ...segments.map(end)];
  return {
    start: ends[ends.length - 1],
    segments: segments
      .map((segment, i): Segment => {
        const to = ends[i];
        switch (segment.type) {
          case 'line':
            return { type: 'line', to };
          case 'arc':
            return { type: 'arc', to, bulge: -segment.bulge };
          case 'quadratic':
            return { type: 'quadratic', control: segment.control, to };
          case 'cubic':
            return { type: 'cubic', control1: segment.control2, control2: segment.control1, to };
          case 'nurbs': {
            const [low, high] = [segment.knots[0], segment.knots[segment.knots.length - 1]];
            return {
              type: 'nurbs',
              degree: segment.degree,
              control_points: [...segment.control_points.slice(0, -1).reverse(), to],
              knots: segment.knots.map((knot) => low + high - knot).reverse(),
              ...(segment.weights && { weights: [...segment.weights].reverse() }),
            };
          }
        }
      })
      .reverse(),
  };
}

/** A piece with its start and end moved, such as to close a small gap where pieces join. */
export function moveEnds(path: Path, start: Point, last: Point): Path {
  const segments = [...path.segments];
  const final = segments[segments.length - 1];
  segments[segments.length - 1] =
    final.type === 'nurbs'
      ? { ...final, control_points: [...final.control_points.slice(0, -1), last] }
      : { ...final, to: last };
  return { start, segments };
}

/** A closed contour from a path; a path of straight lines is a polygon, the format's compact form. */
export function contour(path: Path, ring: Ring): Contour {
  // Segments that go nowhere, such as an arc between coincident points, are left out.
  let at = path.start;
  const segments = path.segments.filter((segment) => {
    const to = end(segment);
    const points = [to, ...(segment.type === 'quadratic' ? [segment.control] : segment.type === 'cubic' ? [segment.control1, segment.control2] : segment.type === 'nurbs' ? segment.control_points : [])];
    const empty = points.every(([x, y]) => x === at[0] && y === at[1]);
    at = to;
    return !empty;
  });
  return segments.every((s) => s.type === 'line' || (s.type === 'arc' && s.bulge === 0))
    ? polygon(ring)
    : { type: 'path', start: path.start, segments };
}

/** Whether a transformation keeps circles circles: a rotation, a uniform scale, maybe a mirror. */
export function similar(m: Matrix): boolean {
  const [a, b, c, d] = m;
  const scale = Math.hypot(a, b);
  return Math.abs(scale - Math.hypot(c, d)) <= 1e-9 * scale && Math.abs(a * c + b * d) <= 1e-9 * scale * scale;
}

/** Whether a transformation mirrors, which turns an arc's direction around. */
export const mirrors = (m: Matrix) => m[0] * m[3] - m[1] * m[2] < 0;

/**
 * A path moved by a transformation. Arcs stay arcs under rotations, uniform scales and mirrors;
 * under any other transformation a path with arcs has no exact form here, and is left out.
 */
export function transformPath(path: Path, m: Matrix): Path | undefined {
  const p = (point: number[]): Point => [
    m[0] * point[0] + m[2] * point[1] + m[4],
    m[1] * point[0] + m[3] * point[1] + m[5],
  ];
  if (path.segments.some((s) => s.type === 'arc' && s.bulge !== 0) && !similar(m)) return undefined;
  const flip = mirrors(m) ? -1 : 1;
  return {
    start: p(path.start),
    segments: path.segments.map((s): Segment => {
      switch (s.type) {
        case 'line':
          return { type: 'line', to: p(s.to) };
        case 'arc':
          return { type: 'arc', to: p(s.to), bulge: s.bulge * flip };
        case 'quadratic':
          return { type: 'quadratic', control: p(s.control), to: p(s.to) };
        case 'cubic':
          return { type: 'cubic', control1: p(s.control1), control2: p(s.control2), to: p(s.to) };
        case 'nurbs':
          return { ...s, control_points: s.control_points.map(p) };
      }
    }),
  };
}

/** A path of straight lines through the points of a ring: a curve kept only as its approximation. */
export const lines = (ring: Ring): Path => ({
  start: ring[0],
  segments: ring.slice(1).map((to) => ({ type: 'line', to })),
});
