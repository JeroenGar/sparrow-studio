import { describe, expect, it } from 'vitest';
import { outline } from '../src/engine/geometry/contour';
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
    expect(review.document.settings.materialWidthMm).toBe(50);
    expect(review.sheets).toEqual([]);
  });

  it('keep curves, or flatten them', () => {
    const strip = input({ type: 'minimize_strip_length', height: 50 });
    expect(importPro(strip, 'job.json', keep).document.parts[1].shape.outer.type).toBe('circle');
    const flat = importPro(strip, 'job.json', { curves: 'flatten', tolerance: 0.1 });
    expect(flat.document.parts[1].shape.outer.type).toBe('polygon');
  });

  it('say what is wrong with one they cannot read', () => {
    const strip = input({ type: 'minimize_strip_length', height: 50 });
    expect(() =>
      importPro(
        { ...strip, parts: [{ ...strip.parts[0], geometry_id: 'gone' }] },
        'job.json',
        keep,
      ),
    ).toThrow('no geometry gone');
    expect(() => importPro(input({ type: 'pack_bins' }), 'job.json', keep)).toThrow('unsupported');
  });
});
