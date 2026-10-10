import {
  LIMITS,
  newId,
  type Job,
  type Part,
  type Preset,
  type Result,
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
export type ProjectDocument = {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  name: string;
  parts: Part[];
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
    parts: project.parts,
    settings: {
      solverPreset: project.settings.preset,
      materialWidthMm: project.stock.strip.widthMm,
      clearanceMm: activeMachine(project).gapMm,
      timeLimitSeconds: project.settings.timeLimitSeconds,
    },
  };
}

/** Compares jobs by the inputs that change a solution; the project name does not. */
export function jobKey(job: Job): string {
  return JSON.stringify({
    parts: job.parts.filter((part) => part.quantity > 0),
    settings: { width: job.settings.materialWidthMm, gap: job.settings.clearanceMm },
  });
}

export const copyCount = (parts: Part[]) => parts.reduce((sum, part) => sum + part.quantity, 0);

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
