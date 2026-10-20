import type { Shape } from './geometry/contour';

export type Point = [number, number];
export type Ring = Point[];
export type RotationRule = { kind: 'discrete'; degrees: number[] } | { kind: 'continuous' };
export type Part = {
  id: string; name: string;
  source: { format: 'svg' | 'dxf' | 'sparrow'; fileName?: string; entityId?: string };
  /** In the job format: polygons, or curves where the part keeps them. */
  shape: Shape; approximationToleranceMm: number; quantity: number;
  rotations: RotationRule;
};
export type Preset = 'standard' | 'fast';
export type TimeLimit = 10 | 30 | 60 | 120 | 300 | 600 | null;
/** Solver-facing settings of one strip packing job. */
export type JobSettings = { solverPreset: Preset; materialWidthMm: number; clearanceMm: number; timeLimitSeconds: TimeLimit };
/** One complete nesting problem, as the solver and the geometry checks read it. */
export type Job = { name: string; parts: Part[]; settings: JobSettings };
/** A placed copy: mirrored across its own x-axis first when `mirrored`, then turned, then moved. */
export type Placement = { partId: string; copyIndex: number; xMm: number; yMm: number; angleDeg: number; mirrored?: boolean };
/** A layout as studio's drawings and exports read it: each copy placed, and the strip's length used. */
export type Result = { usedLengthMm: number; placements: Placement[] };
export const DEFAULT_SETTINGS: JobSettings = { solverPreset: 'standard', materialWidthMm: 1000, clearanceMm: 0, timeLimitSeconds: null };
export const SOLVER_REVISION = '7f0e10f946f70a86138d3938548a13ee46464f39';
// Bounds on what studio reads, for its own sake; how many copies a job may have is the backend's limit.
export const LIMITS = { copies: 100000, verticesPerPart: 5000, extent: 100000 };
// DXF exports draw the sheet on this layer; DXF import leaves it out unless chosen, so exports reimport as their parts.
export const SHEET_LAYER = 'SPARROW_SHEET';
export const defaultDXFLayers = (layers: string[]) => layers.filter((layer) => layer !== SHEET_LAYER);
// getRandomValues also works on HTTP LAN addresses, unlike randomUUID.
export function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function newPart(shape: Shape, name = 'Part'): Part {
  return { id: newId(), name, source: { format: 'svg' }, shape,
    approximationToleranceMm: 0, quantity: 1, rotations: { kind: 'discrete', degrees: [0, 180] } };
}
