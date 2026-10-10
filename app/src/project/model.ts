import {
  LIMITS,
  newId,
  type Job,
  type Part,
  type Preset,
  type Result,
  type RotationRule,
  type TimeLimit,
} from '../engine/model';

/** Identifies a sparrow studio project document, in browser storage and in files. */
export const PROJECT_FORMAT = 'sparrow-studio-project';
export const PROJECT_VERSION = 1;

/** One strip of fixed width; the solver minimizes the length it uses. */
export type Strip = { id: string; name: string; widthMm: number };
/** What the parts are nested into. Sheets (bin packing) arrive with sparrow cloud. */
export type Stock = { packing: 'strip'; strip: Strip };
/** Machine-specific solver inputs. Clamps and a separate sheet boundary distance come later. */
export type MachinePreset = { id: string; name: string; gapMm: number };
/** Local solving only, for now. */
export type SolveWith = 'local';
/** 0 lets the solver choose. */
export type Threads = 0 | 1 | 2 | 3;
export type SolverSettings = {
  solveWith: SolveWith;
  timeLimitSeconds: TimeLimit;
  preset: Preset;
  threads: Threads;
};
/** A solver result with the exact job it solved, so it stays valid when inputs change later. */
export type Solution = {
  id: string;
  createdAt: string;
  job: Job;
  result: Result;
  stopReason: 'Complete' | 'Stopped';
};
/** Settings every part follows unless it has its own. Reflection and nesting in holes join later. */
export type PartDefaults = { rotations: RotationRule };
/** A part as the project stores it: a setting is present only when the part has its own. */
export type ProjectPart = Omit<Part, 'rotations'> & { rotations?: RotationRule };
export type ProjectDocument = {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  name: string;
  parts: ProjectPart[];
  partDefaults: PartDefaults;
  stock: Stock;
  machines: MachinePreset[];
  machineId: string;
  settings: SolverSettings;
  /** Holds at most one solution for now; sparrow cloud will return several. */
  solutions: Solution[];
};

export const TIME_LIMITS: TimeLimit[] = [null, 10, 30, 60, 120, 300, 600];

export const DEFAULT_SOLVER_SETTINGS: SolverSettings = {
  solveWith: 'local',
  timeLimitSeconds: null,
  preset: 'standard',
  threads: 0,
};

export function newMachine(name = 'Default', gapMm = 0): MachinePreset {
  return { id: newId(), name, gapMm };
}

export function newProject(name: string, machine: MachinePreset = newMachine()): ProjectDocument {
  const copy = { ...machine, id: newId() };
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name,
    parts: [],
    partDefaults: { rotations: { kind: 'discrete', degrees: [0, 180] } },
    stock: { packing: 'strip', strip: { id: newId(), name: 'Material strip', widthMm: 1000 } },
    machines: [copy],
    machineId: copy.id,
    settings: { ...DEFAULT_SOLVER_SETTINGS },
    solutions: [],
  };
}

export function activeMachine(project: ProjectDocument): MachinePreset {
  return (
    project.machines.find((machine) => machine.id === project.machineId) ?? project.machines[0]
  );
}

/** The solver input for the current project, without validating its geometry. */
export function projectJob(project: ProjectDocument): Job {
  return {
    name: project.name,
    parts: resolvedParts(project),
    settings: {
      solverPreset: project.settings.preset,
      materialWidthMm: project.stock.strip.widthMm,
      clearanceMm: activeMachine(project).gapMm,
      timeLimitSeconds: project.settings.timeLimitSeconds,
    },
  };
}

/** Compares jobs by the inputs that change a layout; names and file sources do not. */
export function jobKey(job: Job): string {
  return JSON.stringify({
    parts: job.parts
      .filter((part) => part.quantity > 0)
      .map(({ id, outer, holes, quantity, rotations }) => [
        id,
        outer,
        holes,
        quantity,
        ruleKey(rotations),
      ]),
    width: job.settings.materialWidthMm,
    gap: job.settings.clearanceMm,
  });
}

