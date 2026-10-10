import { bounds } from '../engine/geometry/normalize';
import type { Part } from '../engine/model';

export type Box = [minX: number, minY: number, maxX: number, maxY: number];
/** Where each part type is drawn on the Parts canvas, as an offset added to its own coordinates. */
export type Arrangement = {
  offsets: Map<string, [number, number]>;
  boxes: Map<string, Box>;
  extent: Box;
  /** Offset of the stacked outlines behind a part with several copies, in mm, so it scales with zoom. */
  stack: number;
};

/**
 * Lay part types out in rows, tallest first, at true scale. Each type appears once; this is a
 * display arrangement, not a nesting, and nothing about it is stored in the project.
 */
export function arrangeParts(parts: Part[]): Arrangement {
  const offsets = new Map<string, [number, number]>();
  const boxes = new Map<string, Box>();
  if (!parts.length) return { offsets, boxes, extent: [0, 0, 100, 100], stack: 1 };
  const sizes = parts.map((part) => {
    const b = bounds(part.outer);
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
  for (const { part, b, w, h } of order) {
    if (x > 0 && x + w > rowWidth) {
      x = 0;
      y -= rowHeight + gap;
      rowHeight = 0;
    }
    // Rows grow downward; the canvas y axis points up.
    const offset: [number, number] = [x - b[0], y - h - b[1]];
    offsets.set(part.id, offset);
    boxes.set(part.id, [x, y - h, x + w, y]);
    x += w + gap;
    maxX = Math.max(maxX, x - gap);
    rowHeight = Math.max(rowHeight, h);
  }
  // Shift everything up so the drawing starts at the origin and the rulers read from zero.
  const height = rowHeight - y;
  for (const [id, [dx, dy]] of offsets) offsets.set(id, [dx, dy + height]);
  for (const [id, [x0, y0, x1, y1]] of boxes) boxes.set(id, [x0, y0 + height, x1, y1 + height]);
  return { offsets, boxes, extent: [0, 0, maxX, height], stack: gap * 0.1 };
}
