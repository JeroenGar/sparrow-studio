import type { Input, JobDocument, JobRequest, Schemas } from '../api/client';
import { worldParts } from '../engine/geometry/world';
import type { Job, Part, Result } from '../engine/model';
import { activeMachine, boundaryOf, resolvedParts, type ProjectDocument } from './model';

/**
 * The job input for a project, in the API's format: one geometry per part, the machine's gap and
 * distance to the material edge as the separations, and the strip as the problem. Parts
 * without copies are left out, as the format counts copies from one.
 */
export function projectInput(project: ProjectDocument): Input {
  const parts = resolvedParts(project).filter((part) => part.quantity > 0);
  const machine = activeMachine(project);
  return {
    schema_version: 1,
    geometries: parts.map((part) => ({
      id: part.id,
      shape: part.shape,
    })),
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
    problem: { type: 'minimize_strip_length', height: project.stock.strip.widthMm },
  };
}

/** Studio always sends the same seed, as the API's contract asks of it. */
export const SEED = 0;

/** The job request for a project. */
export function projectRequest(project: ProjectDocument): JobRequest {
  return {
    input: projectInput(project),
    settings: {
      time_limit_seconds: project.settings.timeLimitSeconds,
      auto_termination: project.settings.autoTermination,
      seed: SEED,
    },
  };
}

/** Whether the project changed since a solution's job, in anything that changes the layout. */
export const isStale = (project: ProjectDocument, document: JobDocument) =>
  JSON.stringify(projectInput(project)) !== JSON.stringify(document.input);

/**
 * A layout in the format, as studio's drawings and exports read it: the job's parts with their
 * names from the project where it still has them, and each placement as a copy of its part.
 */
export function drawable(
  input: Input,
  solution: Schemas['Solution'],
  names: Map<string, string> = new Map(),
  /** Where the strip is cut, when the backend said so; otherwise it is worked out. */
  cutX?: number | null,
): { job: Job; result: Result } {
  const strip = input.problem as Extract<Input['problem'], { type: 'minimize_strip_length' }>;
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
  const copies = new Map<string, number>();
  const placements = (solution.layouts[0]?.placements ?? []).map(({ part_id, transformation }) => {
    const copyIndex = copies.get(part_id) ?? 0;
    copies.set(part_id, copyIndex + 1);
    const [xMm, yMm] = transformation.translation;
    const angleDeg = transformation.rotation;
    const mirrored = transformation.reflection === 'x_axis';
    return { partId: part_id, copyIndex, xMm, yMm, angleDeg, ...(mirrored && { mirrored }) };
  });
  const job: Job = {
    name: '',
    parts,
    settings: {
      solverPreset: 'standard',
      materialWidthMm: strip.height,
      clearanceMm: input.minimum_separation_distance.parts,
      timeLimitSeconds: null,
    },
  };
  // Otherwise the strip is cut past the rightmost part by the boundary separation.
  const right = worldParts(job, { placements }).reduce(
    (max, part) => Math.max(max, ...part.outer.map(([x]) => x)),
    0,
  );
  const result: Result = {
    usedLengthMm:
      cutX ?? (placements.length ? right + input.minimum_separation_distance.boundary : 0),
    placements,
  };
  return { job, result };
}