export const copyCount = (parts: { quantity: number }[]) =>
  parts.reduce((sum, part) => sum + part.quantity, 0);

/** Why a job cannot start yet. An empty list means it can. Which conditions belong here is still open. */
export function startBlockers(project: ProjectDocument): string[] {
  const reasons: string[] = [];
  const width = project.stock.strip.widthMm;
  const gap = activeMachine(project).gapMm;
  const copies = copyCount(project.parts);
  if (!project.parts.length) reasons.push('Import parts to nest.');
  else if (copies === 0) reasons.push('Give at least one part a quantity above zero.');
  if (copies > LIMITS.copies)
    reasons.push(`Reduce the quantities to ${LIMITS.copies} copies or fewer.`);
  if (!Number.isFinite(width) || width <= 0 || width > LIMITS.extent)
    reasons.push('Set a strip width in the Sheets tab.');
  if (!Number.isFinite(gap) || gap < 0) reasons.push('Set a valid gap in the Machine tab.');
  else if (Number.isFinite(width) && gap >= width)
    reasons.push('The gap must be smaller than the strip width.');
  return reasons;
}

/** Utilization of a solution's strip: net part area over the used rectangle. */
export function utilization(job: Job, result: Result, netArea: (part: Part) => number): number {
  const area = job.parts.reduce((sum, part) => sum + netArea(part) * part.quantity, 0);
  return (area / (job.settings.materialWidthMm * result.usedLengthMm)) * 100;
}

/** Compares rotation rules by the angles they allow. */
export function ruleKey(rule: RotationRule): string {
  if (rule.kind === 'continuous') return 'free';
  const turn = (degrees: number) => ((degrees % 360) + 360) % 360;
  return [...new Set(rule.degrees.map(turn))].sort((a, b) => a - b).join(',');
}

export const differsFromDefaults = (part: ProjectPart) => part.rotations !== undefined;

/** The rule a part solves with: its own, or the defaults. */
export const effectiveRotations = (project: ProjectDocument, part: ProjectPart): RotationRule =>
  part.rotations ?? project.partDefaults.rotations;

/** The parts with every setting filled in, as the solver and the drawings use them. */
export const resolvedParts = (project: ProjectDocument): Part[] =>
  project.parts.map((part) => ({ ...part, rotations: effectiveRotations(project, part) }));

export const setDefaultRotations = (
  project: ProjectDocument,
  rotations: RotationRule,
): ProjectDocument => ({ ...project, partDefaults: { ...project.partDefaults, rotations } });

/** Give parts their own rotations, or `'default'` to follow the defaults again. */
export function setPartRotations(
  project: ProjectDocument,
  ids: string[],
  rotations: RotationRule | 'default',
): ProjectDocument {
  const chosen = new Set(ids);
  return {
    ...project,
    parts: project.parts.map((part) => {
      if (!chosen.has(part.id)) return part;
      const { rotations: _, ...rest } = part;
      return rotations === 'default' ? rest : { ...rest, rotations };
    }),
  };
}

/** Add parts. A part whose rule matches the defaults follows them; any other keeps its own. */
export function addParts(project: ProjectDocument, parts: Part[]): ProjectDocument {
  const defaultKey = ruleKey(project.partDefaults.rotations);
  const added = parts.map(
    ({ rotations, ...rest }): ProjectPart =>
      ruleKey(rotations) === defaultKey ? rest : { ...rest, rotations },
  );
  return { ...project, parts: [...project.parts, ...added] };
}

/** The rule most parts use, for the defaults of a project made from an existing set of parts. */
export function commonRotations(parts: Part[], fallback: RotationRule): RotationRule {
  const counts = new Map<string, { rule: RotationRule; count: number }>();
  for (const part of parts) {
    const key = ruleKey(part.rotations);
    const entry = counts.get(key) ?? { rule: part.rotations, count: 0 };
    counts.set(key, { ...entry, count: entry.count + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.rule ?? fallback;
}
