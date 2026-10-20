import { unitScale, type DisplayUnit } from '../engine/units';

/** A length for display, in the chosen unit, without trailing zeros. */
export function formatLength(
  mm: number,
  unit: DisplayUnit,
  digits = unit === 'mm' ? 1 : 3,
): string {
  if (!Number.isFinite(mm)) return '—';
  return (mm / unitScale(unit)).toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** The value shown in a length input: full precision, no grouping. */
export function inputLength(mm: number, unit: DisplayUnit): string {
  if (!Number.isFinite(mm)) return '';
  return String(Number((mm / unitScale(unit)).toPrecision(10)));
}

export function parseLength(text: string, unit: DisplayUnit): number {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() === '' ? NaN : value * unitScale(unit);
}

export const formatArea = (mm2: number, unit: DisplayUnit) =>
  `${(mm2 / unitScale(unit) ** 2).toLocaleString(undefined, { maximumFractionDigits: unit === 'mm' ? 0 : 2 })} ${unit}²`;

export const formatSeconds = (seconds: number) =>
  `${seconds.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;

/** A utilization or other share, with two decimals. */
export const formatPercent = (value: number) => `${value.toFixed(2)}%`;

const AGO: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['week', 7 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** How long ago a moment was, in words: "just now", "4 minutes ago", "yesterday". */
export function formatAgo(iso: string, now = Date.now()): string {
  const seconds = (Date.parse(iso) - now) / 1000;
  for (const [unit, size] of AGO)
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return 'just now';
}
