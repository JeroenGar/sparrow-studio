import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, newPart, SOLVER_REVISION, type Document, type Result } from '../src/model';
import { normalizeDocument } from '../src/geometry/normalize';
import { validate } from '../src/geometry/validate';
import { solverInput } from '../src/import/sparrow';
import { exportProjectArchive, zip } from '../src/export/zip';

const readU16 = (view: DataView, offset: number) => view.getUint16(offset, true);
const readU32 = (view: DataView, offset: number) => view.getUint32(offset, true);

function entries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= 0; offset--) if (readU32(view, offset) === 0x06054b50) { eocd = offset; break; }
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = readU16(view, eocd + 10), centralOffset = readU32(view, eocd + 16), result = new Map<string, Uint8Array>();
  let offset = centralOffset;
  for (let index = 0; index < count; index++) {
    expect(readU32(view, offset)).toBe(0x02014b50);
    const nameLength = readU16(view, offset + 28), extraLength = readU16(view, offset + 30), commentLength = readU16(view, offset + 32);
    const size = readU32(view, offset + 24), localOffset = readU32(view, offset + 42);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    expect(readU32(view, localOffset)).toBe(0x04034b50);
    const localNameLength = readU16(view, localOffset + 26), localExtraLength = readU16(view, localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    result.set(name, bytes.slice(start, start + size));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

it('writes deterministic UTF-8 store archives with safe relative names', () => {
  const first = zip([{ name: 'hello.txt', data: 'hello' }, { name: 'bytes.bin', data: new Uint8Array([0, 255]) }]);
  const second = zip([{ name: 'hello.txt', data: 'hello' }, { name: 'bytes.bin', data: new Uint8Array([0, 255]) }]);
  expect([...first]).toEqual([...second]);
  expect([...entries(first).keys()]).toEqual(['hello.txt', 'bytes.bin']);
  expect(new TextDecoder().decode(entries(first).get('hello.txt'))).toBe('hello');
  expect([...entries(first).get('bytes.bin')!]).toEqual([0, 255]);
  expect(() => zip([{ name: '../escape', data: '' }])).toThrow('relative paths');
  expect(() => zip([{ name: 'one', data: '' }, { name: 'one', data: '' }])).toThrow('unique');
});

function fixture(): { document: Document; result: Result } {
  const part = { ...newPart([[0, 0], [10, 0], [10, 10], [0, 10]]), id: 'holed', holes: [[[2, 2], [2, 4], [4, 4], [4, 2]] as [number, number][]] };
  const document = normalizeDocument({ name: 'Archive plate', parts: [part], settings: { ...DEFAULT_SETTINGS, materialWidthMm: 20 } });
  const result: Result = { documentRevision: 7, solverRevision: SOLVER_REVISION, seed: '42', elapsedSeconds: 1, usedLengthMm: 10,
    placements: [{ partId: 'holed', copyIndex: 0, xMm: 0, yMm: 0, angleDeg: 0 }],
    validation: { status: 'pending', overlapAreaMm2: 0, maxBoundaryViolationMm: 0, minClearanceMm: null, errors: [] } };
  result.validation = validate(document, result);
  return { document, result };
}

it('packages project, checked outputs, hole-preserving exports, and dense CLI input', () => {
  const { document, result } = fixture();
  const projectOnly = entries(exportProjectArchive(document, 7));
  expect([...projectOnly.keys()]).toEqual(['project.sparrow-project.json', 'sparrow-instance.json', 'README.txt']);
  const complete = entries(exportProjectArchive(document, 7, result));
  expect([...complete.keys()]).toEqual(['project.sparrow-project.json', 'sparrow-instance.json', 'README.txt', 'layout.svg', 'layout.dxf']);
  const project = JSON.parse(new TextDecoder().decode(complete.get('project.sparrow-project.json')));
  const instance = JSON.parse(new TextDecoder().decode(complete.get('sparrow-instance.json')));
  expect(project.result.placements).toHaveLength(1);
  expect(instance.items).toMatchObject([{ id: 0, demand: 1, shape: { type: 'simple_polygon' } }]);
  expect(new TextDecoder().decode(complete.get('README.txt'))).toContain('ignores hole contours');
  expect(new TextDecoder().decode(complete.get('layout.svg'))).toContain('fill-rule="evenodd"');
  expect(new TextDecoder().decode(complete.get('layout.dxf'))).toContain('\nHOLES\n');
});

it('filters zero-demand shape types before assigning CLI IDs', () => {
  const { document } = fixture();
  const zero = { ...document.parts[0], id: 'zero', quantity: 0 }, active = { ...document.parts[0], id: 'active', quantity: 2 };
  const input = JSON.parse(solverInput({ ...document, parts: [zero, active] }));
  expect(input.items.map((item: { id: number; demand: number }) => [item.id, item.demand])).toEqual([[0, 2]]);
});
