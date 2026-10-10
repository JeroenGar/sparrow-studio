import type { RotationKind } from './rotations';

/** Fill patterns that show how a part may rotate. Sizes are in screen pixels, scaled by `upp`. */
export function RotationPatterns({ id, upp }: { id: string; upp: number }) {
  const size = 7 * upp;
  const line = { stroke: 'var(--pattern)', strokeWidth: 1.1 * upp };
  return (
    <defs>
      <pattern id={`${id}-half`} width={size} height={size} patternUnits="userSpaceOnUse">
        <line x1={0} y1={size / 2} x2={size} y2={size / 2} {...line} />
      </pattern>
      <pattern id={`${id}-quarter`} width={size} height={size} patternUnits="userSpaceOnUse">
        <path d={`M${size / 2} 0V${size}M0 ${size / 2}H${size}`} fill="none" {...line} />
      </pattern>
      <pattern id={`${id}-free`} width={size} height={size} patternUnits="userSpaceOnUse">
        <circle cx={size / 2} cy={size / 2} r={1.2 * upp} fill="var(--pattern)" />
      </pattern>
      <pattern
        id={`${id}-custom`}
        width={size}
        height={size}
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <line x1={size / 2} y1={0} x2={size / 2} y2={size} {...line} />
      </pattern>
    </defs>
  );
}

export const patternFill = (id: string, kind: RotationKind) =>
  kind === 'fixed' ? 'none' : `url(#${id}-${kind})`;

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
      <rect width="14" height="14" rx="2" className="swatch-fill" />
      {kind === 'free' ? (
        [3.5, 10.5].flatMap((x) =>
          [3.5, 10.5].map((y) => (
            <circle key={`${x}${y}`} cx={x} cy={y} r="1.2" fill="var(--pattern)" />
          )),
        )
      ) : (
        <path d={lines[kind]} stroke="var(--pattern)" strokeWidth="1.1" fill="none" />
      )}
    </svg>
  );
}
