import polygonClipping from 'polygon-clipping';
import { DEFAULT_SETTINGS, newPart, SHEET_LAYER, type Part, type Point, type Ring } from '../model';
import { pointSegmentDistance } from '../geometry/world';
import {
  area,
  bounds,
  inside,
  normalizePart,
  normalizeRing,
  onlyTouch,
  ringCrosses,
} from '../geometry/normalize';
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
  [
    /cutting.?line|text|dim|note|annot|label|title|border|frame|offcut|remnant.?line|viewport/i,
    'ignored',
  ],
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

/** A ring without corners that lie on the straight line between their neighbours. */
function corners(ring: Ring, tolerance: number): Ring {
  const kept = ring.filter((p, i) => {
    const [a, b] = [ring[(i + ring.length - 1) % ring.length], ring[(i + 1) % ring.length]];
    return pointSegmentDistance(p, a, b) > tolerance * 1e-3;
  });
  return kept.length >= 3 ? kept : ring;
}

const middle = (ring: Ring): Point => [
  ring.reduce((n, p) => n + p[0], 0) / ring.length,
  ring.reduce((n, p) => n + p[1], 0) / ring.length,
];

/** The turn about the middles that best lays `from` onto `to`, corner for corner. */
function bestTurn(from: Ring, to: Ring, offset: number, [ax, ay]: Point, [bx, by]: Point): number {
  let [dot, cross] = [0, 0];
  from.forEach(([x, y], i) => {
    const [u, v] = to[(i + offset) % to.length];
    dot += (x - ax) * (u - bx) + (y - ay) * (v - by);
    cross += (x - ax) * (v - by) - (y - ay) * (u - bx);
  });
  return Math.atan2(cross, dot);
}

