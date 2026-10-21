import { bounds } from '../engine/geometry/normalize';
import { netArea } from '../engine/geometry/world';
import type { Part } from '../engine/model';
import { outline } from '../engine/geometry/contour';
import type { SheetEntry, Stock } from './model';

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

/** Boxes in rows of `columns`, left to right and top down, hanging from y = 0, `gap` apart. */
export function inRows(own: Box[], columns: number, gap: number) {
  const offsets: [number, number][] = [];
  const boxes: Box[] = [];
  const rows: number[] = [];
  let top = 0;
  for (let start = 0; start < own.length; start += columns) {
    const row = own.slice(start, start + columns);
    const height = Math.max(...row.map((box) => box[3] - box[1]));
    let x = 0;
    for (const box of row) {
      // Rows hang from their top, and grow downward.
      const offset: [number, number] = [x - box[0], top - box[3]];
      offsets.push(offset);
      boxes.push([box[0] + offset[0], box[1] + offset[1], box[2] + offset[0], box[3] + offset[1]]);
      rows.push(start / columns);
      x += box[2] - box[0] + gap;
    }
    top -= height + gap;
  }
  const extent: Box = own.length
    ? [
        Math.min(...boxes.map((box) => box[0])),
        Math.min(...boxes.map((box) => box[1])),
        Math.max(...boxes.map((box) => box[2])),
        Math.max(...boxes.map((box) => box[3])),
      ]
    : [0, 0, 0, 0];
  return { offsets, boxes, rows, extent };
}

/** The gap between boxes laid out in rows: a share of the largest. */
export const rowGap = (own: Box[]) =>
  Math.max(...own.map((box) => Math.max(box[2] - box[0], box[3] - box[1])), 1) * 0.12;

/**
 * How far below the parts their material lies on the shared canvas, as a share of the taller of
 * the two: far enough that the one in focus fills the view, near enough that the other shows at
 * its edge. Tuned by eye.
 */
export const MATERIAL_DISTANCE = 0.12;

/** Where the sheets go: in rows as wide as `width`, as many to a row as fit, in their order. */
export type SheetsPlace = ReturnType<typeof inRows> & { gap: number };
/** Where the strip goes: its band, as wide as the strip and as long as drawn. */
export type StripPlace = { box: Box; width: number; length: number };

/**
 * The shared canvas of the Parts and Sheets tabs: the parts above, laid out as `arrangeParts` does,
 * and below them, `MATERIAL_DISTANCE` away and centred under them, the sheets in rows or the strip.
 */
export function arrangeMaterial(parts: Part[], stock: Stock) {
  const arrangement = arrangeParts(parts);
  const [, , partsWidth, partsHeight] = arrangement.extent;
  if (stock.packing === 'strip') {
    const widthMm = stock.strip.widthMm;
    const width = Number.isFinite(widthMm) && widthMm > 0 ? widthMm : 1000;
    const area = parts.reduce((sum, part) => sum + netArea(part) * part.quantity, 0);
    // An impression of the length, not a promise: the solver finds the real one.
    const length = Math.max(width * 1.6, (area / width) * 1.3);
    const top = -MATERIAL_DISTANCE * Math.max(partsHeight, width);
    const left = (partsWidth - length) / 2;
    const strip: StripPlace = { box: [left, top - width, left + length, top], width, length };
    return { parts: arrangement, strip, material: strip.box };
  }
  const sheets = placeSheets(stock.sheets, partsWidth);
  const [x0, y0, x1, y1] = sheets.extent;
  const top = -MATERIAL_DISTANCE * Math.max(partsHeight, y1 - y0);
  const [dx, dy] = [(partsWidth - (x1 - x0)) / 2 - x0, top - y1];
  const moved = (box: Box): Box => [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy];
  const placed: SheetsPlace = {
    ...sheets,
    offsets: sheets.offsets.map(([ox, oy]) => [ox + dx, oy + dy]),
    boxes: sheets.boxes.map(moved),
    extent: moved(sheets.extent),
  };
  return { parts: arrangement, sheets: placed, material: placed.extent };
}

/** The sheet entries in rows of at most `width`, but at least one to a row. */
function placeSheets(sheets: SheetEntry[], width: number): SheetsPlace {
  const own = sheets.map((sheet) => bounds(outline(sheet.shape).outer) as Box);
  const gap = rowGap(own);
  let columns = 1;
  while (columns < own.length) {
    const next = columns + 1;
    const widest = Math.max(
      ...Array.from({ length: Math.ceil(own.length / next) }, (_, row) =>
        own
          .slice(row * next, row * next + next)
          .reduce((sum, box, i) => sum + (box[2] - box[0]) + (i ? gap : 0), 0),
      ),
    );
    if (widest > width) break;
    columns = next;
  }
  return { ...inRows(own, columns, gap), gap };
}
