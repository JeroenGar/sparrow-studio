import { isSimpleRing, normalizePart } from '../engine/geometry/normalize';
import { outline, polygonShape } from '../engine/geometry/contour';
import type { Ring } from '../engine/model';
import type { JobDocument } from '../api/client';
import {
  hasEnded,
  INPUT_TABS,
  TIME_LIMITS,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type InputTab,
  type ProjectDocument,
} from './model';

/** A document that is not a sparrow studio project studio can read. */
export class InvalidProject extends Error {}

const fail = (message: string): never => {
  throw new InvalidProject(`Not a valid sparrow studio project: ${message}`);
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

/**
 * Check a project document from a file or from storage. Part geometry goes through the same
 * normalization as imports. Jobs are kept as they are: they carry their own input.
 */
export function parseProject(stored: unknown): ProjectDocument {
  if (!isRecord(stored)) return fail('expected an object.');
  if (stored.format !== PROJECT_FORMAT) return fail('unknown format.');
  const value = upgrade(stored);
  if (value.version !== PROJECT_VERSION)
    return fail(`version ${String(value.version)} is not supported.`);
  if (typeof value.name !== 'string' || !value.name.trim()) return fail('missing name.');
  if (!Array.isArray(value.parts)) return fail('parts must be a list.');
  const stock = value.stock;
  if (
    !isRecord(stock) ||
    (stock.packing !== 'strip' && stock.packing !== 'sheets') ||
    !isRecord(stock.strip) ||
    !Array.isArray(stock.sheets)
  )
    return fail('invalid stock.');
  for (const sheet of stock.sheets)
    if (
      !isRecord(sheet) ||
      typeof sheet.id !== 'string' ||
      typeof sheet.name !== 'string' ||
      !Number.isInteger(sheet.quantity) ||
      (sheet.quantity as number) < 0 ||
      !drawable(sheet.shape) ||
      (sheet.defects !== undefined &&
        !(
          Array.isArray(sheet.defects) &&
          sheet.defects.every(
            (defect) =>
              isRecord(defect) &&
              drawable({ outer: defect }) &&
              (defect.type !== 'polygon' || isSimpleRing(defect.points as Ring)),
          )
        ))
    )
      return fail('invalid sheet.');
  const strip = stock.strip;
  if (typeof strip.id !== 'string' || typeof strip.name !== 'string' || !finite(strip.widthMm))
    return fail('invalid strip.');
  if (!Array.isArray(value.machines) || !value.machines.length)
    return fail('needs a machine preset.');
  for (const machine of value.machines)
    if (
      !isRecord(machine) ||
      typeof machine.id !== 'string' ||
      typeof machine.name !== 'string' ||
      !finite(machine.gapMm) ||
      (machine.boundaryMm !== undefined && !finite(machine.boundaryMm))
    )
      return fail('invalid machine preset.');
  if (typeof value.machineId !== 'string') return fail('missing active machine.');
  const settings = value.settings;
  if (
    !isRecord(settings) ||
    !TIME_LIMITS.includes(settings.timeLimitSeconds as number) ||
    typeof settings.autoTermination !== 'boolean'
  )
    return fail('invalid solver settings.');
  if (!Array.isArray(value.jobs) || !value.jobs.every(validJob)) return fail('invalid jobs.');
  const numbers = value.jobs.map((job) => job.number);
  if (new Set(numbers).size !== numbers.length) return fail('two jobs have the same number.');
  if (
    value.seenTabs !== undefined &&
    (!Array.isArray(value.seenTabs) ||
      !value.seenTabs.every((tab) => INPUT_TABS.includes(tab as InputTab)))
  )
    return fail('invalid seen tabs.');
  const defaults = value.partDefaults;
  const rule = isRecord(defaults) ? defaults.rotations : undefined;
  const validRule =
    isRecord(rule) &&
    (rule.kind === 'continuous' ||
      (rule.kind === 'discrete' &&
        Array.isArray(rule.degrees) &&
        rule.degrees.length > 0 &&
        rule.degrees.every(finite)));
  const flags = ['reflection', 'nestInHoles'] as const;
  if (
    !validRule ||
    !flags.every((flag) => typeof (defaults as Record<string, unknown>)[flag] === 'boolean')
  )
    return fail('invalid part defaults.');
  for (const part of value.parts)
    if (
      !isRecord(part) ||
      flags.some((flag) => !['boolean', 'undefined'].includes(typeof part[flag]))
    )
      return fail('invalid part settings.');
  const project = value as unknown as ProjectDocument;
  // Check each part with the rule it solves with, then keep only what it stores itself.
  const parts = project.parts.map((part) => {
    const { rotations, ...checked } = normalizePart({
      ...part,
      rotations: part.rotations ?? project.partDefaults.rotations,
    });
    return part.rotations ? { ...checked, rotations } : checked;
  });
  return { ...project, parts };
}

/**
 * Whether a stored job has the fields of its stage, and the input and outcome as far as studio
 * draws them; the backend checked the rest when it ran the job.
 */
function validJob(job: unknown): boolean {
  if (
    !isRecord(job) ||
    !Number.isInteger(job.number) ||
    (job.number as number) < 1 ||
    typeof job.submittedAt !== 'string' ||
    !isRecord(job.names) ||
    !Object.values(job.names).every((name) => typeof name === 'string')
  )
    return false;
  switch (job.stage) {
    case 'running':
    case 'lost':
      return (
        typeof job.id === 'string' &&
        isRecord(job.request) &&
        validInput(job.request.input) &&
        isRecord(job.request.settings)
      );
    case 'ended': {
      const document = job.document;
      return (
        (job.id === undefined || typeof job.id === 'string') &&
        isRecord(document) &&
        validInput(document.input) &&
        isRecord(document.settings) &&
        isRecord(document.state) &&
        hasEnded(document as unknown as JobDocument) &&
        (document.outcome === undefined || validOutcome(document.outcome, document.input))
      );
    }
    default:
      return false;
  }
}
const listOf = (value: unknown, valid: (item: Record<string, unknown>) => boolean) =>
  Array.isArray(value) && value.every((item) => isRecord(item) && valid(item));

/** Whether a job's input has what studio reads of it, each part and sheet with its geometry. */
function validInput(input: unknown): boolean {
  if (!isRecord(input) || !listOf(input.geometries, (g) => typeof g.id === 'string')) return false;
  const geometries = new Set((input.geometries as { id: string }[]).map((g) => g.id));
  const separation = input.minimum_separation_distance;
  const problem = input.problem;
  const parts = (part: Record<string, unknown>) =>
    typeof part.id === 'string' &&
    geometries.has(part.geometry_id as string) &&
    Number.isInteger(part.quantity) &&
    isRecord(part.orientation) &&
    isRecord(part.orientation.rotation);
  return (
    (input.geometries as Record<string, unknown>[]).every((g) => drawable(g.shape)) &&
    listOf(input.parts, parts) &&
    isRecord(separation) &&
    finite(separation.parts) &&
    finite(separation.boundary) &&
    isRecord(problem) &&
    (problem.type === 'minimize_strip_length'
      ? finite(problem.height)
      : problem.type === 'minimize_sheets_in_order' &&
        listOf(
          problem.sheets,
          (sheet) => typeof sheet.id === 'string' && geometries.has(sheet.geometry_id as string),
        ))
  );
}

/** Whether a completed job's outcome has what studio draws and reports of it, of its input's parts and sheets. */
function validOutcome(outcome: unknown, input: unknown): boolean {
  const { parts, problem } = input as {
    parts: { id: string }[];
    problem: { type: string; sheets?: { id: string }[] };
  };
  const partIds = new Set(parts.map((part) => part.id));
  const sheetIds = new Set(problem.sheets?.map((sheet) => sheet.id));
  const onSheet = (id: unknown) =>
    typeof id === 'string' && (problem.type === 'minimize_strip_length' || sheetIds.has(id));
  const placement = (p: Record<string, unknown>) =>
    partIds.has(p.part_id as string) &&
    isRecord(p.transformation) &&
    finite(p.transformation.rotation) &&
    Array.isArray(p.transformation.translation) &&
    p.transformation.translation.length === 2 &&
    p.transformation.translation.every(finite);
  const stats = isRecord(outcome) ? outcome.stats : undefined;
  return (
    isRecord(outcome) &&
    isRecord(outcome.solution) &&
    listOf(
      outcome.solution.layouts,
      (layout) => onSheet(layout.sheet_id) && listOf(layout.placements, placement),
    ) &&
    isRecord(stats) &&
    ['consumed_area', 'placed_area', 'density'].every((key) => finite(stats[key])) &&
    Array.isArray(stats.layouts) &&
    listOf(
      outcome.unplaced,
      (u) => typeof u.part_id === 'string' && Number.isInteger(u.quantity),
    ) &&
    listOf(outcome.diagnostics, (d) => typeof d.kind === 'string')
  );
}

/**
 * Older versions, upgraded one step at a time. Version 1 had settings for the browser's solver
 * alone, and solutions in studio's own format: its runs stopped once the search stalled, without
 * a time limit or within the one chosen, and its solutions are dropped. Version 2 stored a part's
 * outline as `outer` and `holes` polygons, which become its shape. Version 3 had no reflection
 * or nesting inside holes: its parts keep solving as they did, without either. Version 4 had no
 * sheets. Version 5 kept the latest solution alone, which becomes job #1, and the ID of a job
 * running, which is let go: studio did not keep what it asked.
 */
function upgrade(project: Record<string, unknown>): Record<string, unknown> {
  if (project.version === 5) {
    const { solutions, runningJobId: _, ...rest } = project;
    const solution = Array.isArray(solutions) ? solutions[0] : undefined;
    return {
      ...rest,
      version: 6,
      jobs:
        isRecord(solution) && isRecord(solution.document)
          ? [
              {
                number: 1,
                submittedAt: solution.createdAt,
                names: namesOf(rest),
                stage: 'ended',
                document: solution.document,
              },
            ]
          : [],
    };
  }
  if (project.version === 1) {
    const settings = isRecord(project.settings) ? project.settings : {};
    const limit = settings.timeLimitSeconds;
    return upgrade({
      ...project,
      version: 2,
      settings: {
        timeLimitSeconds: TIME_LIMITS.includes(limit as number) ? limit : 600,
        autoTermination: true,
      },
      solutions: [],
    });
  }
  if (project.version === 4)
    return upgrade({
      ...project,
      version: 5,
      stock: { ...(isRecord(project.stock) && project.stock), sheets: [] },
    });
  if (project.version === 3)
    return upgrade({
      ...project,
      version: 4,
      partDefaults: {
        reflection: false,
        nestInHoles: false,
        ...(isRecord(project.partDefaults) && project.partDefaults),
      },
    });
  if (project.version === 2 && Array.isArray(project.parts))
    return upgrade({
      ...project,
      version: 3,
      parts: project.parts.map((part: Record<string, unknown>) => {
        const { outer, holes, ...rest } = part;
        return { ...rest, shape: polygonShape(outer as Ring, (holes as Ring[]) ?? []) };
      }),
    });
  return project;
}

/** The names of a stored project's parts and sheets, by ID, as far as it has them. */
function namesOf(project: Record<string, unknown>): Record<string, string> {
  const items = [
    ...(Array.isArray(project.parts) ? project.parts : []),
    ...(isRecord(project.stock) && Array.isArray(project.stock.sheets) ? project.stock.sheets : []),
  ];
  return Object.fromEntries(
    items.flatMap((item) =>
      isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string'
        ? [[item.id, item.name]]
        : [],
    ),
  );
}

/** Whether a stored shape can be drawn, as far as studio can tell; the backend checks the rest. */
function drawable(shape: unknown): boolean {
  try {
    const { outer, holes } = outline(shape as Parameters<typeof outline>[0]);
    return [outer, ...holes].every(
      (ring) =>
        Array.isArray(ring) &&
        ring.length >= 3 &&
        ring.every((point) => Array.isArray(point) && point.length === 2 && point.every(finite)),
    );
  } catch {
    return false;
  }
}

export const serializeProject = (project: ProjectDocument) => JSON.stringify(project, null, 2);

export function projectFileName(name: string, extension: string): string {
  const safe = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
  return `${safe || 'project'}.${extension}`;
}
