import { describe, expect, it } from 'vitest';
import { polygonShape } from '../src/engine/geometry/contour';
import { newPart, type Part } from '../src/engine/model';
import { addJob, addParts, endJob, newProject, type ProjectDocument } from '../src/project/model';
import { projectRequest } from '../src/project/solution';
import { readSummary, summarize, SUMMARY_BYTES, type JobListing } from '../src/project/summary';
import { MATERIAL, packThumb, unpackThumb } from '../src/project/thumb';

/** A part with a round outline of `points` points, `size` across. */
const round = (size: number, points: number, quantity = 1): Part => ({
  ...newPart(
    polygonShape(
      Array.from({ length: points }, (_, i) => {
        const angle = (2 * Math.PI * i) / points;
        return [(size / 2) * Math.cos(angle), (size / 2) * Math.sin(angle)];
      }),
    ),
  ),
  quantity,
});

/** A project with a completed job for each `copies`, every copy placed in a row on the strip. */
function withJobs(project: ProjectDocument, jobs: number): ProjectDocument {
  for (let n = 1; n <= jobs; n++) {
    const request = projectRequest(project);
    project = addJob(project, `job_${n}`, request, {});
    const placements = request.input.parts.flatMap((part) =>
      Array.from({ length: part.quantity }, (_, i) => ({
        part_id: part.id,
        transformation: { rotation: 0, translation: [i * 30, 0], reflection: 'none' as const },
      })),
    );
    const layout = { cut_x: 3000, consumed_area: 1, placed_area: 0.8, density: 0.8 };
    project = endJob(project, `job_${n}`, {
      schema_version: 1,
      input: request.input,
      settings: request.settings as never,
      state: { status: 'completed', termination: 'time_limit', solver_seconds: 60 } as never,
      outcome: {
        solution: { layouts: [{ sheet_id: 'strip', placements }] },
        stats: { ...layout, layouts: [layout] },
        unplaced: [],
        diagnostics: [],
        replay: { exploration_attempts: 1, compression_attempts: 0 },
      },
    });
  }
  return project;
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

describe('project summaries', () => {
  it('say what Home shows, and read back', () => {
    const project = withJobs(addParts(newProject('Job'), [round(100, 40, 3), round(40, 12)]), 2);
    const summary = summarize(project);
    expect(summary).toMatchObject({ copies: 4, packing: 'strip', jobs: 2, running: [] });
    expect(summary.recent.map((job) => job.number)).toEqual([2, 1]);
    expect(summary.recent[0]).toMatchObject({
      stage: 'completed',
      utilization: 80,
      used: { lengthMm: 3000 },
      more: 0,
    });
    // The project has not changed since its jobs.
    expect(summary.recent.every((job) => job.input === summary.input)).toBe(true);
    expect(readSummary(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
    expect(readSummary({ ...summary, version: 2 })).toBeUndefined();
    expect(readSummary({ ...summary, recent: [{ stage: 'running' }] })).toBeUndefined();
    // Worked out once for a document: saving and drawing the card share it.
    expect(summarize(project)).toBe(summary);
  });

  it('stay within the limit for a large project, dropping the oldest drawings first', () => {
    const parts = Array.from({ length: 60 }, (_, i) => round(50 + i, 400, 5));
    const project = withJobs(addParts(newProject('Large'), parts), 6);
    const summary = summarize(project);
    expect(bytes(summary)).toBeLessThanOrEqual(SUMMARY_BYTES);
    expect(summary.recent).toHaveLength(4);
    const drawn = summary.recent.map((job: JobListing) => !!job.thumb);
    // Whatever was dropped went from the oldest jobs first.
    expect(drawn).toEqual([...drawn].sort().reverse());
    expect(summary.thumb).toBeDefined();
  });
});

describe('thumbs', () => {
  it('pack shapes onto a small grid and unpack them', () => {
    const square = (x: number, y: number, size: number): [number, number][] => [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
    ];
    const thumb = packThumb(
      [0, 0, 1000, 500],
      [
        { fill: MATERIAL, rings: [square(0, 0, 1000).map(([x, y]) => [x, y / 2])] },
        // A part with a hole, and one far smaller than a step of the grid.
        { fill: 3, rings: [square(100, 100, 300), square(200, 200, 100)] },
        { fill: 4, rings: [square(600, 100, 0.5)] },
      ],
    );
    expect(thumb).toMatchObject({ width: 255, height: 128 });
    const shapes = unpackThumb(thumb)!;
    expect(shapes.map((shape) => [shape.fill, shape.rings.length])).toEqual([
      [MATERIAL, 1],
      [3, 2],
      [4, 1],
    ]);
    // The tiny part keeps a single step, so it still shows; y points down.
    expect(shapes[2].rings[0]).toHaveLength(4);
    expect(shapes[1].rings[0]).toContainEqual([26, 102]);
    expect(unpackThumb({ ...thumb, shapes: 'AAEF' })).toBeUndefined();
  });
});
