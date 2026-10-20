import type { Input, JobDocument, JobRequest, Schemas } from '../api/client';
import { outline } from '../engine/geometry/contour';
import { bounds } from '../engine/geometry/normalize';
import { worldParts } from '../engine/geometry/world';
import type { Job, Part, Result, Sheet } from '../engine/model';
import {
  activeMachine,
  boundaryOf,
  resolvedParts,
  usedSheets,
  type ProjectDocument,
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

/** Whether the project changed since a solution's job, in anything that changes the layout. */
export const isStale = (project: ProjectDocument, document: JobDocument) =>
  JSON.stringify(projectInput(project)) !== JSON.stringify(document.input);

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
