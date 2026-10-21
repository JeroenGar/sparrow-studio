import { describe, expect, it } from 'vitest';
import { polygonShape } from '../src/engine/geometry/contour';
import { newPart, type Part } from '../src/engine/model';
import {
  addJob,
  addParts,
  endJob,
  newProject,
  newSheet,
  type ProjectDocument,
} from '../src/project/model';
import { projectRequest } from '../src/project/solution';
import {
  layoutThumb,
  readSummary,
  savedSummary,
  summarize,
  SUMMARY_BYTES,
} from '../src/project/summary';
import { MATERIAL, packThumb, unpackThumb } from '../src/project/thumb';
import { colors } from '../src/engine/colors';
import { onStrip } from './fixtures/strip';

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
    const project = withJobs(
      addParts(onStrip(newProject('Job')), [round(100, 40, 3), round(40, 12)]),
      2,
    );
    const summary = summarize(project);
    expect(summary).toMatchObject({ copies: 4, packing: 'strip', jobs: 2, running: [] });
    // The newest job for the card, and every job's number by its ID for the list of all jobs.
    expect(summary.recent.map((job) => job.number)).toEqual([2]);
    expect(summary.jobNumbers).toEqual({ job_1: 1, job_2: 2 });
    expect(readSummary({ ...summary, jobNumbers: { job_1: 'one' } })).toBeUndefined();
    expect(readSummary({ ...summary, jobNumbers: { job_1: 0 } })).toBeUndefined();
    // A summary saved before it listed its jobs still reads.
    const { jobNumbers: _, ...before } = summary;
    expect(readSummary(before)).toEqual(before);
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

  it('stay within the limit for a large project, dropping the drawings first', () => {
    const parts = Array.from({ length: 60 }, (_, i) => round(50 + i, 400, 5));
    const project = withJobs(addParts(onStrip(newProject('Large')), parts), 6);
    const summary = summarize(project);
    expect(bytes(summary)).toBeLessThanOrEqual(SUMMARY_BYTES);
    expect(summary.recent).toHaveLength(1);
    expect(summary.thumb).toBeDefined();
  });

  it('keep a failed job’s error short, and are none when they cannot fit', () => {
    let project = addParts(newProject('Job'), [round(100, 40)]);
    const request = projectRequest(project);
    const fields = Array.from({ length: 400 }, (_, i) => ({
      param: `/input/parts/${i}`,
      message: 'This part is not closed. '.repeat(10),
    }));
    project = endJob(addJob(project, 'job_1', request, {}), 'job_1', {
      schema_version: 1,
      input: request.input,
      settings: request.settings as never,
      state: {
        status: 'failed',
        error: {
          code: 'invalid_job_input',
          message: 'Long.',
          doc_url: null,
          param: null,
          field_errors: fields,
        },
      } as never,
    });
    const summary = summarize(project);
    expect(bytes(summary)).toBeLessThan(4000);
    expect(summary.recent[0]).toMatchObject({
      stage: 'failed',
      error: { code: 'invalid_job_input', field_errors: [fields[0]] },
    });
    // A project whose summary would not fit even without drawings saves none, and Home shows it
    // from its document.
    const named = {
      ...project,
      jobs: project.jobs.map((job) => ({ ...job, submittedAt: 'x'.repeat(20_000) })),
    };
    expect(savedSummary(named)).toBeUndefined();
    expect(summarize(named)).toMatchObject({ jobs: 1, recent: [{ stage: 'failed' }] });
  });

  it('color parts as the Parts tab does, past the palette', () => {
    const parts = Array.from({ length: 300 }, (_, i) => round(10 + (i === 290 ? 1000 : 0), 8));
    const thumb = summarize(addParts(newProject('Many'), parts)).thumb!;
    // The largest part is the 291st: it comes first, in its palette color.
    expect(unpackThumb(thumb)![0].fill).toBe(290 % colors.length);
  });
});

const square = (x: number, y: number, size: number): [number, number][] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];

describe('thumbs', () => {
  it('pack shapes onto a small grid and unpack them', () => {
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

  it('draw a sliver whose corners round into a line as its extent', () => {
    // On a grid of whole millimetres, a flat triangle half a step tall rounds onto one line.
    const sliver: [number, number][] = [
      [0, 253.51],
      [10, 253.51],
      [5, 254.49],
    ];
    const [shape] = unpackThumb(packThumb([0, 0, 255, 255], [{ fill: 0, rings: [sliver] }]))!;
    expect(shape.rings).toHaveLength(1);
    expect(shape.rings[0]).toHaveLength(4);
  });

  it('keep at most the rings a byte can count', () => {
    const holes = Array.from({ length: 300 }, (_, i) =>
      square((i % 20) * 50 + 10, Math.floor(i / 20) * 50 + 10, 30),
    );
    const thumb = packThumb(
      [0, 0, 1000, 1000],
      [{ fill: 0, rings: [square(0, 0, 1000), ...holes] }],
    );
    expect(unpackThumb(thumb)![0].rings).toHaveLength(255);
  });
});

describe('job thumbs', () => {
  it('hold the first layouts side by side, as many as about fit five to one', () => {
    const project = addParts(newProject('Sheets'), [round(20, 12)]);
    const sheets = Array.from({ length: 7 }, (_, i) => newSheet(`Sheet ${i + 1}`, 100, 100));
    const { input } = projectRequest({ ...project, stock: { ...project.stock, sheets } });
    const part = input.parts[0].id;
    const placed = { rotation: 0, translation: [50, 50], reflection: 'none' as const };
    const layout = { cut_x: null, consumed_area: 1, placed_area: 0.1, density: 0.1 };
    const best = {
      solution: {
        layouts: sheets.map((sheet) => ({
          sheet_id: sheet.id,
          placements: [{ part_id: part, transformation: placed }],
        })),
      },
      stats: { ...layout, layouts: sheets.map(() => layout) },
    };
    const { thumb, more } = layoutThumb(input, best as never, new Map());
    const shapes = unpackThumb(thumb)!;
    // Five squares and their gaps are a little over five to one; a sixth would not fit.
    expect(shapes.filter((shape) => shape.fill === MATERIAL)).toHaveLength(5);
    expect(more).toBe(2);
    expect(thumb.width / thumb.height).toBeGreaterThan(5);
  });
});
