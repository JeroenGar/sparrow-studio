export type Point = [number, number];
export type Ring = Point[];
export type RotationRule = { kind: 'discrete'; degrees: number[] } | { kind: 'continuous' };
export type Part = {
  id: string; name: string;
  source: { format: 'svg' | 'dxf' | 'sparrow'; fileName?: string; entityId?: string };
  outer: Ring; holes: Ring[]; approximationToleranceMm: number; quantity: number;
  rotations: RotationRule;
};
export type Preset = 'standard' | 'fast';
export type TimeLimit = 10 | 30 | 60 | 120 | 300 | 600 | null;
/** Solver-facing settings of one strip packing job. */
export type JobSettings = { solverPreset: Preset; materialWidthMm: number; clearanceMm: number; timeLimitSeconds: TimeLimit };
/** One complete nesting problem, as the solver and the geometry checks read it. */
export type Job = { name: string; parts: Part[]; settings: JobSettings };
export type Placement = { partId: string; copyIndex: number; xMm: number; yMm: number; angleDeg: number };
export type Validation = { status: 'pending' | 'passed' | 'failed'; source?: 'solver'; overlapAreaMm2: number | null;
  maxBoundaryViolationMm: number | null; minClearanceMm: number | null; errors: string[] };
export type Result = { documentRevision: number; solverRevision: string; seed: string;
  elapsedSeconds: number; usedLengthMm: number; placements: Placement[]; validation: Validation };
export const DEFAULT_SETTINGS: JobSettings = { solverPreset: 'standard', materialWidthMm: 1000, clearanceMm: 0, timeLimitSeconds: null };
export const SOLVER_REVISION = '7f0e10f946f70a86138d3938548a13ee46464f39';
export const LIMITS = { copies: 500, verticesPerPart: 5000, verticesTotal: 100000, extent: 100000 };
// DXF exports draw the sheet on this layer; DXF import leaves it out unless chosen, so exports reimport as their parts.
export const SHEET_LAYER = 'SPARROW_SHEET';
export const defaultDXFLayers = (layers: string[]) => layers.filter((layer) => layer !== SHEET_LAYER);
export const POLICY = { linearMm: 1e-6, overlapMm2: 1e-8, angleDeg: 1e-4 };
// getRandomValues also works on HTTP LAN addresses, unlike randomUUID.
export function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function newPart(outer: Ring, name = 'Part'): Part {
  return { id: newId(), name, source: { format: 'svg' }, outer, holes: [],
    approximationToleranceMm: 0, quantity: 1, rotations: { kind: 'discrete', degrees: [0, 180] } };
}
