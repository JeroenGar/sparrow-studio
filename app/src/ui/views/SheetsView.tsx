import { useId, useMemo, useState } from 'react';
import { outline } from '../../engine/geometry/contour';
import { bounds } from '../../engine/geometry/normalize';
import { netArea } from '../../engine/geometry/world';
import { LIMITS, newId } from '../../engine/model';
import type { DisplayUnit } from '../../engine/units';
import type { Box } from '../../project/layout';
import {
  copyCount,
  newSheet,
  rectangleOf,
  type ProjectDocument,
  type SheetEntry,
  type Stock,
} from '../../project/model';
import { Canvas, ringsPath } from '../Canvas';
import { usesSparrowPro } from '../client';
import { ProRow, ProTag } from '../ProTag';
import { useStudio } from '../context';
import { formatLength } from '../format';
import { ImportMenu } from '../ImportMenu';
import { LengthInput } from '../LengthInput';
import { RunBar } from '../RunBar';

const withStock = (project: ProjectDocument, change: Partial<Stock>): ProjectDocument => ({
  ...project,
  stock: { ...project.stock, ...change },
});

export function SheetsView() {
  const { project, edit } = useStudio();
  const packing = project.stock.packing;
  return (
    <div className="view">
      <section className="list-panel" aria-label="Sheets">
        <div className="segmented" role="group" aria-label="Packing">
          <button
            aria-pressed={packing === 'strip'}
            onClick={() => edit((current) => withStock(current, { packing: 'strip' }))}
          >
            Strip
          </button>
          <button
            aria-pressed={packing === 'sheets'}
            onClick={() => edit((current) => withStock(current, { packing: 'sheets' }))}
          >
            Sheets
          </button>
        </div>
        {packing === 'strip' ? <StripList /> : <SheetList />}
        <RunBar />
      </section>
      {packing === 'strip' ? <StripCanvas /> : <SheetsCanvas />}
    </div>
  );
}

function StripList() {
  const { project, edit, unit } = useStudio();
  const strip = project.stock.strip;
  const [open, setOpen] = useState(true);
  const updateStrip = (change: Partial<typeof strip>, key: string) =>
    edit((current) => withStock(current, { strip: { ...current.stock.strip, ...change } }), key);
  return (
    <>
      <p className="muted pad">
        Parts nest into one strip of fixed width. The solver minimizes the length used.
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
          </div>
        )}
      </div>
    </>
  );
}

function StripCanvas() {
  const { project, unit } = useStudio();
  const strip = project.stock.strip;
  const width = Number.isFinite(strip.widthMm) && strip.widthMm > 0 ? strip.widthMm : 1000;
  const area = project.parts.reduce((sum, part) => sum + netArea(part) * part.quantity, 0);
  // An impression of the length, not a promise: the solver finds the real one.
  const shown = Math.max(width * 1.6, (area / width) * 1.3);
  return (
    <Canvas label="The strip" extent={[-width * 0.15, -width * 0.25, shown, width * 1.15]}>
      {({ upp }) => <StripDrawing width={width} length={shown} upp={upp} unit={unit} />}
    </Canvas>
  );
}

/** The size of a sheet's outline. */
function sizeOf(sheet: SheetEntry, unit: DisplayUnit) {
  const [x0, y0, x1, y1] = bounds(outline(sheet.shape).outer);
  return `${formatLength(x1 - x0, unit)} × ${formatLength(y1 - y0, unit)} ${unit}`;
}

function SheetThumb({ sheet }: { sheet: SheetEntry }) {
  const { outer, holes } = outline(sheet.shape);
  const b = bounds(outer);
  const size = Math.max(b[2] - b[0], b[3] - b[1]);
  const pad = size * 0.08;
  return (
    <svg
      className="thumb"
      viewBox={`${b[0] - pad} ${-b[3] - pad} ${size + 2 * pad} ${size + 2 * pad}`}
      aria-hidden="true"
    >
      <path
        d={ringsPath([outer, ...holes])}
        fillRule="evenodd"
        className="sheet-thumb"
        strokeWidth={size * 0.03}
      />
    </svg>
  );
}

