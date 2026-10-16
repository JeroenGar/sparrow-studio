import type { Input, JobDocument, JobRequest, Schemas } from '../api/client';
import { netArea, worldParts } from '../engine/geometry/world';
import type { Job, Part, Result, Ring } from '../engine/model';
import { activeMachine, resolvedParts, type ProjectDocument } from './model';

/**
 * The job input for a project, in the API's format: one geometry per part, the gap as the
 * separation between parts and from the strip's edges, and the strip as the problem. Parts
 * without copies are left out, as the format counts copies from one.
 */
export function projectInput(project: ProjectDocument): Input {
  const parts = resolvedParts(project).filter((part) => part.quantity > 0);
  const gap = activeMachine(project).gapMm;
  return {
    schema_version: 1,
    geometries: parts.map((part) => ({
      id: part.id,
      shape: {
        outer: { type: 'polygon', points: part.outer },
        ...(part.holes.length && {
          holes: part.holes.map((hole) => ({ type: 'polygon' as const, points: hole })),
        }),
      },
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
      },
      // Nesting parts inside holes needs Sparrow Pro, and studio has no setting for it yet.
      hole_mode: 'solid',
    })),
    minimum_separation_distance: { parts: gap, boundary: gap },
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

function ring(contour: Schemas['Contour']): Ring {
  switch (contour.type) {
    case 'polygon':
      return contour.points as Ring;
    case 'rectangle': {
      const { x_min: x, y_min: y, width: w, height: h } = contour;
      return [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ];
    }
    default:
      // Studio sends polygons only, until it keeps curves.
      throw Error(`Studio cannot draw ${contour.type} contours yet.`);
  }
}

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
      outer: ring(shape.outer),
      holes: (shape.holes ?? []).map(ring),
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
    return { partId: part_id, copyIndex, xMm, yMm, angleDeg: transformation.rotation };
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

/** The share of the used strip that the parts cover, in percent. */
export function utilization({ job, result }: { job: Job; result: Result }): number {
  const area = job.parts.reduce((sum, part) => sum + netArea(part) * part.quantity, 0);
  return (area / (job.settings.materialWidthMm * result.usedLengthMm)) * 100;
}
