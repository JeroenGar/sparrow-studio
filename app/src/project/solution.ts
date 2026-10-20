import type { Input, JobRequest, Schemas } from '../api/client';
import { moveShape, outline } from '../engine/geometry/contour';
import { bounds } from '../engine/geometry/normalize';
import { worldParts } from '../engine/geometry/world';
import {
  newId,
  type Job,
  type Part,
  type Result,
  type RotationRule,
  type Sheet,
} from '../engine/model';
import {
  activeMachine,
  boundaryOf,
  commonRotations,
  jobInput,
  resolvedParts,
  ruleKey,
  TIME_LIMITS,
  usedSheets,
  type PartSettings,
  type ProjectDocument,
  type ProjectJob,
  type ProjectPart,
} from './model';

/**
 * The job input for a project, in the API's format: one geometry per part and per sheet entry,
 * the machine's gap and distance to the material edge as the separations, and the strip or the
 * sheets as the problem. Parts and sheet entries without copies are left out, as the format counts
 * them from one.
 */
export function projectInput(project: ProjectDocument): Input {
  const parts = resolvedParts(project).filter((part) => part.quantity > 0);
  const sheets = project.stock.packing === 'sheets' ? usedSheets(project.stock) : [];
  const machine = activeMachine(project);
  return {
    schema_version: 1,
    geometries: [...parts, ...sheets].map(({ id, shape }) => ({ id, shape })),
    parts: parts.map((part) => ({
      id: part.id,
      geometry_id: part.id,
      quantity: part.quantity,
      orientation: {
        rotation:
          part.rotations.kind === 'continuous'
            ? { type: 'continuous' }
            : { type: 'discrete', angles: part.rotations.degrees },
        // Left out without reflection, as the format's default, so earlier solutions stay current.
        ...(part.reflection && { reflection: ['none', 'x_axis'] }),
      },
      hole_mode: part.nestInHoles ? 'nestable' : 'solid',
    })),
    minimum_separation_distance: { parts: machine.gapMm, boundary: boundaryOf(machine) },
    problem:
      project.stock.packing === 'sheets'
        ? {
            type: 'minimize_sheets_in_order',
            sheets: sheets.map(({ id, quantity, defects }) => ({
              id,
              geometry_id: id,
              quantity,
              ...(defects?.length && { defects }),
            })),
          }
        : { type: 'minimize_strip_length', height: project.stock.strip.widthMm },
  };
}

/**
 * The job request for a project. It sends no seed, so the backend picks a new one for every job.
 *
 * TODO before launch: send a fixed seed again, as the API's contract asks of clients, so the same
 * project gives the same job. Random seeds are only for trying studio while it is developed.
 */
export function projectRequest(project: ProjectDocument): JobRequest {
  return {
    input: projectInput(project),
    settings: {
      time_limit_seconds: project.settings.timeLimitSeconds,
      auto_termination: project.settings.autoTermination,
    },
  };
}

/**
 * A new project with a job's inputs: its parts, material, distances and time, named as they were
 * when it started. The settings most parts share become the part defaults. What the job's format
 * does not hold, such as the other machine presets, comes from `project`, the job's own.
 */
