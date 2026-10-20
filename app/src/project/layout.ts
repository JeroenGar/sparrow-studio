import { bounds } from '../engine/geometry/normalize';
import type { Part } from '../engine/model';
import { outline } from '../engine/geometry/contour';

export type Box = [minX: number, minY: number, maxX: number, maxY: number];
/** Where each part type is drawn on the Parts canvas, as an offset added to its own coordinates. */
export type Arrangement = {
  offsets: Map<string, [number, number]>;
  boxes: Map<string, Box>;
  /** The bottom of each part's row, where the names of its parts line up. */
  rowBottoms: Map<string, number>;
  extent: Box;
};

/**
 * Lay part types out in rows, tallest first, at true scale. Each type appears once; this is a
 * display arrangement, not a nesting, and nothing about it is stored in the project.
 */
export function arrangeParts(parts: Part[]): Arrangement {
  const offsets = new Map<string, [number, number]>();
  const boxes = new Map<string, Box>();
  const rowBottoms = new Map<string, number>();
  if (!parts.length) return { offsets, boxes, rowBottoms, extent: [0, 0, 100, 100] };
  const sizes = parts.map((part) => {
    const b = bounds(outline(part.shape).outer);
    return { part, b, w: b[2] - b[0], h: b[3] - b[1] };
  });
  const dimensions = sizes.flatMap(({ w, h }) => [w, h]).sort((a, b) => a - b);
  const gap = dimensions[Math.floor(dimensions.length / 2)] * 0.35;
  const area = sizes.reduce((sum, { w, h }) => sum + (w + gap) * (h + gap), 0);
  const rowWidth = Math.max(Math.max(...sizes.map(({ w }) => w)), Math.sqrt(area) * 1.6);
  const order = [...sizes].sort((a, b) => b.h - a.h);
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let maxX = 0;
  let row: string[] = [];
  const endRow = () => row.forEach((id) => rowBottoms.set(id, y - rowHeight));
  for (const { part, b, w, h } of order) {
    if (x > 0 && x + w > rowWidth) {
      endRow();
      row = [];
      x = 0;
      y -= rowHeight + gap;
      rowHeight = 0;
    }
    row.push(part.id);
    // Rows grow downward; the canvas y axis points up.
    const offset: [number, number] = [x - b[0], y - h - b[1]];
    offsets.set(part.id, offset);
    boxes.set(part.id, [x, y - h, x + w, y]);
    x += w + gap;
    maxX = Math.max(maxX, x - gap);
    rowHeight = Math.max(rowHeight, h);
  }
  endRow();
  // Shift everything up so the drawing starts at the origin and the rulers read from zero.
  const height = rowHeight - y;
  for (const [id, bottom] of rowBottoms) rowBottoms.set(id, bottom + height);
  for (const [id, [dx, dy]] of offsets) offsets.set(id, [dx, dy + height]);
  for (const [id, [x0, y0, x1, y1]] of boxes) boxes.set(id, [x0, y0 + height, x1, y1 + height]);
  return { offsets, boxes, rowBottoms, extent: [0, 0, maxX, height] };
}