function SheetList() {
  const { project, edit, unit, openImport } = useStudio();
  const sheets = project.stock.sheets;
  const [selected, setSelected] = useState<string>();
  const setSheets = (change: (sheets: SheetEntry[]) => SheetEntry[], key?: string) =>
    edit((current) => withStock(current, { sheets: change(current.stock.sheets) }), key);
  const update = (id: string, change: Partial<SheetEntry>, key?: string) =>
    setSheets(
      (all) => all.map((sheet) => (sheet.id === id ? { ...sheet, ...change } : sheet)),
      key,
    );
  const move = (id: string, step: number) =>
    setSheets((all) => {
      const from = all.findIndex((sheet) => sheet.id === id);
      const to = from + step;
      if (to < 0 || to >= all.length) return all;
      const moved = [...all];
      [moved[from], moved[to]] = [moved[to], moved[from]];
      return moved;
    });
  const add = () => {
    const sheet = newSheet(`Sheet ${sheets.length + 1}`, 3000, 1500);
    setSheets((all) => [...all, sheet]);
    setSelected(sheet.id);
  };
  const count = copyCount(sheets);
  return (
    <>
      <p className="muted pad">
        Parts nest into the sheets from the top of the list down, onto as few as possible. The last
        sheet is cut where its parts end; the rest of it stays a remnant.
        {!usesSparrowPro && (
          <>
            {' '}
            Nesting into sheets needs sparrow pro. <ProTag />
          </>
        )}
      </p>
      <div className="list-head">
        <span className="label">
          {sheets.length} {sheets.length === 1 ? 'entry' : 'entries'} · {count}{' '}
          {count === 1 ? 'sheet' : 'sheets'}
        </span>
        <span className="row-actions">
          <ImportMenu kind="sheets" />
          <button className="small" onClick={add}>
            + New
          </button>
        </span>
      </div>
      <div className="list-scroll">
        {!sheets.length && (
          <div className="empty">
            <p>No sheets yet.</p>
            <p className="muted">
              Add the sheets you have in stock, in the order to use them: rectangles, or outlines of
              remnants from DXF or SVG files.
            </p>
            <div className="row-actions wrap">
              <button onClick={add}>Add a sheet</button>
              <button onClick={() => openImport('sheets', 'files')}>Import files…</button>
              <button onClick={() => openImport('sheets', 'project')}>From another project…</button>
            </div>
          </div>
        )}
        {sheets.map((sheet, index) => {
          const rectangle = rectangleOf(sheet);
          return (
            <div key={sheet.id}>
              <button
                className={sheet.id === selected ? 'row selected' : 'row'}
                aria-expanded={sheet.id === selected}
                onClick={() => setSelected(sheet.id === selected ? undefined : sheet.id)}
              >
                <span className="order">{index + 1}</span>
                <SheetThumb sheet={sheet} />
                <span className="row-text">
                  <span>{sheet.name}</span>
                  <span className="muted mono">{sizeOf(sheet, unit)}</span>
                </span>
                <span className={sheet.quantity ? 'quantity' : 'quantity zero'}>
                  ×{sheet.quantity}
                </span>
              </button>
              {sheet.id === selected && (
                <div className="properties">
                  <label className="field">
                    Name
                    <input
                      value={sheet.name}
                      onChange={(event) =>
                        update(sheet.id, { name: event.target.value }, `sheet-name:${sheet.id}`)
                      }
                    />
                  </label>
                  {rectangle ? (
                    <>
                      <LengthInput
                        label="Length"
                        value={rectangle.width}
                        min={0}
                        max={LIMITS.extent}
                        onChange={(width) =>
                          update(
                            sheet.id,
                            { shape: { outer: { ...rectangle, width } } },
                            `sheet-length:${sheet.id}`,
                          )
                        }
                      />
                      <LengthInput
                        label="Width"
                        value={rectangle.height}
                        min={0}
                        max={LIMITS.extent}
                        onChange={(height) =>
                          update(
                            sheet.id,
                            { shape: { outer: { ...rectangle, height } } },
                            `sheet-width:${sheet.id}`,
                          )
                        }
                      />
                    </>
                  ) : (
                    <div className="field">
                      Outline
                      <span className="muted">
                        {sizeOf(sheet, unit)}, imported; it cannot be edited.
                      </span>
                    </div>
                  )}
                  <div className="field">
                    In stock
                    <div className="stepper">
                      <button
                        className="small"
                        aria-label="Fewer"
                        onClick={() =>
                          update(sheet.id, { quantity: Math.max(0, sheet.quantity - 1) })
                        }
                      >
                        −
                      </button>
                      <input
                        className="mono quantity-input"
                        type="number"
                        min={0}
                        aria-label={`Sheets of ${sheet.name} in stock`}
                        value={sheet.quantity}
                        onChange={(event) => {
                          const quantity = event.target.valueAsNumber;
                          if (Number.isInteger(quantity) && quantity >= 0)
                            update(sheet.id, { quantity }, `sheet-quantity:${sheet.id}`);
                        }}
                      />
                      <button
                        className="small"
                        aria-label="More"
                        onClick={() => update(sheet.id, { quantity: sheet.quantity + 1 })}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <ProRow>Defects and clamp zones</ProRow>
                  <div className="row-actions wrap">
                    <button
                      className="small"
                      disabled={index === 0}
                      onClick={() => move(sheet.id, -1)}
                    >
                      Move up
                    </button>
                    <button
                      className="small"
                      disabled={index === sheets.length - 1}
                      onClick={() => move(sheet.id, 1)}
                    >
                      Move down
                    </button>
                    <button
                      className="small"
                      onClick={() => {
                        const copy = { ...sheet, id: newId(), name: `${sheet.name} copy` };
                        setSheets((all) => [
                          ...all.slice(0, index + 1),
                          copy,
                          ...all.slice(index + 1),
                        ]);
                        setSelected(copy.id);
                      }}
                    >
                      Duplicate
                    </button>
                    <button
                      className="small danger"
                      onClick={() => {
                        setSheets((all) => all.filter((other) => other.id !== sheet.id));
                        setSelected(undefined);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Where each sheet entry is drawn: side by side in nesting order, bottoms aligned. */
function arrangeSheets(sheets: SheetEntry[]) {
  const boxes = sheets.map((sheet) => bounds(outline(sheet.shape).outer) as Box);
  const gap = Math.max(...boxes.map((b) => Math.max(b[2] - b[0], b[3] - b[1])), 1) * 0.12;
  let x = 0;
  const offsets = boxes.map((b) => {
    const offset: [number, number] = [x - b[0], -b[1]];
    x += b[2] - b[0] + gap;
    return offset;
  });
  const height = Math.max(...boxes.map((b) => b[3] - b[1]), 1);
  const extent: Box = [0, 0, Math.max(x - gap, 1), height];
  return { offsets, boxes, extent };
}

function SheetsCanvas() {
  const { project } = useStudio();
  const sheets = project.stock.sheets;
  const arrangement = useMemo(() => arrangeSheets(sheets), [sheets]);
  const [x0, y0, x1, y1] = arrangement.extent;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.08;
  return (
    <Canvas label="The sheets" extent={[x0 - pad, y0 - pad * 2, x1 + pad, y1 + pad * 2]}>
      {({ upp }) => (
        <>
          {sheets.map((sheet, index) => {
            const [dx, dy] = arrangement.offsets[index];
            const box = arrangement.boxes[index];
            const { outer, holes } = outline(sheet.shape);
            const d = ringsPath([outer, ...holes], dx, dy);
            // Sheets in stock beyond the first show as outlines stacked behind it.
            const behind = Math.min(sheet.quantity, 3) - 1;
            const step = 8 * upp;
            return (
              <g key={sheet.id} opacity={sheet.quantity ? 1 : 0.4}>
                {Array.from({ length: Math.max(0, behind) }, (_, i) => (
                  <path
                    key={i}
                    d={d}
                    transform={`translate(${(behind - i) * step} ${-(behind - i) * step})`}
                    fill="var(--sheet)"
                    className="sheet-edge"
                    strokeWidth={upp}
                  />
                ))}
                <path
                  d={d}
                  fillRule="evenodd"
                  fill="var(--sheet)"
                  className="sheet-edge"
                  strokeWidth={2 * upp}
                />
                <text
                  className="sheet-label"
                  x={box[0] + dx}
                  y={-(box[3] + dy) - (behind * 8 + 8) * upp}
                  fontSize={12 * upp}
                >
                  {index + 1} · {sheet.name} · ×{sheet.quantity}
                </text>
              </g>
            );
          })}
          {!sheets.length && (
            <text x={50} y={-50} fontSize={14 * upp} textAnchor="middle" className="muted-text">
              Sheets appear here in nesting order.
            </text>
          )}
        </>
      )}
    </Canvas>
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
