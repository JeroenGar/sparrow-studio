import polygonClipping from 'polygon-clipping';
import { DEFAULT_SETTINGS, newPart, SHEET_LAYER, type Part, type Ring } from '../model';
import { area, bounds, inside, normalizePart, normalizeRing, onlyTouch, ringCrosses } from '../geometry/normalize';
import { moveShape, type Contour, type Shape } from '../geometry/contour';
import type { ImportReview } from './sparrow';

/** A closed outline traced from a drawing, where it is drawn, on its layer. */
export type Outline = {
  id: string;
  layer: string;
  /** The outline as a polygon, for topology and checks. */
  ring: Ring;
  /** The same outline in the job format, curves kept where they could be. */
  contour: Contour;
  /** Whether `contour` approximates curves. */
  curved: boolean;
};

/**
 * What a DXF or SVG file holds once its paths are traced: every closed outline, the file's
 * layers, and what could not become an outline. Both importers end here; what the outlines are
 * is decided by `classify`, the same for both.
 */
export type Drawing = {
  name: string;
  format: 'svg' | 'dxf';
  outlines: Outline[];
  layers: string[];
  warnings: string[];
  /** What could not become an outline, by layer: it matters only where the layer is used. */
  issues: { layer: string; message: string }[];
  /** The accuracy the outlines were traced with, in millimetres, gaps closed included. */
  tolerance: number;
};

/** What a layer's outlines become. */
export type Role = 'parts' | 'sheets' | 'defects' | 'ignored';

/** A sheet read from a drawing: its outline and holes, in stock as often as it was drawn. */
export type ImportedSheet = { name: string; shape: Shape; quantity: number; defects: Contour[] };

/** The roles of a drawing's layers before anyone chooses: parts, except studio's own sheet layer. */
export const defaultRoles = (layers: string[]): Record<string, Role> =>
  Object.fromEntries(layers.map((layer) => [layer, layer === SHEET_LAYER ? 'ignored' : 'parts']));

/** Words in layer names that say what a layer holds, in the order they are tried. */
const ROLE_WORDS: [RegExp, Role][] = [
  [/defect|flaw|damage|clamp|keep.?out|exclu/i, 'defects'],
  [/cutting.?line|text|dim|note|annot|label|title|border|frame|offcut|remnant.?line|viewport/i, 'ignored'],
  [/sheet|plate|stock|material|blank|remnant|hide|bin/i, 'sheets'],
];

/**
 * Roles to start an import with: from the layer's name where it says what the layer holds, such
 * as "Sheet" or "Defects"; otherwise `fallback`, the kind of content the import was opened for.
 */
export function suggestRoles(layers: string[], fallback: 'parts' | 'sheets'): Record<string, Role> {
  return Object.fromEntries(
    layers.map((layer) => [
      layer,
      layer === SHEET_LAYER && fallback === 'parts'
        ? 'ignored'
        : (ROLE_WORDS.find(([words]) => words.test(layer))?.[1] ?? fallback),
    ]),
  );
}

type Kept = Outline & { ring: Ring };
type Item = { outline: Kept; holes: Kept[] };

/**
 * Whether two items have the same shape up to a move and a turn, every corner within `tolerance`.
 * Mirrored copies are not the same: a part may differ on its two sides.
 */
