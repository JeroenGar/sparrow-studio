import { DEFAULT_SETTINGS, newPart, type Ring } from '../model';
import { flattenContour, isCurved, outline, polygon, type Contour, type Shape } from '../geometry/contour';
import { normalizeJob, normalizeRing } from '../geometry/normalize';
import type { ImportedSheet } from './drawing';
import { localize, number, record, type ImportReview } from './sparrow';

/** Whether a JSON value is a job input in sparrow Pro's format, rather than a sparrow instance. */
export const isProInput = (value: unknown) =>
  !!value && typeof value === 'object' && 'schema_version' in value && 'geometries' in value;

/**
 * The parts and sheets of a job input in sparrow Pro's format, in millimetres. Its parts follow
 * the project's defaults, as imported parts do; how they may turn, the distances and the rest of
 * the job are left out. `curves` keeps curves as they are, or flattens them within `tolerance`.
 */
export function importPro(
  value: unknown,
  fileName: string,
  options: { curves: 'keep' | 'flatten'; tolerance: number },
): ImportReview {
  const input = record(value);
  if (!Array.isArray(input.geometries) || !Array.isArray(input.parts))
    throw Error('Expected a sparrow Pro job input with geometries and parts.');
  const shapes = new Map<string, Shape>();
  for (const raw of input.geometries) {
    const geometry = record(raw);
    if (typeof geometry.id !== 'string') throw Error('Every geometry needs a text ID.');
    shapes.set(geometry.id, shaped(record(geometry.shape), options));
  }
  const shape = (owner: string, id: unknown) => {
    const found = typeof id === 'string' && shapes.get(id);
    if (!found) throw Error(`${owner}: no geometry ${String(id)}.`);
    return found;
  };
  const parts = input.parts.map((raw) => {
    const part = record(raw);
    const name = `Part ${String(part.id)}`;
    return localize({
      ...newPart(shape(name, part.geometry_id), name),
      quantity: number(part.quantity),
      source: { format: 'sparrow', fileName, entityId: String(part.id) },
    });
  });
  const problem = record(input.problem);
  const strip = problem.type === 'minimize_strip_length';
  if (!strip && problem.type !== 'minimize_sheets_in_order')
    throw Error(`Problem ${String(problem.type)} is unsupported.`);
  const sheets = strip
    ? []
    : (Array.isArray(problem.sheets) ? problem.sheets : []).map((raw): ImportedSheet => {
        const sheet = record(raw);
        const name = `Sheet ${String(sheet.id)}`;
        const defects = sheet.defects ?? [];
        if (!Array.isArray(defects)) throw Error(`${name}: defects must be a list.`);
        return {
          name,
          shape: checkedSheet(name, shape(name, sheet.geometry_id)),
          quantity: sheet.quantity === undefined ? 1 : number(sheet.quantity),
          defects: defects.map((defect) => contour(record(defect) as Contour, options)),
        };
      });
  const document = normalizeJob(
    {
      name: fileName,
      parts,
      settings: { ...DEFAULT_SETTINGS, ...(strip && { materialWidthMm: number(problem.height) }) },
    },
    true,
  );
  return {
    document,
    sheets,
    warnings: ["Parts follow the project's part defaults; the file's other settings are left out."],
  };
}

const contour = (value: Contour, { curves, tolerance }: { curves: string; tolerance: number }) =>
  curves === 'flatten' && isCurved(value) ? polygon(flattenContour(value, tolerance)) : value;

function shaped(value: Record<string, unknown>, options: { curves: string; tolerance: number }): Shape {
  const holes = value.holes ?? [];
  if (!Array.isArray(holes)) throw Error('Holes must be a list.');
  const outer = contour(record(value.outer) as Contour, options);
  return {
    outer,
    ...(holes.length && { holes: holes.map((hole) => contour(record(hole) as Contour, options)) }),
  };
}

/**
 * A sheet's shape, once its contours are known to be drawable rings. Its holes, unlike a part's,
 * may overlap and reach past its edge.
 */
function checkedSheet(name: string, shape: Shape): Shape {
  try {
    const { outer, holes } = outline(shape);
    [outer, ...holes].forEach((ring: Ring) => normalizeRing(ring));
  } catch (error) {
    throw Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return shape;
}
