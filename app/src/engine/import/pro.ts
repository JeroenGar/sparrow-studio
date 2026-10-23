import { DEFAULT_SETTINGS, newPart } from '../model';
import { flattenContour, isCurved, outline, polygon, type Contour, type Shape } from '../geometry/contour';
import { holeProblem, normalizeJob, normalizePart, normalizeRing } from '../geometry/normalize';
import type { ImportedSheet } from './drawing';
import { localize, number, record, type ImportReview } from './sparrow';

/** Whether a JSON value is a job input in sparrow Pro's format, rather than a sparrow instance. */
export const isProInput = (value: unknown) =>
  !!value && typeof value === 'object' && 'schema_version' in value && 'geometries' in value;

type Options = { curves: 'keep' | 'flatten'; tolerance: number };

/**
 * The parts and sheets of a job input in sparrow Pro's format, in millimetres. Its parts follow
 * the project's defaults, as imported parts do; how they may turn, the distances and the rest of
 * the job are left out. A part or sheet that cannot be used is left out too, and listed in the
 * review's issues. `curves` keeps curves as they are, or flattens them within `tolerance`.
 */
export function importPro(value: unknown, fileName: string, options: Options): ImportReview {
  const input = record(value);
  if (!Array.isArray(input.geometries) || !Array.isArray(input.parts))
    throw Error('Expected a sparrow Pro job input with geometries and parts.');
  // A part or sheet that cannot be used is left out, and said why; the rest is imported.
  const issues: string[] = [];
  const usable = <T>(name: string, read: () => T): T[] => {
    try {
      return [read()];
    } catch (error) {
      issues.push(`${name}: ${message(error)}`);
      return [];
    }
  };
  // Each geometry's shape, or what is wrong with it, said of each part or sheet that uses it.
  const shapes = new Map<string, Shape | string>();
  for (const raw of input.geometries) {
    const geometry = record(raw);
    const id = geometry.id;
    if (typeof id !== 'string') throw Error('Every geometry needs a text ID.');
    if (shapes.has(id)) throw Error(`Geometry ${id} is there twice.`);
    try {
      shapes.set(id, shaped(record(geometry.shape), options));
    } catch (error) {
      shapes.set(id, `geometry ${id}: ${message(error)}`);
    }
  }
  const shape = (id: unknown): Shape => {
    const found = typeof id === 'string' ? shapes.get(id) : undefined;
    if (found === undefined) throw Error(`no geometry ${String(id)}.`);
    if (typeof found === 'string') throw Error(found);
    return found;
  };
  const parts = input.parts.flatMap((raw) => {
    const part = record(raw);
    const name = `Part ${String(part.id)}`;
    return usable(name, () =>
      normalizePart(
        localize({
          ...newPart(shape(part.geometry_id), name),
          quantity: number(part.quantity),
          source: { format: 'sparrow', fileName, entityId: String(part.id) },
        }),
      ),
    );
  });
  const problem = record(input.problem);
  const strip = problem.type === 'minimize_strip_length';
  if (!strip && problem.type !== 'minimize_sheets_in_order')
    throw Error(`Problem ${String(problem.type)} is unsupported.`);
  if (!strip && (!Array.isArray(problem.sheets) || !problem.sheets.length))
    throw Error('A job on sheets needs a list of sheets.');
  const sheets = strip
    ? []
    : (problem.sheets as unknown[]).flatMap((raw) => {
        const sheet = record(raw);
        const name = `Sheet ${String(sheet.id)}`;
        return usable(name, (): ImportedSheet => {
          const quantity = sheet.quantity === undefined ? 1 : sheet.quantity;
          if (!Number.isInteger(quantity) || (quantity as number) < 0)
            throw Error('its quantity must be a whole number, 0 or more.');
          const defects = sheet.defects ?? [];
          if (!Array.isArray(defects)) throw Error('its defects must be a list.');
          // Studio draws a sheet's holes as a part's: each inside it, apart from the others.
          const sheetShape = shape(sheet.geometry_id);
          const { outer, holes } = outline(sheetShape);
          const holeIssue = holeProblem(outer, holes);
          if (holeIssue) throw Error(holeIssue);
          return {
            name,
            shape: sheetShape,
            quantity: quantity as number,
            defects: defects.map((defect, i) => {
              try {
                return checked(record(defect) as Contour, options);
              } catch (error) {
                throw Error(`defect ${i + 1}: ${message(error)}`);
              }
            }),
          };
        });
      });
  const stripWidthMm = strip ? number(problem.height) : undefined;
  const document = normalizeJob(
    { name: fileName, parts, settings: { ...DEFAULT_SETTINGS, materialWidthMm: stripWidthMm ?? 1000 } },
    true,
  );
  return {
    document,
    stripWidthMm,
    sheets,
    issues,
    warnings: ["Parts follow the project's part defaults; the file's other settings are left out."],
  };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A contour, once it is known to draw as a simple ring: a polygon as that ring, its closing point
 * dropped; a curve as it is, or flattened within `tolerance`; any other as it is.
 */
function checked(contour: Contour, { curves, tolerance }: Options): Contour {
  const flatten = isCurved(contour) && curves === 'flatten';
  const ring = normalizeRing(flattenContour(contour, tolerance));
  return contour.type === 'polygon' || flatten ? polygon(ring) : contour;
}

function shaped(value: Record<string, unknown>, options: Options): Shape {
  const holes = value.holes ?? [];
  if (!Array.isArray(holes)) throw Error('its holes must be a list.');
  return {
    outer: checked(record(value.outer) as Contour, options),
    ...(holes.length && {
      holes: holes.map((hole) => checked(record(hole) as Contour, options)),
    }),
  };
}
