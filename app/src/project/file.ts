import { normalizePart } from '../engine/geometry/normalize';
import { TIME_LIMITS, PROJECT_FORMAT, PROJECT_VERSION, type ProjectDocument } from './model';

const fail = (message: string): never => {
  throw Error(`Not a valid sparrow studio project: ${message}`);
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

/**
 * Check a project document from a file or from storage. Part geometry goes through the same
 * normalization as imports. Solutions are kept as they are: they carry their own job.
 */
export function parseProject(stored: unknown): ProjectDocument {
  if (!isRecord(stored)) return fail('expected an object.');
  if (stored.format !== PROJECT_FORMAT) return fail('unknown format.');
  const value = stored.version === 1 ? upgrade(stored) : stored;
  if (value.version !== PROJECT_VERSION)
    return fail(`version ${String(value.version)} is not supported.`);
  if (typeof value.name !== 'string' || !value.name.trim()) return fail('missing name.');
  if (!Array.isArray(value.parts)) return fail('parts must be a list.');
  const stock = value.stock;
  if (!isRecord(stock) || stock.packing !== 'strip' || !isRecord(stock.strip))
    return fail('invalid stock.');
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
      !finite(machine.gapMm)
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
  if (
    !Array.isArray(value.solutions) ||
    !value.solutions.every((solution) => isRecord(solution) && isRecord(solution.document))
  )
    return fail('invalid solutions.');
  const defaults = value.partDefaults;
  const rule = isRecord(defaults) ? defaults.rotations : undefined;
  const validRule =
    isRecord(rule) &&
    (rule.kind === 'continuous' ||
      (rule.kind === 'discrete' &&
        Array.isArray(rule.degrees) &&
        rule.degrees.length > 0 &&
        rule.degrees.every(finite)));
  if (!validRule) return fail('invalid part defaults.');
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
 * Version 1 had settings for the browser's solver alone, and solutions in studio's own format.
 * Its runs always stopped once the search stalled, without a time limit or within the one chosen.
 * Its solutions are dropped: running the job again gives one in the API's format.
 */
function upgrade(project: Record<string, unknown>): Record<string, unknown> {
  const settings = isRecord(project.settings) ? project.settings : {};
  const limit = settings.timeLimitSeconds;
  return {
    ...project,
    version: PROJECT_VERSION,
    settings: {
      timeLimitSeconds: TIME_LIMITS.includes(limit as number) ? limit : 600,
      autoTermination: true,
    },
    solutions: [],
  };
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
