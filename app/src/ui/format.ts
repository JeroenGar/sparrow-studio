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
