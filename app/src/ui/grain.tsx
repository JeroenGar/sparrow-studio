import type { RotationRule } from '../engine/model';
import { rotationKind, type RotationKind } from './rotations';

/**
 * Grain lines: a small symbol for how a part may rotate. Directions are measured clockwise from
 * "up", the part's 0° orientation, in screen coordinates (y down).
 */
export type GrainPaths = { line: string; heads: string };

const dir = (degrees: number): [number, number] => [
  Math.sin((degrees * Math.PI) / 180),
  -Math.cos((degrees * Math.PI) / 180),
];

function arrowhead(x: number, y: number, ux: number, uy: number, size: number): string {
  const [nx, ny] = [-uy, ux];
  const [bx, by] = [x - ux * size, y - uy * size];
  const w = size * 0.55;
  return `M${x} ${y}L${bx + nx * w} ${by + ny * w}L${bx - nx * w} ${by - ny * w}Z`;
}

/** The grain line of a rule, centred at (cx, cy), `length` long. */
export function grainPaths(rule: RotationRule, cx: number, cy: number, length: number): GrainPaths {
  const kind: RotationKind = rotationKind(rule);
  const head = length * 0.17;
  let line = '';
  let heads = '';
  const spoke = (degrees: number, both: boolean) => {
    const [ux, uy] = dir(degrees);
    const [ax, ay] = [cx - (ux * length) / 2, cy - (uy * length) / 2];
    const [bx, by] = [cx + (ux * length) / 2, cy + (uy * length) / 2];
    line += `M${ax} ${ay}L${bx} ${by}`;
    heads += arrowhead(bx, by, ux, uy, head);
    if (both) heads += arrowhead(ax, ay, -ux, -uy, head);
  };
  if (kind === 'fixed') spoke(0, false);
  if (kind === 'half') spoke(0, true);
  if (kind === 'quarter') {
    spoke(0, true);
    spoke(90, true);
  }
  if (kind === 'free') {
    const r = length * 0.36;
    const point = (degrees: number) => {
      const [ux, uy] = dir(degrees);
      return [cx + ux * r, cy + uy * r];
    };
    const [x0, y0] = point(35);
    const [x1, y1] = point(325);
    line = `M${x0} ${y0}A${r} ${r} 0 1 1 ${x1} ${y1}`;
    const [tx, ty] = dir(325 + 90);
    heads = arrowhead(x1 + tx * head * 0.4, y1 + ty * head * 0.4, tx, ty, head);
  }
  if (kind === 'custom' && rule.kind === 'discrete') {
    for (const degrees of rule.degrees) {
      const [ux, uy] = dir(degrees);
      const [bx, by] = [cx + (ux * length) / 2, cy + (uy * length) / 2];
      line += `M${cx} ${cy}L${bx} ${by}`;
      heads += arrowhead(bx, by, ux, uy, head);
    }
    const r = head * 0.35;
    heads += `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  }
  return { line, heads };
}

/** A grain line as a small icon, for the legend and the list. */
export function GrainIcon({ rule, size = 18 }: { rule: RotationRule; size?: number }) {
  const { line, heads } = grainPaths(rule, 0, 0, 14);
  return (
    <svg width={size} height={size} viewBox="-9 -9 18 18" aria-hidden="true" className="grain-icon">
      <path d={line} fill="none" strokeWidth="1.4" strokeLinecap="round" />
      <path d={heads} stroke="none" />
    </svg>
  );
}