export function projectFromJob(project: ProjectDocument, job: ProjectJob): ProjectDocument {
  const input = jobInput(job);
  const settings = job.stage === 'ended' ? job.document.settings : job.request.settings;
  const shapes = new Map(input.geometries.map((geometry) => [geometry.id, geometry.shape]));
  const name = (id: string, fallback: string) => job.names[id] ?? fallback;
  const parts = input.parts.map((part, index) => {
    const rotation = part.orientation.rotation;
    const rotations: RotationRule =
      rotation.type === 'continuous'
        ? { kind: 'continuous' }
        : { kind: 'discrete', degrees: rotation.angles };
    return {
      part: {
        id: part.id,
        name: name(part.id, `Part ${index + 1}`),
        source: { format: 'sparrow' as const },
        shape: shapes.get(part.geometry_id)!,
        approximationToleranceMm: 0,
        quantity: part.quantity,
      },
      settings: {
        rotations,
        reflection: !!part.orientation.reflection?.includes('x_axis'),
        nestInHoles: part.hole_mode === 'nestable',
      } satisfies PartSettings,
    };
  });
  const most = (flag: 'reflection' | 'nestInHoles') =>
    parts.filter((part) => part.settings[flag]).length * 2 > parts.length;
  const partDefaults: PartSettings = {
    rotations: commonRotations(
      parts.map(({ part, settings }) => ({ ...part, rotations: settings.rotations })),
      project.partDefaults.rotations,
    ),
    reflection: most('reflection'),
    nestInHoles: most('nestInHoles'),
  };
  // A part keeps a setting of its own only where it differs from the defaults.
  const own = (settings: PartSettings): Partial<PartSettings> => ({
    ...(ruleKey(settings.rotations) !== ruleKey(partDefaults.rotations) && {
      rotations: settings.rotations,
    }),
    ...(settings.reflection !== partDefaults.reflection && { reflection: settings.reflection }),
    ...(settings.nestInHoles !== partDefaults.nestInHoles && {
      nestInHoles: settings.nestInHoles,
    }),
  });
  const problem = input.problem;
  const separation = input.minimum_separation_distance;
  const machine = {
    id: newId(),
    name: `Job #${job.number}`,
    gapMm: separation.parts,
    ...(separation.boundary !== separation.parts && { boundaryMm: separation.boundary }),
  };
  // A time limit studio does not offer becomes the nearest one it does.
  const limit = TIME_LIMITS.reduce((best, seconds) =>
    Math.abs(seconds - settings.time_limit_seconds) < Math.abs(best - settings.time_limit_seconds)
      ? seconds
      : best,
  );
  return {
    ...project,
    name: `${project.name} (from #${job.number})`,
    parts: parts.map(({ part, settings }): ProjectPart => ({ ...part, ...own(settings) })),
    partDefaults,
    stock:
      problem.type === 'minimize_strip_length'
        ? {
            packing: 'strip',
            strip: { ...project.stock.strip, widthMm: problem.height },
            sheets: [],
          }
        : {
            packing: 'sheets',
            strip: project.stock.strip,
            sheets: problem.sheets.map((sheet, index) => ({
              id: sheet.id,
              name: name(sheet.id, `Sheet ${index + 1}`),
              shape: shapes.get(sheet.geometry_id)!,
              quantity: sheet.quantity ?? 1,
              ...(sheet.defects?.length && { defects: sheet.defects }),
            })),
          },
    machines: [machine, ...project.machines],
    machineId: machine.id,
    settings: { timeLimitSeconds: limit, autoTermination: !!settings.auto_termination },
    jobs: [],
    seenTabs: undefined,
  };
}

/** Whether the project changed since a job of it, in anything its input holds. */
export const isStale = (project: ProjectDocument, input: Input) =>
  JSON.stringify(projectInput(project)) !== JSON.stringify(input);

/** One layout as studio draws and exports it: its placements, and the sheet it lies on, if not the strip. */
export type DrawnLayout = {
  sheetId: string;
  /** The sheet entry's name, or the strip's. */
  name: string;
  sheet?: Sheet;
  result: Result;
  /** The backend's statistics of the layout, when it sent them. */
  stats?: Schemas['LayoutStats'];
};

/**
 * A solution in the format, as studio's drawings and exports read it: the job's parts with their
 * names from the project where it still has them, and each layout's placements as copies of its
 * parts, numbered across layouts. `names` holds the project's names of parts and sheet entries.
 */