export function congruent(a: Item, b: Item, tolerance: number): boolean {
  const [ra, rb] = [a.outline.ring, b.outline.ring];
  if (ra.length !== rb.length || a.holes.length !== b.holes.length) return false;
  const perimeter = ra.reduce((n, p, i) => n + Math.hypot(...minus(ra[(i + 1) % ra.length], p)), 0);
  if (Math.abs(Math.abs(area(ra)) - Math.abs(area(rb))) > tolerance * perimeter) return false;
  const [ca, cb] = [middle(ra), middle(rb)];
  const angleOf = (p: [number, number], c: [number, number]) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  for (let shift = 0; shift < rb.length; shift++) {
    const turn = angleOf(rb[shift], cb) - angleOf(ra[0], ca);
    const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
    const place = ([x, y]: [number, number]): [number, number] => [
      cb[0] + (x - ca[0]) * cos - (y - ca[1]) * sin,
      cb[1] + (x - ca[0]) * sin + (y - ca[1]) * cos,
    ];
    const matches = (from: Ring, to: Ring, offset: number) =>
      from.every((p, i) => {
        const [x, y] = place(p);
        const q = to[(i + offset) % to.length];
        return Math.hypot(x - q[0], y - q[1]) <= tolerance;
      });
    if (!matches(ra, rb, shift)) continue;
    // Every hole lands on a hole of the other, in any order, from any corner.
    const free = [...b.holes];
    const holesMatch = a.holes.every((hole) => {
      const at = free.findIndex(
        (other) =>
          other.ring.length === hole.ring.length &&
          other.ring.some((_, k) => matches(hole.ring, other.ring, k)),
      );
      return at >= 0 && free.splice(at, 1).length === 1;
    });
    if (holesMatch) return true;
  }
  return false;
}

const minus = (p: [number, number], q: [number, number]): [number, number] => [p[0] - q[0], p[1] - q[1]];
const middle = (ring: Ring): [number, number] => [
  ring.reduce((n, p) => n + p[0], 0) / ring.length,
  ring.reduce((n, p) => n + p[1], 0) / ring.length,
];

/**
 * Parts and sheets from a drawing, by the roles of its layers:
 *
 * - On a layer of parts or sheets, an outline that lies entirely inside another one of the same
 *   layer, without touching it, is a hole of it; one inside a hole is an item again. Every other
 *   outline is an item. Outlines that only touch, side by side, are neighbours; outlines that
 *   overlap, or touch one inside the other, are left out as an issue.
 * - With `merge`, items of the same shape, up to a move and a turn, become one with a quantity.
 *   Sheets with defects stay apart: their defects may differ.
 * - An outline on a layer of defects is a defect of every sheet it overlaps, where it is drawn,
 *   also reaching past the sheet's edge; one that overlaps no sheet is an issue.
 * - Ignored layers are left out.
 */
