import type { RotationRule } from '../engine/model';

export type RotationKind = 'fixed' | 'half' | 'quarter' | 'free' | 'custom';

const turn = (degrees: number) => ((degrees % 360) + 360) % 360;

export function rotationKind(rule: RotationRule): RotationKind {
  if (rule.kind === 'continuous') return 'free';
  const angles = [...new Set(rule.degrees.map(turn))].sort((a, b) => a - b);
  if (angles.length === 1 && angles[0] === 0) return 'fixed';
  if (angles.join() === '0,180') return 'half';
  if (angles.join() === '0,90,180,270') return 'quarter';
  return 'custom';
}

export const ROTATION_LABELS: Record<RotationKind, string> = {
  fixed: 'Fixed',
  half: 'Half-turns',
  quarter: 'Quarter-turns',
  free: 'Free rotation',
  custom: 'Custom angles',
};

export function rotationRule(kind: Exclude<RotationKind, 'custom'>): RotationRule {
  switch (kind) {
    case 'fixed':
      return { kind: 'discrete', degrees: [0] };
    case 'half':
      return { kind: 'discrete', degrees: [0, 180] };
    case 'quarter':
      return { kind: 'discrete', degrees: [0, 90, 180, 270] };
    case 'free':
      return { kind: 'continuous' };
  }
}

export function describeAngles(rule: RotationRule): string {
  return rule.kind === 'continuous' ? 'any angle' : rule.degrees.map((d) => `${d}°`).join(', ');
}

/** Parse "0, 90, 45" into a rotation rule, or undefined when the list is not valid. */
export function parseAngles(text: string): RotationRule | undefined {
  const degrees = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (!degrees.length || !degrees.every(Number.isFinite)) return undefined;
  return { kind: 'discrete', degrees: [...new Set(degrees.map(turn))].sort((a, b) => a - b) };
}
