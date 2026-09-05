export type Point = [number, number];
export type Ring = Point[];
export type RotationRule = { kind: 'discrete'; degrees: number[] } | { kind: 'continuous' };
export type Part = {
  id: string; name: string;
  source: { format: 'svg' | 'dxf' | 'sparrow' | 'drawn'; fileName?: string; entityId?: string };
  outer: Ring; holes: Ring[]; approximationToleranceMm: number; quantity: number;
  rotations: RotationRule; preparationPosition: Point;
};
export type Settings = { solverPreset?: 'standard' | 'fast'; materialWidthMm: number; clearanceMm: number; timeLimitSeconds: 10 | 30 | 60 | 120 | 300 | 600 | null };
export type Placement = { partId: string; copyIndex: number; xMm: number; yMm: number; angleDeg: number };
/** A document keeps the editable position of every demanded copy. */
export type Document = { name: string; parts: Part[]; settings: Settings; placements?: Placement[] };
export type Validation = { status: 'pending' | 'passed' | 'failed'; overlapAreaMm2: number;
  maxBoundaryViolationMm: number; minClearanceMm: number | null; errors: string[] };
export type Result = { documentRevision: number; solverRevision: string; seed: string;
  elapsedSeconds: number; usedLengthMm: number; placements: Placement[]; validation: Validation };
export type Project = Document & { schemaVersion: 1; revision: number; result?: Result };
export const DEFAULT_SETTINGS: Settings = { materialWidthMm: 1000, clearanceMm: 0, timeLimitSeconds: null };
export const SOLVER_REVISION = '120cf937de5e74c292406bc9947276c9dd49217f+studio-exact-fit-1';
export const LIMITS = { copies: 500, verticesPerPart: 5000, verticesTotal: 100000, extent: 100000 };
export const POLICY = { linearMm: 1e-6, overlapMm2: 1e-8, angleDeg: 1e-4 };
export function newPart(outer: Ring, name = 'Part'): Part {
  return { id: crypto.randomUUID(), name, source: { format: 'drawn' }, outer, holes: [],
    approximationToleranceMm: 0, quantity: 1, rotations: { kind: 'discrete', degrees: [0, 180] }, preparationPosition: [0, 0] };
}
export function example(): Document {
  const shapes: Ring[] = [ [[0,0],[36,0],[36,12],[12,12],[12,38],[0,38]],
    [[0,0],[28,0],[36,20],[14,32],[0,20]], [[0,0],[38,0],[38,10],[26,10],[26,26],[12,26],[12,10],[0,10]],
    [[0,0],[30,0],[30,30],[0,30]] ];
  return { name: 'Workshop parts', settings: { materialWidthMm: 100, clearanceMm: 0, timeLimitSeconds: null },
    parts: shapes.map((ring, i) => ({ ...newPart(ring, ['Bracket', 'Shield', 'Tab', 'Plate'][i]), quantity: 3,
      preparationPosition: [[0,0],[40,0],[0,42],[42,42]][i] as Point })) };
}

export function rotationSummary(rule: RotationRule): string {
  if (rule.kind === 'continuous') return 'Free rotation';
  const degrees = [...new Set(rule.degrees.map(d => ((d % 360) + 360) % 360))].sort((a,b) => a-b);
  if (degrees.length === 1) return 'Fixed';
  if (degrees.length === 2 && degrees[1]-degrees[0] === 180) return 'Half-turns';
  if (degrees.length === 4 && degrees.every((d,i) => d-degrees[0] === i*90)) return 'Quarter-turns';
  return `${degrees.length} angles`;
}
