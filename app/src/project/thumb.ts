import type { Box } from './layout';

type Point = [number, number];

/**
 * A small drawing for lists, packed to fit a project's summary: shapes on a grid of whole steps,
 * at most 255 across, y pointing down. `shapes` is base64 of bytes: for each shape, its fill (its
 * color's place in the palette, from 0, or `MATERIAL`), its ring count, and per ring its point
 * count and its points as x, y pairs. Rings fill even-odd, so holes cut through.
 */
export type Thumb = { width: number; height: number; shapes: string };
export type ThumbShape = { fill: number; rings: Point[][] };

/** The fill of the material a layout lies on, drawn first and below the parts. */
export const MATERIAL = 255;
const GRID = 255;

/**
 * Draws shapes within `box`, in drawing coordinates with y pointing up, as a thumb. Each ring is
 * simplified first, then its corners put on the grid, so a smooth slope stays one straight edge
 * rather than a staircase of steps; a shape too small to keep its outline keeps its extent, so
 * it still shows, and a hole too small to show is left out, as are holes past the 254 a byte can
 * count.
 */
export function packThumb(box: Box, shapes: { fill: number; rings: Point[][] }[]): Thumb {
  const [x0, y0, x1, y1] = box;
  const scale = GRID / Math.max(x1 - x0, y1 - y0, 1e-9);
  const width = Math.max(1, Math.ceil((x1 - x0) * scale));
  const height = Math.max(1, Math.ceil((y1 - y0) * scale));
  const bytes: number[] = [];
  for (const { fill, rings } of shapes) {
    const kept = rings
      .flatMap((ring, index) => {
        const grid = onGrid(
          simplify(ring.map(([x, y]): Point => [(x - x0) * scale, (y1 - y) * scale])),
          width,
          height,
        );
        if (grid.length >= 3) return [grid];
        return index === 0
          ? [extent(ring.map(([x, y]) => [(x - x0) * scale, (y1 - y) * scale]))]
          : [];
      })
      .slice(0, 255);
    bytes.push(fill, kept.length);
    for (const ring of kept) bytes.push(ring.length, ...ring.flat());
  }
  return { width, height, shapes: base64(bytes) };
}

/** A thumb's shapes, in its grid; undefined when its bytes do not read. */
export function unpackThumb(thumb: Thumb): ThumbShape[] | undefined {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(thumb.shapes), (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
  const shapes: ThumbShape[] = [];
  let at = 0;
  const next = () => (at < bytes.length ? bytes[at++] : undefined);
  while (at < bytes.length) {
    const fill = next();
    const count = next();
    if (fill === undefined || count === undefined) return undefined;
    const rings: Point[][] = [];
    for (let r = 0; r < count; r++) {
      const points = next();
      if (points === undefined || at + 2 * points > bytes.length) return undefined;
      rings.push(Array.from({ length: points }, () => [bytes[at++], bytes[at++]]));
    }
    shapes.push({ fill, rings });
  }
  return shapes;
}

/** A thumb's rings as an SVG path, in its grid. */
export const thumbPath = (rings: Point[][]) =>
  rings.map((ring) => `M${ring.map(([x, y]) => `${x},${y}`).join('L')}Z`).join('');

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));

/** A ring's extent as a rectangle of at least one step, for shapes smaller than the grid. */
function extent(ring: Point[]): Point[] {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const [left, top] = [Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys))];
  const right = Math.max(left + 1, Math.ceil(Math.max(...xs)));
  const bottom = Math.max(top + 1, Math.ceil(Math.max(...ys)));
  const [l, t] = [clamp(left, GRID - 1), clamp(top, GRID - 1)];
  const [r, b] = [clamp(right, GRID), clamp(bottom, GRID)];
  return [
    [l, t],
    [r, t],
    [r, b],
    [l, b],
  ];
}

/** A ring without repeated points, its last not the first again. */
function distinct(ring: Point[]): Point[] {
  const kept = ring.filter(
    (point, i) => i === 0 || point[0] !== ring[i - 1][0] || point[1] !== ring[i - 1][1],
  );
  while (kept.length > 1 && kept[0][0] === kept.at(-1)![0] && kept[0][1] === kept.at(-1)![1])
    kept.pop();
  return kept;
}

/** A simplified ring's corners on the grid's whole steps. */
const onGrid = (ring: Point[], width: number, height: number) =>
  distinct(
    ring.map(([x, y]): Point => [clamp(Math.round(x), width), clamp(Math.round(y), height)]),
  );

/**
 * A ring in grid steps with the points that lie within a step of the line through their
 * neighbours left out, and at most 255 points.
 */
function simplify(ring: Point[]): Point[] {
  const points = distinct(ring);
  if (points.length < 3) return points;
  for (let tolerance = 1; ; tolerance *= 2) {
    // Split the ring at its first point and the point farthest from it, and simplify both halves.
    const far = points.reduce(
      (best, point, i) =>
        distance2(point, points[0]) > distance2(points[best], points[0]) ? i : best,
      0,
    );
    const kept = [
      ...peucker(points.slice(0, far + 1), tolerance).slice(0, -1),
      ...peucker([...points.slice(far), points[0]], tolerance).slice(0, -1),
    ];
    if (kept.length <= 255) return kept;
  }
}

const distance2 = ([ax, ay]: Point, [bx, by]: Point) => (ax - bx) ** 2 + (ay - by) ** 2;

/** Douglas–Peucker on an open line: its ends, and the points farther than `tolerance` from it. */
function peucker(line: Point[], tolerance: number): Point[] {
  if (line.length <= 2) return line;
  const [a, b] = [line[0], line.at(-1)!];
  const length = Math.sqrt(distance2(a, b));
  let farthest = 0;
  let index = 0;
  for (let i = 1; i < line.length - 1; i++) {
    const [px, py] = line[i];
    const off =
      length === 0
        ? Math.sqrt(distance2(line[i], a))
        : Math.abs((b[0] - a[0]) * (a[1] - py) - (a[0] - px) * (b[1] - a[1])) / length;
    if (off > farthest) [farthest, index] = [off, i];
  }
  if (farthest <= tolerance) return [a, b];
  return [
    ...peucker(line.slice(0, index + 1), tolerance).slice(0, -1),
    ...peucker(line.slice(index), tolerance),
  ];
}

function base64(bytes: number[]): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  return btoa(text);
}