export function drawable(
  input: Input,
  solution: Schemas['Solution'],
  names: Map<string, string> = new Map(),
  /** The backend's statistics, with where each layout is cut; otherwise the strip's cut is worked out. */
  stats?: Schemas['Stats'],
): { job: Job; layouts: DrawnLayout[] } {
  const problem = input.problem;
  const geometries = new Map(input.geometries.map((geometry) => [geometry.id, geometry.shape]));
  const parts: Part[] = input.parts.map((part, index) => {
    const shape = geometries.get(part.geometry_id)!;
    return {
      id: part.id,
      name: names.get(part.id) ?? `Part ${index + 1}`,
      source: { format: 'sparrow' },
      shape,
      approximationToleranceMm: 0,
      quantity: part.quantity,
      rotations:
        part.orientation.rotation.type === 'continuous'
          ? { kind: 'continuous' }
          : { kind: 'discrete', degrees: part.orientation.rotation.angles },
    };
  });
  const job: Job = {
    name: '',
    parts,
    settings: {
      solverPreset: 'standard',
      materialWidthMm: problem.type === 'minimize_strip_length' ? problem.height : 0,
      clearanceMm: input.minimum_separation_distance.parts,
      timeLimitSeconds: null,
    },
  };
  const copies = new Map<string, number>();
  const layouts = solution.layouts.map((layout, index): DrawnLayout => {
    const placements = layout.placements.map(({ part_id, transformation }) => {
      const copyIndex = copies.get(part_id) ?? 0;
      copies.set(part_id, copyIndex + 1);
      const [xMm, yMm] = transformation.translation;
      const angleDeg = transformation.rotation;
      const mirrored = transformation.reflection === 'x_axis';
      return { partId: part_id, copyIndex, xMm, yMm, angleDeg, ...(mirrored && { mirrored }) };
    });
    const layoutStats = stats?.layouts[index];
    const cutX = layoutStats?.cut_x ?? null;
    if (problem.type === 'minimize_strip_length') {
      // Without statistics, the strip is cut past the rightmost part by the boundary separation.
      const right = worldParts(job, { placements }).reduce(
        (max, part) => Math.max(max, ...part.outer.map(([x]) => x)),
        0,
      );
      const usedLengthMm =
        cutX ?? (placements.length ? right + input.minimum_separation_distance.boundary : 0);
      return {
        sheetId: layout.sheet_id,
        name: 'Strip',
        result: { usedLengthMm, placements },
        stats: layoutStats,
      };
    }
    const entry = problem.sheets.find((sheet) => sheet.id === layout.sheet_id)!;
    const shape = geometries.get(entry.geometry_id)!;
    const sheet: Sheet = { shape, defects: entry.defects ?? [], cutX };
    return {
      sheetId: layout.sheet_id,
      name: names.get(layout.sheet_id) ?? layout.sheet_id,
      sheet,
      result: { usedLengthMm: cutX ?? bounds(outline(shape).outer)[2], placements },
      stats: layoutStats,
    };
  });
  return { job, layouts };
}

/**
 * Every layout of a solution in one drawing, for downloads: the sheets side by side in nesting
 * order, a gap apart, with their parts, defects and cuts moved with them; or else the strip.
 */
export function sideBySide(layouts: DrawnLayout[]): { result: Result; sheets?: Sheet[] } {
  if (!layouts.some((layout) => layout.sheet))
    return { result: layouts[0]?.result ?? { usedLengthMm: 0, placements: [] } };
  const boxes = layouts.map((layout) => bounds(outline(layout.sheet!.shape).outer));
  const gap = Math.max(...boxes.map((box) => box[3] - box[1])) * 0.1;
  let x = 0;
  const placements: Result['placements'] = [];
  const sheets = layouts.map((layout, i): Sheet => {
    const dx = x - boxes[i][0];
    x += boxes[i][2] - boxes[i][0] + gap;
    const sheet = layout.sheet!;
    placements.push(...layout.result.placements.map((p) => ({ ...p, xMm: p.xMm + dx })));
    return {
      shape: moveShape(sheet.shape, [dx, 0]),
      defects: sheet.defects.map((defect) => moveShape({ outer: defect }, [dx, 0]).outer),
      cutX: sheet.cutX === null ? null : sheet.cutX + dx,
    };
  });
  return { result: { usedLengthMm: x - gap, placements }, sheets };
}
