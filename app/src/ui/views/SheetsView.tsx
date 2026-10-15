import { useId, useState } from 'react';
import { netArea } from '../../engine/geometry/validate';
import { LIMITS } from '../../engine/model';
import type { DisplayUnit } from '../../engine/units';
import { Canvas } from '../Canvas';
import { ProRow, ProTag } from '../ProTag';
import { useStudio } from '../context';
import { formatLength } from '../format';
import { ImportMenu } from '../ImportMenu';
import { LengthInput } from '../LengthInput';
import { RunBar } from '../RunBar';

export function SheetsView() {
  const { project, edit, unit } = useStudio();
  const strip = project.stock.strip;
  const [open, setOpen] = useState(true);
  const width = Number.isFinite(strip.widthMm) && strip.widthMm > 0 ? strip.widthMm : 1000;
  const area = project.parts.reduce((sum, part) => sum + netArea(part) * part.quantity, 0);
  // An impression of the length, not a promise: the solver finds the real one.
  const shown = Math.max(width * 1.6, (area / width) * 1.3);
  const updateStrip = (change: Partial<typeof strip>, key: string) =>
    edit(
      (current) => ({
        ...current,
        stock: { ...current.stock, strip: { ...current.stock.strip, ...change } },
      }),
      key,
    );
  return (
    <div className="view">
      <section className="list-panel" aria-label="Sheets">
        <div className="segmented" role="group" aria-label="Packing">
          <button aria-pressed="true">Strip</button>
          <ProTag label="Sheets · sparrow pro" />
        </div>
        <p className="muted pad">
          Parts nest into one strip of fixed width. The solver minimizes the length used. Sheets,
          remnants and irregular sheets need sparrow pro.
        </p>
        <div className="list-head">
          <span className="label">Strip</span>
          <ImportMenu kind="sheets" files={false} />
        </div>
        <div className="list-scroll">
          <button
            className={open ? 'row selected' : 'row'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <svg className="thumb" viewBox="0 0 36 36" aria-hidden="true">
              <rect x="2" y="11" width="32" height="14" className="strip-thumb" />
            </svg>
            <span className="row-text">
              <span>{strip.name}</span>
              <span className="muted mono">
                {formatLength(strip.widthMm, unit)} {unit} wide · length open
              </span>
            </span>
          </button>
          {open && (
            <div className="properties">
              <label className="field">
                Name
                <input
                  value={strip.name}
                  onChange={(event) => updateStrip({ name: event.target.value }, 'strip-name')}
                />
              </label>
              <LengthInput
                label="Width"
                value={strip.widthMm}
                min={0}
                max={LIMITS.extent}
                onChange={(widthMm) => updateStrip({ widthMm }, 'strip-width')}
              />
              <div className="field">
                Length
                <span className="muted">Open: the solver minimizes it.</span>
              </div>
              <ProRow>Defects and clamp zones</ProRow>
            </div>
          )}
          <div className="pad">
            <ProRow>Add sheets, in nesting order</ProRow>
          </div>
        </div>
        <RunBar />
      </section>
      <Canvas label="The strip" extent={[-width * 0.15, -width * 0.25, shown, width * 1.15]}>
        {({ upp }) => <StripDrawing width={width} length={shown} upp={upp} unit={unit} />}
      </Canvas>
    </div>
  );
}

function StripDrawing({
  width,
  length,
  upp,
  unit,
}: {
  width: number;
  length: number;
  upp: number;
  unit: DisplayUnit;
}) {
  const id = useId().replace(/:/g, '');
  const open = length * 0.7;
  const tick = 6 * upp;
  const offset = 18 * upp;
  return (
    <>
      <defs>
        <linearGradient id={`${id}-fade`} x1="0" x2="1">
          <stop offset="0" stopColor="var(--sheet)" stopOpacity="1" />
          <stop offset="1" stopColor="var(--sheet)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x={0} y={-width} width={open} height={width} fill="var(--sheet)" />
      <rect x={open} y={-width} width={length - open} height={width} fill={`url(#${id}-fade)`} />
      <path
        d={`M${length} ${-width}H0V0H${length}`}
        className="sheet-edge"
        strokeWidth={2 * upp}
        fill="none"
      />
      <path
        d={`M${open} ${-width}V0`}
        className="dash"
        strokeWidth={1.2 * upp}
        strokeDasharray={`${6 * upp} ${6 * upp}`}
      />
      <path
        d={`M${-offset} ${-width}V0M${-offset - tick} ${-width}h${2 * tick}M${-offset - tick} 0h${2 * tick}`}
        className="dimension"
        strokeWidth={upp}
      />
      <text
        className="dimension-text"
        fontSize={13 * upp}
        textAnchor="middle"
        transform={`translate(${-offset - 6 * upp} ${-width / 2}) rotate(-90)`}
      >
        {formatLength(width, unit)} {unit}
      </text>
      <text
        className="muted-text"
        x={open / 2}
        y={offset + 4 * upp}
        fontSize={13 * upp}
        textAnchor="middle"
      >
        Length used: found by the solver
      </text>
    </>
  );
}
