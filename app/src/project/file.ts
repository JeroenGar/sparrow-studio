import { normalizePart } from '../engine/geometry/normalize';
import { polygonShape } from '../engine/geometry/contour';
import type { Ring } from '../engine/model';
import {
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
 * normalization as imports. Solutions are kept as they are: they carry their own job.
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
  if (
    !Array.isArray(value.solutions) ||
    !value.solutions.every((solution) => isRecord(solution) && isRecord(solution.document))
  )
    return fail('invalid solutions.');
  if (value.runningJobId !== undefined && typeof value.runningJobId !== 'string')
    return fail('invalid running job.');
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
 * Older versions, upgraded one step at a time. Version 1 had settings for the browser's solver
 * alone, and solutions in studio's own format: its runs stopped once the search stalled, without
 * a time limit or within the one chosen, and its solutions are dropped. Version 2 stored a part's
 * outline as `outer` and `holes` polygons, which become its shape. Version 3 had no reflection
 * or nesting inside holes: its parts keep solving as they did, without either.
 */
function upgrade(project: Record<string, unknown>): Record<string, unknown> {
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
  if (project.version === 3)
    return {
      ...project,
      version: 4,
      partDefaults: {
        reflection: false,
        nestInHoles: false,
        ...(isRecord(project.partDefaults) && project.partDefaults),
      },
    };
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

export const serializeProject = (project: ProjectDocument) => JSON.stringify(project, null, 2);

export function projectFileName(name: string, extension: string): string {
  const safe = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
  return `${safe || 'project'}.${extension}`;
}
