import type { JobDocument } from '../api/client';
import type { Contour, Shape } from '../engine/geometry/contour';
import { LIMITS, newId, type Part, type RotationRule } from '../engine/model';

/** Identifies a sparrow studio project document, in browser storage and in files. */
export const PROJECT_FORMAT = 'sparrow-studio-project';
export const PROJECT_VERSION = 5;

/** One strip of fixed width; the solver minimizes the length it uses. */
export type Strip = { id: string; name: string; widthMm: number };
/**
 * A row of identical sheets, used one after another: a rectangle, or an imported outline, with
 * regions parts must avoid, such as flaws. Its shape and defects are in the job format, in the
 * sheet's own coordinates; defects may overlap each other and reach past the sheet.
 */
export type SheetEntry = {
  id: string;
  name: string;
  shape: Shape;
  quantity: number;
  defects?: Contour[];
};
/**
 * What the parts are nested into: one strip, or sheets in the order of the list. A project keeps
 * both; `packing` says which a job uses.
 */
export type Stock = { packing: 'strip' | 'sheets'; strip: Strip; sheets: SheetEntry[] };

export function newSheet(name: string, widthMm: number, heightMm: number): SheetEntry {
  return {
    id: newId(),
    name,
    shape: { outer: { type: 'rectangle', x_min: 0, y_min: 0, width: widthMm, height: heightMm } },
    quantity: 1,
  };
}

/** A sheet's rectangle, when it is one; other outlines cannot be edited. */
export function rectangleOf(sheet: SheetEntry) {
  const outer = sheet.shape.outer;
  return outer.type === 'rectangle' && !sheet.shape.holes?.length ? outer : undefined;
}

/** The sheet entries a job uses: those with sheets in stock. */
export const usedSheets = (stock: Stock) => stock.sheets.filter((sheet) => sheet.quantity > 0);

/** How many sheets the project has in stock, in words. */
export function describeSheets(project: ProjectDocument): string {
  const count = copyCount(project.stock.sheets);
  return `${count} ${count === 1 ? 'sheet' : 'sheets'} in stock`;
}
/**
 * Machine-specific solver inputs: the gap between parts, and the distance from parts to the edge
 * of the material, which is the gap unless the preset has its own. Clamps come later.
 */
export type MachinePreset = { id: string; name: string; gapMm: number; boundaryMm?: number };

/** The distance from parts to the edge of the material. */
export const boundaryOf = (machine: MachinePreset) => machine.boundaryMm ?? machine.gapMm;
/** How long the solver searches, as the API's settings. */
export type SolverSettings = { timeLimitSeconds: number; autoTermination: boolean };
/** A finished job as the API records it, with its input, so it stays valid when the project changes. */
export type Solution = { id: string; createdAt: string; document: JobDocument };
/** The settings a part solves with: the project's defaults, or its own. */
export type PartSettings = {
  rotations: RotationRule;
  /** Whether copies may also be placed mirrored. */
  reflection: boolean;
  /** Whether other parts may be placed inside this part's holes. */
  nestInHoles: boolean;
};
export type PartSetting = keyof PartSettings;
export const PART_SETTINGS: PartSetting[] = ['rotations', 'reflection', 'nestInHoles'];
/** Settings every part follows unless it has its own. */
export type PartDefaults = PartSettings;
/** A part as the project stores it: a setting is present only when the part has its own. */
export type ProjectPart = Omit<Part, 'rotations'> & Partial<PartSettings>;
/** A part with every setting filled in, as the solver and the drawings use it. */
export type ResolvedPart = Part & PartSettings;
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
  /** Holds at most one solution for now; sparrow pro will return several. */
  solutions: Solution[];
  /**
   * The job running for this project, when one is. A page closed while it runs finds it here on
   * opening, follows it again, and records its solution.
   */
  runningJobId?: string;
  /**
   * The input tabs opened so far: a new project's first run waits until each was opened once.
   * Absent in projects from before this rule, which count as seen.
   */
  seenTabs?: InputTab[];
};

export const TIME_LIMITS = [10, 30, 60, 120, 300, 600];

export const DEFAULT_SOLVER_SETTINGS: SolverSettings = {
  timeLimitSeconds: 120,
  autoTermination: true,
};

