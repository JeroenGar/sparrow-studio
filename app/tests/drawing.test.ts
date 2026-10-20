import { describe, expect, it } from 'vitest';
import {
  classify,
  congruent,
  suggestRoles,
  type Drawing,
  type Outline,
} from '../src/engine/import/drawing';
import { polygon } from '../src/engine/geometry/contour';
import { outline } from '../src/engine/geometry/contour';
import type { Ring } from '../src/engine/model';

const ring = (points: number[][]): Ring => points as Ring;
const square = (x: number, y: number, size: number): Ring =>
  ring([
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ]);
let next = 0;
const drawn = (layer: string, points: Ring): Outline => ({
  id: `o${++next}`,
  layer,
  ring: points,
  contour: polygon(points),
  curved: false,
});
const drawing = (outlines: Outline[]): Drawing => ({
  name: 'test.dxf',
  format: 'dxf',
  outlines,
  layers: [...new Set(outlines.map((o) => o.layer))],
  warnings: [],
  issues: [],
  tolerance: 0.01,
});
const L = (x: number, y: number) =>
  ring([
    [x, y],
    [x + 30, y],
    [x + 30, y + 10],
    [x + 10, y + 10],
    [x + 10, y + 40],
    [x, y + 40],
  ]);

describe('importing a drawing', () => {
  it('merges copies moved and turned, within rounding, but not mirrored ones', () => {
    // A second L turned half a turn, its corners off by a few micrometres; a third mirrored.
    const turned = L(0, 0).map(([x, y]) => [100 - x + 0.003, 100 - y - 0.002]) as Ring;
    const mirrored = L(0, 0).map(([x, y]) => [200 - x, y]) as Ring;
    const { parts } = classify(
      drawing([drawn('CUT', L(0, 0)), drawn('CUT', turned), drawn('CUT', mirrored)]),
      { CUT: 'parts' },
    );
    expect(parts.map((part) => part.quantity)).toEqual([2, 1]);
    expect(
      congruent(
        { outline: { ...drawn('CUT', L(0, 0)) }, holes: [] },
        { outline: { ...drawn('CUT', L(0, 0).map(([x, y]) => [x + 0.5, y]) as Ring) }, holes: [] },
        0.01,
      ),
    ).toBe(true);
  });

  it('takes an outline entirely inside another of its layer as its hole, and a touching one as an issue', () => {
    const { parts, issues } = classify(
      drawing([
        drawn('CUT', square(0, 0, 100)),
        drawn('CUT', square(10, 10, 20)),
        drawn('CUT', square(200, 0, 100)),
        // Inside, but touching the edge: not a hole.
        drawn('CUT', square(200, 0, 20)),
      ]),
      { CUT: 'parts' },
    );
    expect(parts.map((part) => outline(part.shape).holes.length)).toEqual([1]);
    expect(issues.join(' ')).toContain('touches the other from inside');
  });

  it('gives sheets the defects that overlap them, where they are drawn, also past the edge', () => {
    const { sheets, issues } = classify(
      drawing([
        drawn('Sheet', square(100, 100, 500)),
        drawn('Sheet', square(1000, 100, 500)),
        drawn('Sheet', square(2000, 100, 500)),
        // Reaching past the first sheet's left edge.
        drawn('Defects', square(80, 200, 50)),
        drawn('Defects', square(5000, 5000, 10)),
      ]),
      { Sheet: 'sheets', Defects: 'defects' },
    );
    // The sheet with a defect stays apart; the two bare ones are one entry, twice.
    expect(sheets.map((sheet) => [sheet.quantity, sheet.defects.length])).toEqual([
      [1, 1],
      [2, 0],
    ]);
    expect(outline({ outer: sheets[0].defects[0] }).outer[0]).toEqual([-20, 100]);
    expect(issues.join(' ')).toContain('overlaps no sheet');
  });

  it('leaves ignored layers out', () => {
    const { parts, sheets } = classify(
      drawing([drawn('CUT', square(0, 0, 10)), drawn('Notes', square(50, 0, 10))]),
      { CUT: 'parts', Notes: 'ignored' },
    );
    expect([parts.length, sheets.length]).toEqual([1, 0]);
  });

  it('suggests roles from layer names, else the kind of content asked for', () => {
    expect(
      suggestRoles(['CUT', 'Sheet', 'Offcut', 'CuttingLine', 'Defects', '0'], 'parts'),
    ).toEqual({
      CUT: 'parts',
      Sheet: 'sheets',
      Offcut: 'ignored',
      CuttingLine: 'ignored',
      Defects: 'defects',
      '0': 'parts',
    });
    expect(suggestRoles(['0'], 'sheets')).toEqual({ '0': 'sheets' });
  });

  it('merges copies that differ by corners on a straight edge, or by rounding at their first corner', () => {
    const plain = square(0, 0, 10);
    const split = ring([
      [100, 0],
      [105, 0],
      [110, 0],
      [110, 10],
      [100, 10],
    ]);
    const triangle = ring([
      [0, 0],
      [100, 1],
      [-100, 1],
    ]);
    const nudged = ring([
      [500.009, 0],
      [600, 1],
      [400, 1],
    ]);
    const { parts } = classify(
      drawing([drawn('A', plain), drawn('A', split), drawn('B', triangle), drawn('B', nudged)]),
      { A: 'parts', B: 'parts' },
    );
    expect(parts.map((part) => part.quantity)).toEqual([2, 2]);
  });

  it('pairs holes in any order', () => {
    const plate = (x: number, holes: number[]) => [
      drawn('CUT', square(x, 0, 40)),
      ...holes.map((h) => drawn('CUT', square(x + h, 10, 2))),
    ];
    const { parts } = classify(
      drawing([...plate(0, [10, 20.008]), ...plate(100, [20.004, 10.003])]),
      { CUT: 'parts' },
    );
    expect(parts.map((part) => part.quantity)).toEqual([2]);
  });

  it('finds no sheet for a defect inside a sheet hole', () => {
    const { sheets, issues } = classify(
      drawing([
        drawn('Sheet', square(0, 0, 100)),
        drawn('Sheet', square(20, 20, 50)),
        drawn('Defects', square(30, 30, 5)),
      ]),
      { Sheet: 'sheets', Defects: 'defects' },
    );
    expect(sheets.map((sheet) => sheet.defects.length)).toEqual([0]);
    expect(issues.join(' ')).toContain('overlaps no sheet');
  });
});
