import type { Schemas } from '../../api/client';
import type { Point, Ring } from '../model';
import { append, bezier, bulge, ellipse, nurbs } from './flatten';

/** A part's shape in the job format: an outer contour and holes, polygons or curves. */
export type Shape = Schemas['Shape'];
export type Contour = Schemas['Contour'];
export type Segment = Schemas['Segment'];
/** A shape as polygons: what drawings, areas and checks read. */
export type Outline = { outer: Ring; holes: Ring[] };

export const polygon = (ring: Ring): Contour => ({ type: 'polygon', points: ring });
export const polygonShape = (outer: Ring, holes: Ring[] = []): Shape => ({
  outer: polygon(outer),
  ...(holes.length && { holes: holes.map(polygon) }),
});

/** Whether a contour has curves, which open-source sparrow can only approximate. */
export const isCurved = (contour: Contour) =>
  contour.type === 'circle' ||
  (contour.type === 'path' &&
    contour.segments.some((s) => s.type !== 'line' && !(s.type === 'arc' && s.bulge === 0)));

/** A contour as a polygon, its curves within `tolerance`. */
export function flattenContour(contour: Contour, tolerance: number): Ring {
  switch (contour.type) {
    case 'polygon':
      return contour.points as Ring;
    case 'rectangle': {
      const { x_min: x, y_min: y, width: w, height: h } = contour;
      return [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ];
    }
    case 'circle': {
      const [cx, cy] = contour.center as Point;
      const r = contour.radius;
      const ring: Ring = [[cx + r, cy]];
      ellipse([cx, cy], [r, 0], [0, r], 0, 2 * Math.PI, tolerance, ring);
      ring.pop();
      return ring;
    }
    case 'path': {
      const ring: Ring = [contour.start as Point];
      for (const segment of contour.segments) {
        const from = ring[ring.length - 1];
        const to = segment.type === 'nurbs' ? segment.control_points.at(-1)! : segment.to;
        switch (segment.type) {
          case 'line':
            append(ring, to as Point);
            break;
          case 'arc':
            bulge(from, to as Point, segment.bulge, tolerance, ring);
            break;
          case 'quadratic':
            bezier([from, segment.control, to] as Point[], tolerance, ring);
            break;
          case 'cubic':
            bezier([from, segment.control1, segment.control2, to] as Point[], tolerance, ring);
            break;
          case 'nurbs':
            ring.push(
              ...nurbs(
                {
                  points: [from, ...(segment.control_points as Point[])],
                  knots: segment.knots,
                  degree: segment.degree,
                  weights: segment.weights,
                },
                tolerance,
              ).slice(1),
            );
            break;
        }
      }
      const [first, last] = [ring[0], ring[ring.length - 1]];
      if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop();
      return ring;
    }
  }
}

/** The tolerance curves are drawn with: fine enough to look exact on screen. */
const DRAWING_TOLERANCE = 0.01;

const outlines = new WeakMap<Shape, Outline>();

/** A shape as polygons, its curves within a drawing tolerance; computed once per shape. */
export function outline(shape: Shape): Outline {
  let result = outlines.get(shape);
  if (!result) {
    result = {
      outer: flattenContour(shape.outer, DRAWING_TOLERANCE),
      holes: (shape.holes ?? []).map((hole) => flattenContour(hole, DRAWING_TOLERANCE)),
    };
    outlines.set(shape, result);
  }
  return result;
}

/** A shape moved by `[dx, dy]` and scaled by `factor` about the origin. */
export function moveShape(shape: Shape, [dx, dy]: Point, factor = 1): Shape {
  const p = (point: number[]): Point => [point[0] * factor + dx, point[1] * factor + dy];
  const contour = (c: Contour): Contour => {
    switch (c.type) {
      case 'polygon':
        return { ...c, points: c.points.map(p) };
      case 'rectangle': {
        const [x, y] = p([c.x_min, c.y_min]);
        return { ...c, x_min: x, y_min: y, width: c.width * factor, height: c.height * factor };
      }
      case 'circle':
        return { ...c, center: p(c.center), radius: c.radius * factor };
      case 'path':
        return {
          ...c,
          start: p(c.start),
          segments: c.segments.map((s): Segment => {
            switch (s.type) {
              case 'line':
              case 'arc':
                return { ...s, to: p(s.to) };
              case 'quadratic':
                return { ...s, control: p(s.control), to: p(s.to) };
              case 'cubic':
                return { ...s, control1: p(s.control1), control2: p(s.control2), to: p(s.to) };
              case 'nurbs':
                return { ...s, control_points: s.control_points.map(p) };
            }
          }),
        };
    }
  };
  return { outer: contour(shape.outer), ...(shape.holes && { holes: shape.holes.map(contour) }) };
}
