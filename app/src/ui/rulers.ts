/** A round step near `target`: 1, 2 or 5 times a power of ten. */
export function rulerStep(target: number): number {
  const power = 10 ** Math.floor(Math.log10(target));
  const fraction = target / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

export type Tick = { value: number; position: number; major: boolean };

/**
 * Ruler ticks between two world coordinates, in the display unit. Major ticks are about
 * `spacing` pixels apart and carry a label; minor ticks split them into 4 or 5.
 */
export function rulerTicks(
  min: number,
  max: number,
  mmPerPixel: number,
  unitMm: number,
  spacing = 70,
): Tick[] {
  const major = rulerStep((spacing * mmPerPixel) / unitMm);
  const mantissa = major / 10 ** Math.floor(Math.log10(major));
  const subdivisions = Math.abs(mantissa - 2) < 1e-8 ? 4 : 5;
  const minor = major / subdivisions;
  const start = Math.ceil(min / unitMm / minor);
  const end = Math.floor(max / unitMm / minor);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, offset) => {
    const index = start + offset;
    const value = Number((index * minor).toPrecision(12));
    return { value, position: value * unitMm, major: index % subdivisions === 0 };
  });
}