/** The tabs with a job's inputs. */
export const INPUT_TABS = ['parts', 'sheets', 'machine', 'settings'] as const;
export type InputTab = (typeof INPUT_TABS)[number];
export const TAB_NAMES: Record<InputTab, string> = {
  parts: 'Parts',
  sheets: 'Sheets',
  machine: 'Machine',
  settings: 'Settings',
};

/** The input tabs still to open before a project's first run; none once it has a solution. */
export function unseenTabs(project: ProjectDocument): InputTab[] {
  if (!project.seenTabs || project.solutions.length) return [];
  return INPUT_TABS.filter((tab) => !project.seenTabs!.includes(tab));
}

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
    partDefaults: {
      rotations: { kind: 'discrete', degrees: [0, 180] },
      reflection: false,
      nestInHoles: true,
    },
    stock: {
      packing: 'strip',
      strip: { id: newId(), name: 'Material strip', widthMm: 1000 },
      sheets: [],
    },
    machines: [copy],
    machineId: copy.id,
    settings: { ...DEFAULT_SOLVER_SETTINGS },
    solutions: [],
    seenTabs: [],
  };
}

export function activeMachine(project: ProjectDocument): MachinePreset {
  return (
    project.machines.find((machine) => machine.id === project.machineId) ?? project.machines[0]
  );
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
  if (project.stock.packing === 'sheets') {
    if (!usedSheets(project.stock).length) reasons.push('Add a sheet in the Sheets tab.');
  } else if (!Number.isFinite(width) || width <= 0 || width > LIMITS.extent)
    reasons.push('Set a strip width in the Sheets tab.');
  if (!Number.isFinite(gap) || gap < 0) reasons.push('Set a valid gap in the Machine tab.');
  const boundary = boundaryOf(activeMachine(project));
  if (!Number.isFinite(boundary) || boundary < 0)
    reasons.push('Set a valid distance to the material edge in the Machine tab.');
  return reasons;
}

/** Compares rotation rules by the angles they allow. */
export function ruleKey(rule: RotationRule): string {
  if (rule.kind === 'continuous') return 'free';
  const turn = (degrees: number) => ((degrees % 360) + 360) % 360;
  return [...new Set(rule.degrees.map(turn))].sort((a, b) => a - b).join(',');
}

/** Whether two values of a setting allow the same: rotation rules by their angles. */
const sameSetting = <K extends PartSetting>(key: K, a: PartSettings[K], b: PartSettings[K]) =>
  key === 'rotations' ? ruleKey(a as RotationRule) === ruleKey(b as RotationRule) : a === b;

export const differsFromDefaults = (part: ProjectPart) =>
  PART_SETTINGS.some((key) => part[key] !== undefined);

/** The parts with every setting filled in, as the solver and the drawings use them. */
export const resolvedParts = (project: ProjectDocument): ResolvedPart[] =>
  project.parts.map((part) => ({ ...project.partDefaults, ...withoutUndefined(part) }));

const withoutUndefined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

export const setPartDefault = <K extends PartSetting>(
  project: ProjectDocument,
  key: K,
  value: PartSettings[K],
): ProjectDocument => ({ ...project, partDefaults: { ...project.partDefaults, [key]: value } });

/** Give parts their own value of a setting, or `'default'` to follow the defaults again. */
export function setPartSetting<K extends PartSetting>(
  project: ProjectDocument,
  ids: string[],
  key: K,
  value: PartSettings[K] | 'default',
): ProjectDocument {
  const chosen = new Set(ids);
  return {
    ...project,
    parts: project.parts.map((part) => {
      if (!chosen.has(part.id)) return part;
      const changed: ProjectPart = { ...part, [key]: value };
      if (value === 'default') delete changed[key];
      return changed;
    }),
  };
}

/** Make parts follow the defaults in every setting. */
export function followDefaults(project: ProjectDocument, ids: string[]): ProjectDocument {
  return PART_SETTINGS.reduce(
    (current, key) => setPartSetting(current, ids, key, 'default'),
    project,
  );
}

/** Add parts. A setting that matches the defaults follows them; any other is the part's own. */
export function addParts(
  project: ProjectDocument,
  parts: (Part & Partial<PartSettings>)[],
): ProjectDocument {
  const added = parts.map((part): ProjectPart => {
    const own = { ...part } as ProjectPart;
    for (const key of PART_SETTINGS) {
      const value = part[key];
      if (value === undefined || sameSetting(key, value, project.partDefaults[key]))
        delete own[key];
    }
    return own;
  });
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