/** Whether every one of `left` can be paired with its own one of `right`, by `fits`. */
function pairable(left: number, right: number, fits: (i: number, j: number) => boolean): boolean {
  const owner = new Array<number>(right).fill(-1);
  const claim = (i: number, seen: Set<number>): boolean => {
    for (let j = 0; j < right; j++) {
      if (seen.has(j) || !fits(i, j)) continue;
      seen.add(j);
      if (owner[j] < 0 || claim(owner[j], seen)) {
        owner[j] = i;
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < left; i++) if (!claim(i, new Set())) return false;
  return true;
}

/**
 * Whether two items have the same shape up to a move and a turn, every corner within `tolerance`.
 * Corners on a straight edge do not count. Mirrored copies are not the same: a part may differ on
 * its two sides.
 */
export function congruent(a: Item, b: Item, tolerance: number): boolean {
  const [ra, rb] = [corners(a.outline.ring, tolerance), corners(b.outline.ring, tolerance)];
  if (ra.length !== rb.length || a.holes.length !== b.holes.length) return false;
  const holesA = a.holes.map((hole) => corners(hole.ring, tolerance));
  const holesB = b.holes.map((hole) => corners(hole.ring, tolerance));
  const [ca, cb] = [middle(ra), middle(rb)];
  // Corners within the tolerance keep areas within it along the perimeter, and the middles of
  // holes as far from the middle of the outline: quick ways to tell shapes apart before turning.
  const perimeter = ra.reduce((n, p, i) => n + Math.hypot(...minus(ra[(i + 1) % ra.length], p)), 0);
  const slack = tolerance * perimeter + (ra.length * tolerance ** 2) / 2;
  if (Math.abs(Math.abs(area(ra)) - Math.abs(area(rb))) > slack) return false;
  const reach = (hole: Ring, c: Point) => Math.hypot(...minus(middle(hole), c));
  const byNumber = (x: number, y: number) => x - y;
  const da = holesA.map((h) => reach(h, ca)).sort(byNumber);
  const db = holesB.map((h) => reach(h, cb)).sort(byNumber);
  if (da.some((d, i) => Math.abs(d - db[i]) > 2 * tolerance)) return false;
  for (let shift = 0; shift < rb.length; shift++) {
    const turn = bestTurn(ra, rb, shift, ca, cb);
    const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
    const place = ([x, y]: Point): Point => [
      cb[0] + (x - ca[0]) * cos - (y - ca[1]) * sin,
      cb[1] + (x - ca[0]) * sin + (y - ca[1]) * cos,
    ];
    const matches = (from: Ring, to: Ring, offset: number) =>
      from.every(
        (p, i) => Math.hypot(...minus(place(p), to[(i + offset) % to.length])) <= tolerance,
      );
    if (!matches(ra, rb, shift)) continue;
    // Every hole lands on its own hole of the other, from any corner.
    const fits = (i: number, j: number) =>
      holesA[i].length === holesB[j].length &&
      holesB[j].some((_, k) => matches(holesA[i], holesB[j], k));
    if (pairable(holesA.length, holesB.length, fits)) return true;
  }
  return false;
}

const minus = (p: Point, q: Point): Point => [p[0] - q[0], p[1] - q[1]];

/** What an outline became: shown on the import's drawing. */
export type Mark = {
  id: string;
  layer: string;
  /** Where it is drawn. */
  ring: Ring;
  kind: 'part' | 'hole' | 'sheet' | 'defect' | 'ignored' | 'issue';
  /** Why it could not be used, for an issue. */
  message?: string;
};

/**
 * Parts and sheets from a drawing, by the roles of its outlines: an outline's own role, from
 * `overrides`, else its layer's.
 *
 * - Among outlines of the same layer and role, parts or sheets, one that lies entirely inside
 *   another, without touching it, is a hole of it; one inside a hole is an item again. Every other
 *   outline is an item. Outlines that only touch, side by side, are neighbours; outlines that
 *   overlap, or touch one inside the other, are left out as an issue, with what lies inside them.
 * - With `merge`, items of the same shape, up to a move and a turn, become one with a quantity.
 *   Sheets with defects stay apart: their defects may differ.
 * - A defect belongs to every sheet it overlaps, where it is drawn, also reaching past the
 *   sheet's edge; one that overlaps no sheet is an issue.
 * - Ignored outlines are left out.
 */
export function classify(
  drawing: Drawing,
  roles: Record<string, Role>,
  {
    merge = true,
    holes = true,
    overrides = {},
  }: { merge?: boolean; holes?: boolean; overrides?: Record<string, Role> } = {},
): { parts: Part[]; sheets: ImportedSheet[]; issues: string[]; marks: Mark[] } {
  const tolerance = drawing.tolerance;
  const layerRole = (layer: string) => roles[layer] ?? 'ignored';
  const role = (outline: Outline) => overrides[outline.id] ?? layerRole(outline.layer);
  const issues = drawing.issues
    .filter((issue) => layerRole(issue.layer) !== 'ignored')
    .map((issue) => issue.message);
  const marks = new Map<string, Mark>(
    drawing.outlines.map((outline) => [
      outline.id,
      { id: outline.id, layer: outline.layer, ring: outline.ring, kind: 'ignored' },
    ]),
  );
  const fail = (id: string, message: string) => {
    issues.push(`${id}: ${message}`);
    Object.assign(marks.get(id)!, { kind: 'issue', message });
  };
  const kept: (Kept & { role: Role })[] = [];
  for (const outline of drawing.outlines) {
    const own = role(outline);
    if (own === 'ignored') continue;
    try {
      kept.push({ ...outline, role: own, ring: normalizeRing(outline.ring) });
    } catch (error) {
      fail(outline.id, error instanceof Error ? error.message : String(error));
    }
  }

  // Items and their holes, among outlines of one layer and role.
  const items: { role: 'parts' | 'sheets'; item: Item }[] = [];
  const groupsOf = new Map<string, (typeof kept)[number][]>();
  for (const outline of kept)
    if (outline.role === 'parts' || outline.role === 'sheets') {
      const key = `${outline.layer}\u0000${outline.role}`;
      groupsOf.set(key, [...(groupsOf.get(key) ?? []), outline]);
    }
  for (const outlines of groupsOf.values()) {
    const kind = outlines[0].role as 'parts' | 'sheets';
    const left = new Set<number>();
    const neighbours = new Set<string>();
    for (let i = 0; i < outlines.length; i++)
      for (let j = 0; j < i; j++) {
        if (!ringCrosses(outlines[i].ring, outlines[j].ring)) continue;
        if (onlyTouch(outlines[i].ring, outlines[j].ring, tolerance)) neighbours.add(`${i},${j}`);
        else {
          left.add(i);
          left.add(j);
          const message = 'it overlaps another outline, or touches one from inside.';
          issues.push(
            `${outlines[j].id} and ${outlines[i].id}: they overlap, or one touches the other from inside. Leave one out or repair the source.`,
          );
          for (const k of [i, j])
            Object.assign(marks.get(outlines[k].id)!, { kind: 'issue', message });
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
    outlines.forEach((outline, i) => {
      if (gone(i) && !left.has(i))
        Object.assign(marks.get(outline.id)!, {
          kind: 'issue',
          message: 'it lies inside an outline that is left out.',
        });
    });
    const keptIndex = outlines.map((_, i) => i).filter((i) => !gone(i));
    const usable = keptIndex.map((i) => outlines[i]);
    const parent = keptIndex.map((i) => keptIndex.indexOf(around[i]));
    const depth = (i: number): number => (parent[i] < 0 ? 0 : 1 + depth(parent[i]));
    usable.forEach((outline, i) => {
      if (holes && depth(i) % 2 === 1) {
        marks.get(outline.id)!.kind = 'hole';
        return;
      }
      marks.get(outline.id)!.kind = kind === 'parts' ? 'part' : 'sheet';
      const own = holes ? usable.filter((_, j) => parent[j] === i) : [];
      items.push({ role: kind, item: { outline, holes: own } });
    });
  }

  // Defects, where they are drawn, with the sheets they overlap.
  const sheetItems = items.filter((entry) => entry.role === 'sheets').map((entry) => entry.item);
  const defectsOf = new Map<Item, Kept[]>(sheetItems.map((item) => [item, []]));
  for (const defect of kept.filter((outline) => outline.role === 'defects')) {
    const over = sheetItems.filter(
      // The sheet's material: a defect within one of its holes is on no material of it.
      (sheet) =>
        polygonClipping.intersection(
          [defect.ring],
          [sheet.outline.ring, ...sheet.holes.map((hole) => hole.ring)],
        ).length > 0,
    );
    if (!over.length) fail(defect.id, 'this defect overlaps no sheet.');
    else marks.get(defect.id)!.kind = 'defect';
    for (const sheet of over) defectsOf.get(sheet)!.push(defect);
  }

  // Items of the same shape, as one with a quantity.
  // A group approximates curves when any of its copies does.
  const curvedItem = (item: Item) => item.outline.curved || item.holes.some((hole) => hole.curved);
  const groups: { role: 'parts' | 'sheets'; item: Item; count: number; curved: boolean }[] = [];
  for (const { role: kind, item } of items) {
    const alone = kind === 'sheets' && defectsOf.get(item)!.length > 0;
    const same =
      merge && !alone
        ? groups.find(
            (group) =>
              group.role === kind &&
              !(kind === 'sheets' && defectsOf.get(group.item)!.length) &&
              congruent(group.item, item, tolerance),
          )
        : undefined;
    if (same) {
      same.count++;
      same.curved ||= curvedItem(item);
    } else groups.push({ role: kind, item, count: 1, curved: curvedItem(item) });
  }

  const shapeOf = (item: Item): Shape => ({
    outer: item.outline.contour,
    ...(item.holes.length && { holes: item.holes.map((hole) => hole.contour) }),
  });
  const parts: Part[] = [];
  const sheets: ImportedSheet[] = [];
  for (const { role: kind, item, count, curved } of groups) {
    // Moved so the outline starts at the origin, defects with it.
    const [x, y] = bounds(item.outline.ring);
    const shape = moveShape(shapeOf(item), [-x, -y]);
    if (kind === 'sheets') {
      const own = defectsOf
        .get(item)!
        .map((defect) => moveShape({ outer: defect.contour }, [-x, -y]).outer);
      sheets.push({ name: item.outline.id, shape, quantity: count, defects: own });
      continue;
    }
    const part: Part = {
      ...newPart(shape, item.outline.id),
      quantity: count,
      source: { format: drawing.format, fileName: drawing.name, entityId: item.outline.id },
      approximationToleranceMm: curved ? tolerance : 0,
    };
    try {
      parts.push(normalizePart(part));
    } catch (error) {
      fail(item.outline.id, error instanceof Error ? error.message : String(error));
    }
  }
  return { parts, sheets, issues, marks: [...marks.values()] };
}

/** A drawing read as parts and sheets, the way the import dialog shows it. */
export function review(
  drawing: Drawing,
  roles: Record<string, Role>,
  options: { merge?: boolean; holes?: boolean; overrides?: Record<string, Role> } = {},
): ImportReview {
  const { parts, sheets, issues, marks } = classify(drawing, roles, options);
  return {
    document: {
      name: drawing.name.replace(/\.(dxf|svg)$/i, ''),
      parts,
      settings: { ...DEFAULT_SETTINGS },
    },
    sheets,
    warnings: drawing.warnings,
    issues,
    layers: drawing.layers,
    roles,
    outlines: Object.fromEntries(
      drawing.layers.map((layer) => [
        layer,
        drawing.outlines.filter((o) => o.layer === layer).length,
      ]),
    ),
    marks,
  };
}
