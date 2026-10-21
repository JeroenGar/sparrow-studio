import { describe, expect, it } from 'vitest';
import { outline } from '../src/engine/geometry/contour';
import { isSimpleRing } from '../src/engine/geometry/normalize';
import { importPro, isProInput } from '../src/engine/import/pro';

const square = (side: number, at = 0) => ({
  outer: {
    type: 'polygon',
    points: [
      [at, at],
      [at + side, at],
      [at + side, at + side],
      [at, at + side],
    ],
  },
});
const round = { outer: { type: 'circle', center: [5, 5], radius: 5 } };
const input = (problem: object) => ({
  schema_version: 1,
  geometries: [
    { id: 'plate', shape: square(10, 20) },
    { id: 'disc', shape: round },
    { id: 'hide', shape: square(1000) },
  ],
  parts: [
    {
      id: 'a',
      geometry_id: 'plate',
      quantity: 3,
      orientation: { rotation: { type: 'continuous' } },
    },
    {
      id: 'b',
      geometry_id: 'disc',
      quantity: 1,
      orientation: { rotation: { type: 'continuous' } },
    },
  ],
  minimum_separation_distance: { parts: 2, boundary: 1 },
  problem,
});
const keep = { curves: 'keep' as const, tolerance: 0.1 };

describe('sparrow Pro job inputs', () => {
  it('are told apart from sparrow instances', () => {
    expect(isProInput(input({ type: 'minimize_strip_length', height: 50 }))).toBe(true);
    expect(isProInput({ name: 'instance', strip_height: 10, items: [] })).toBe(false);
  });

  it('give their parts, moved to the origin, and their sheets in order', () => {
    const review = importPro(
      input({
        type: 'minimize_sheets_in_order',
        sheets: [
          { id: '1', geometry_id: 'hide', quantity: 2, defects: [square(5).outer] },
          { id: '2', geometry_id: 'hide' },
        ],
      }),
      'job.json',
      keep,
    );
    const [plate, disc] = review.document.parts;
    expect([plate.name, plate.quantity, disc.quantity]).toEqual(['Part a', 3, 1]);
    expect(outline(plate.shape).outer[0]).toEqual([0, 0]);
    // The project's defaults decide how parts turn, not the file.
    expect(plate.rotations).toEqual({ kind: 'discrete', degrees: [0, 180] });
    expect(
      review.sheets!.map((sheet) => [sheet.name, sheet.quantity, sheet.defects.length]),
    ).toEqual([
      ['Sheet 1', 2, 1],
      ['Sheet 2', 1, 0],
    ]);
  });

  it('give a strip job its width, and no sheets', () => {
    const review = importPro(
      input({ type: 'minimize_strip_length', height: 50 }),
      'job.json',
      keep,
    );
    expect(review.stripWidthMm).toBe(50);
    expect(review.sheets).toEqual([]);
  });

  it('keep curves, or flatten them', () => {
    const strip = input({ type: 'minimize_strip_length', height: 50 });
    expect(importPro(strip, 'job.json', keep).document.parts[1].shape.outer.type).toBe('circle');
    const flat = importPro(strip, 'job.json', { curves: 'flatten', tolerance: 0.1 });
    expect(flat.document.parts[1].shape.outer.type).toBe('polygon');
  });

  it('refuse a file they cannot read as a whole', () => {
    const strip = input({ type: 'minimize_strip_length', height: 50 });
    expect(() => importPro(input({ type: 'pack_bins' }), 'job.json', keep)).toThrow('unsupported');
    expect(() =>
      importPro(input({ type: 'minimize_sheets_in_order', sheets: [] }), 'job.json', keep),
    ).toThrow('a list of sheets');
    const twice = { ...strip, geometries: [...strip.geometries, { id: 'plate', shape: round }] };
    expect(() => importPro(twice, 'job.json', keep)).toThrow('Geometry plate is there twice');
  });

  it('leave out a part or sheet they cannot use, say why, and import the rest', () => {
    const strip = input({ type: 'minimize_strip_length', height: 50 });
    const parts = importPro(
      {
        ...strip,
        parts: [...strip.parts, { ...strip.parts[0], id: 'c', geometry_id: 'gone' }],
        geometries: [...strip.geometries],
      },
      'job.json',
      keep,
    );
    expect(parts.document.parts.map((part) => part.name)).toEqual(['Part a', 'Part b']);
    expect(parts.issues).toEqual(['Part c: no geometry gone.']);
    const negative = importPro(
      { ...strip, parts: [{ ...strip.parts[0], quantity: -1 }] },
      'job.json',
      keep,
    );
    expect(negative.issues![0]).toMatch(/^Part a: /);

    const holed = (holes: object[]) => ({ outer: square(100).outer, holes });
    const job = input({
      type: 'minimize_sheets_in_order',
      sheets: [
        { id: '1', geometry_id: 'hide', quantity: 1.5 },
        { id: '2', geometry_id: 'hide', defects: [{ type: 'circle', radius: 5 }] },
        { id: '3', geometry_id: 'overlapping' },
        { id: '4', geometry_id: 'outside' },
        { id: '5', geometry_id: 'hide' },
      ],
    });
    const review = importPro(
      {
        ...job,
        geometries: [
          ...job.geometries,
          { id: 'overlapping', shape: holed([square(20, 10).outer, square(20, 20).outer]) },
          { id: 'outside', shape: holed([square(20, 90).outer]) },
        ],
      },
      'job.json',
      keep,
    );
    expect(review.sheets!.map((sheet) => sheet.name)).toEqual(['Sheet 5']);
    expect(review.issues!.map((issue) => issue.split(':').slice(0, 2).join(':'))).toEqual([
      'Sheet 1: its quantity must be a whole number, 0 or more.',
      'Sheet 2: defect 1',
      'Sheet 3: Holes overlap or contain each other.',
      'Sheet 4: Hole must be strictly inside its outer contour.',
    ]);
  });

  it('give a sheets job no strip width, and polygons as the project stores them', () => {
    const closed = [...square(5).outer.points, [0, 0]];
    const review = importPro(
      input({
        type: 'minimize_sheets_in_order',
        sheets: [{ id: '1', geometry_id: 'hide', defects: [{ type: 'polygon', points: closed }] }],
      }),
      'job.json',
      keep,
    );
    expect(review.stripWidthMm).toBeUndefined();
    const [defect] = review.sheets![0].defects;
    expect(defect.type === 'polygon' && defect.points.length).toBe(4);
    expect(isSimpleRing(outline({ outer: defect }).outer)).toBe(true);
  });
});