export function classify(
  drawing: Drawing,
  roles: Record<string, Role>,
  { merge = true, holes = true }: { merge?: boolean; holes?: boolean } = {},
): { parts: Part[]; sheets: ImportedSheet[]; issues: string[] } {
  const tolerance = drawing.tolerance;
  const role = (outline: Pick<Outline, 'layer'>) => roles[outline.layer] ?? 'ignored';
  const issues = drawing.issues.filter((issue) => role(issue) !== 'ignored').map((issue) => issue.message);
  const kept: Kept[] = [];
  for (const outline of drawing.outlines) {
    if (role(outline) === 'ignored') continue;
    try {
      kept.push({ ...outline, ring: normalizeRing(outline.ring) });
    } catch (error) {
      issues.push(`${outline.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Items and their holes, layer by layer.
  const items: { role: 'parts' | 'sheets'; item: Item }[] = [];
  const layers = [...new Set(kept.map((outline) => outline.layer))];
  for (const layer of layers) {
    const kind = roles[layer];
    if (kind !== 'parts' && kind !== 'sheets') continue;
    const outlines = kept.filter((outline) => outline.layer === layer);
    const left = new Set<number>();
    const neighbours = new Set<string>();
    for (let i = 0; i < outlines.length; i++)
      for (let j = 0; j < i; j++) {
        if (!ringCrosses(outlines[i].ring, outlines[j].ring)) continue;
        if (onlyTouch(outlines[i].ring, outlines[j].ring, tolerance)) neighbours.add(`${i},${j}`);
        else {
          left.add(i);
          left.add(j);
          issues.push(
            `${outlines[j].id} and ${outlines[i].id}: they overlap, or one touches the other from inside. Leave one out or repair the source.`,
          );
        }
      }
    // The smallest outline around each: entirely inside, as they neither cross nor only touch.
    const around = outlines.map((outline, i) => {
      let best = -1;
      outlines.forEach((other, j) => {
        if (i === j || neighbours.has(`${Math.max(i, j)},${Math.min(i, j)}`)) return;
        if (ringCrosses(outline.ring, other.ring) || !inside(outline.ring[0], other.ring)) return;
        if (best < 0 || Math.abs(area(other.ring)) < Math.abs(area(outlines[best].ring))) best = j;
      });
      return best;
    });
    // What lies inside an outline that is left out goes with it: a hole is no part on its own.
    const gone = (i: number): boolean => left.has(i) || (around[i] >= 0 && gone(around[i]));
    const keptIndex = outlines.map((_, i) => i).filter((i) => !gone(i));
    const usable = keptIndex.map((i) => outlines[i]);
    const parent = keptIndex.map((i) => keptIndex.indexOf(around[i]));
    const depth = (i: number): number => (parent[i] < 0 ? 0 : 1 + depth(parent[i]));
    usable.forEach((outline, i) => {
      if (holes && depth(i) % 2 === 1) return;
      const own = holes ? usable.filter((_, j) => parent[j] === i) : [];
      items.push({ role: kind, item: { outline, holes: own } });
    });
  }

  // Defects, where they are drawn, with the sheets they overlap.
  const defects = kept.filter((outline) => role(outline) === 'defects');
  const sheetItems = items.filter((entry) => entry.role === 'sheets').map((entry) => entry.item);
  const defectsOf = new Map<Item, Kept[]>(sheetItems.map((item) => [item, []]));
  for (const defect of defects) {
    const over = sheetItems.filter(
      (sheet) => polygonClipping.intersection([defect.ring], [sheet.outline.ring]).length > 0,
    );
    if (!over.length) issues.push(`${defect.id}: this defect overlaps no sheet.`);
    for (const sheet of over) defectsOf.get(sheet)!.push(defect);
  }

  // Items of the same shape, as one with a quantity.
  const groups: { item: Item; count: number }[] = [];
  for (const { role: kind, item } of items) {
    const alone = kind === 'sheets' && defectsOf.get(item)!.length > 0;
    const same =
      merge && !alone
        ? groups.find(
            (group) =>
              items.find((entry) => entry.item === group.item)!.role === kind &&
              !(kind === 'sheets' && defectsOf.get(group.item)!.length) &&
              congruent(group.item, item, tolerance),
          )
        : undefined;
    if (same) same.count++;
    else groups.push({ item, count: 1 });
  }

  const shapeOf = (item: Item): Shape => ({
    outer: item.outline.contour,
    ...(item.holes.length && { holes: item.holes.map((hole) => hole.contour) }),
  });
  const parts: Part[] = [];
  const sheets: ImportedSheet[] = [];
  for (const { item, count } of groups) {
    const kind = items.find((entry) => entry.item === item)!.role;
    // Moved so the outline starts at the origin, defects with it.
    const [x, y] = bounds(item.outline.ring);
    const shape = moveShape(shapeOf(item), [-x, -y]);
    if (kind === 'sheets') {
      const own = defectsOf.get(item)!.map((defect) => moveShape({ outer: defect.contour }, [-x, -y]).outer);
      sheets.push({ name: item.outline.id, shape, quantity: count, defects: own });
      continue;
    }
    const curved = item.outline.curved || item.holes.some((hole) => hole.curved);
    const part: Part = {
      ...newPart(shape, item.outline.id),
      quantity: count,
      source: { format: drawing.format, fileName: drawing.name, entityId: item.outline.id },
      approximationToleranceMm: curved ? tolerance : 0,
    };
    try {
      parts.push(normalizePart(part));
    } catch (error) {
      issues.push(`${item.outline.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { parts, sheets, issues };
}

/** A drawing read as parts, the way the import dialog shows it. */
export function review(
  drawing: Drawing,
  roles: Record<string, Role>,
  options: { merge?: boolean; holes?: boolean } = {},
): ImportReview {
  const { parts, sheets, issues } = classify(drawing, roles, options);
  return {
    document: { name: drawing.name.replace(/\.(dxf|svg)$/i, ''), parts, settings: { ...DEFAULT_SETTINGS } },
    sheets,
    warnings: drawing.warnings,
    issues,
    layers: drawing.layers,
    roles,
    outlines: Object.fromEntries(
      drawing.layers.map((layer) => [layer, drawing.outlines.filter((o) => o.layer === layer).length]),
    ),
  };
}
