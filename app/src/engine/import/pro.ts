import { DEFAULT_SETTINGS, newPart } from '../model';
import { flattenContour, isCurved, polygon, type Contour, type Shape } from '../geometry/contour';
import { normalizeJob, normalizePart, normalizeRing } from '../geometry/normalize';
import type { ImportedSheet } from './drawing';
import { localize, number, record, type ImportReview } from './sparrow';

/** Whether a JSON value is a job input in sparrow Pro's format, rather than a sparrow instance. */
export const isProInput = (value: unknown) =>
  !!value && typeof value === 'object' && 'schema_version' in value && 'geometries' in value;

type Options = { curves: 'keep' | 'flatten'; tolerance: number };

/**
 * The parts and sheets of a job input in sparrow Pro's format, in millimetres. Its parts follow
 * the project's defaults, as imported parts do; how they may turn, the distances and the rest of
 * the job are left out. `curves` keeps curves as they are, or flattens them within `tolerance`.
 */
export function importPro(value: unknown, fileName: string, options: Options): ImportReview {
  const input = record(value);
  if (!Array.isArray(input.geometries) || !Array.isArray(input.parts))
    throw Error('Expected a sparrow Pro job input with geometries and parts.');
  const shapes = new Map<string, Shape>();
  for (const raw of input.geometries) {
    const geometry = record(raw);
    const id = geometry.id;
    if (typeof id !== 'string') throw Error('Every geometry needs a text ID.');
    if (shapes.has(id)) throw Error(`Geometry ${id} is there twice.`);
    shapes.set(id, named(`Geometry ${id}`, () => shaped(record(geometry.shape), options)));
  }
  const shape = (id: unknown) => {
    const found = typeof id === 'string' && shapes.get(id);
    if (!found) throw Error(`no geometry ${String(id)}.`);
    return found;
  };
  const parts = input.parts.map((raw) => {
    const part = record(raw);
    const name = `Part ${String(part.id)}`;
    return named(name, () =>
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
    : (problem.sheets as unknown[]).map((raw): ImportedSheet => {
        const sheet = record(raw);
        const name = `Sheet ${String(sheet.id)}`;
        return named(name, () => {
          const quantity = sheet.quantity ?? 1;
          if (!Number.isInteger(quantity) || (quantity as number) < 0)
            throw Error('its quantity must be a whole number, 0 or more.');
          const defects = sheet.defects ?? [];
          if (!Array.isArray(defects)) throw Error('its defects must be a list.');
          return {
            name,
            shape: shape(sheet.geometry_id),
            quantity: quantity as number,
            defects: defects.map((defect, i) =>
              named(`defect ${i + 1}`, () => checked(record(defect) as Contour, options)),
            ),
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
    warnings: ["Parts follow the project's part defaults; the file's other settings are left out."],
  };
}

/** What `read` gives, or its error, said of `name`. */
function named<T>(name: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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
