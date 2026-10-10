import { colors, shades } from '../engine/colors';
import type { RotationKind } from './rotations';

/** Pattern spacing in mm: a power of two, so lines stay put while zooming and stay 12–24 px apart. */
export const patternSize = (upp: number) => 2 ** Math.ceil(Math.log2(12 * upp));

/**
 * The fill pattern of one part, showing how it may rotate, in a darker shade of the part's colour.
 * It is laid out in millimetres, so it stays fixed to the part while the canvas pans and zooms.
 */
export function PartPattern({
  id,
  kind,
  size,
  stroke,
  color,
}: {
  id: string;
  kind: RotationKind;
  size: number;
  /** Line width in mm; one screen pixel keeps the lines light at any zoom. */
  stroke: number;
  color: string;
}) {
  if (kind === 'fixed') return null;
  const line = { stroke: color, strokeWidth: stroke };
  return (
    <pattern
      id={id}
      width={size}
      height={size}
      patternUnits="userSpaceOnUse"
      patternTransform={kind === 'custom' ? 'rotate(45)' : undefined}
    >
      {kind === 'half' && <line x1={0} y1={size / 2} x2={size} y2={size / 2} {...line} />}
      {kind === 'quarter' && (
        <path d={`M${size / 2} 0V${size}M0 ${size / 2}H${size}`} fill="none" {...line} />
      )}
      {kind === 'free' && <circle cx={size / 2} cy={size / 2} r={stroke * 1.3} fill={color} />}
      {kind === 'custom' && <line x1={size / 2} y1={0} x2={size / 2} y2={size} {...line} />}
    </pattern>
  );
}

export const patternFill = (id: string, kind: RotationKind) =>
  kind === 'fixed' ? 'none' : `url(#${id})`;

/** A small swatch for legends and lists, drawn in its own coordinate space. */
export function PatternSwatch({ kind }: { kind: RotationKind }) {
  const lines: Record<RotationKind, string> = {
    fixed: '',
    half: 'M0 5H14M0 9.5H14',
    quarter: 'M4.7 0V14M9.3 0V14M0 4.7H14M0 9.3H14',
    free: '',
    custom: 'M0 7L7 0M0 14L14 0M7 14L14 7',
  };
  return (
    <svg width="16" height="16" viewBox="-1 -1 16 16" aria-hidden="true" className="swatch">
      <rect width="14" height="14" rx="2" className="swatch-fill" fill={colors[3]} />
      {kind === 'free' ? (
        [3.5, 10.5].flatMap((x) =>
          [3.5, 10.5].map((y) => (
            <circle key={`${x}${y}`} cx={x} cy={y} r="1.2" fill={shades[3]} />
          )),
        )
      ) : (
        <path d={lines[kind]} stroke={shades[3]} strokeWidth="1.1" fill="none" />
      )}
    </svg>
  );
}
