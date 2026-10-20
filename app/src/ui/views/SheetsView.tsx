import { useEffect, useId, useMemo, useState } from 'react';
import { flattenContour, outline, type Contour } from '../../engine/geometry/contour';
import { bounds, isSimpleRing } from '../../engine/geometry/normalize';
import { netArea } from '../../engine/geometry/world';
import { LIMITS, newId, type Point } from '../../engine/model';
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
import { Canvas, ringsPath, type CanvasTool } from '../Canvas';
import { usesSparrowPro } from '../client';
import { ProTag } from '../ProTag';
import { useStudio } from '../context';
import { formatLength } from '../format';
import { ImportMenu } from '../ImportMenu';
import { LengthInput } from '../LengthInput';
import { RunBar } from '../RunBar';

const withStock = (project: ProjectDocument, change: Partial<Stock>): ProjectDocument => ({
  ...project,
  stock: { ...project.stock, ...change },
});

/** A defect tool: drag a rectangle, or click the corners of a freeform region. */
type Tool = 'rectangle' | 'freeform';
/** The selected sheet entry, and the tool drawing on it, if any. */
type Selection = {
  selected?: string;
  select: (id: string | undefined) => void;
  tool?: Tool;
  setTool: (tool: Tool | undefined) => void;
};

/** Moves a sheet entry to `to`, its place in the list without it. */
function moveSheet(project: ProjectDocument, id: string, to: number): ProjectDocument {
  const from = project.stock.sheets.findIndex((other) => other.id === id);
  const sheet = project.stock.sheets[from];
  // Unchanged, it is no edit: undo and redo stay as they are.
  if (!sheet || from === to) return project;
  const rest = project.stock.sheets.filter((other) => other.id !== id);
  return withStock(project, { sheets: [...rest.slice(0, to), sheet, ...rest.slice(to)] });
}

/** Changes one sheet entry. */
const updateSheet = (
  project: ProjectDocument,
  id: string,
  change: (sheet: SheetEntry) => SheetEntry,
): ProjectDocument =>
  withStock(project, {
    sheets: project.stock.sheets.map((sheet) => (sheet.id === id ? change(sheet) : sheet)),
  });

export function SheetsView() {
  const { project, edit } = useStudio();
  const packing = project.stock.packing;
  const [chosen, setSelected] = useState<string>();
  const [held, setTool] = useState<Tool>();
  // A sheet that is gone, such as after undo, is no longer selected, nor drawn on.
  const selected = project.stock.sheets.some((sheet) => sheet.id === chosen) ? chosen : undefined;
  const tool = selected ? held : undefined;
  // Choosing another sheet puts the tool down.
  const selection: Selection = {
    selected,
    select: (id) => {
      setSelected(id);
      setTool(undefined);
    },
    tool,
    setTool,
  };
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
        {packing === 'strip' ? <StripList /> : <SheetList {...selection} />}
        <RunBar />
      </section>
      {packing === 'strip' ? <StripCanvas /> : <SheetsCanvas {...selection} />}
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

function SheetList({ selected, select: setSelected, tool, setTool }: Selection) {
  const { project, edit, unit, openImport } = useStudio();
  const sheets = project.stock.sheets;
  const setSheets = (change: (sheets: SheetEntry[]) => SheetEntry[], key?: string) =>
    edit((current) => withStock(current, { sheets: change(current.stock.sheets) }), key);
  const update = (id: string, change: Partial<SheetEntry>, key?: string) =>
    setSheets(
      (all) => all.map((sheet) => (sheet.id === id ? { ...sheet, ...change } : sheet)),
      key,
    );
  const move = (id: string, to: number) => edit((current) => moveSheet(current, id, to));
  // A row being dragged, and where it would land: before the row of that index.
  const [dragged, setDragged] = useState<{ id: string; before?: number }>();
  const drop = () => {
    if (dragged?.before === undefined) return setDragged(undefined);
    const from = sheets.findIndex((sheet) => sheet.id === dragged.id);
    move(dragged.id, dragged.before > from ? dragged.before - 1 : dragged.before);
    setDragged(undefined);
  };
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
            <div
              key={sheet.id}
              className={
                dragged?.before === index
                  ? 'drop-before'
                  : dragged?.before === sheets.length && index === sheets.length - 1
                    ? 'drop-after'
                    : undefined
              }
              onDragOver={(event) => {
                if (!dragged) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const below = event.clientY > rect.top + Math.min(rect.height, 56) / 2;
                setDragged({ ...dragged, before: index + (below ? 1 : 0) });
              }}
              onDrop={(event) => {
                event.preventDefault();
                drop();
              }}
            >
              <button
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  setDragged({ id: sheet.id });
                }}
                onDragEnd={() => setDragged(undefined)}
                title="Drag to change the nesting order"
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
                  <div className="field">
                    Defects
                    <span className="muted">
                      Regions parts avoid on every sheet of this entry, such as flaws.
                    </span>
                    {(sheet.defects ?? []).map((defect, i) => (
                      <div className="defect-row" key={i}>
                        <span className="mono grow">{describeDefect(defect, unit)}</span>
                        <button
                          className="small danger"
                          onClick={() =>
                            update(sheet.id, {
                              defects: sheet.defects!.filter((_, other) => other !== i),
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <div className="row-actions">
                      {(['rectangle', 'freeform'] as const).map((kind) => (
                        <button
                          key={kind}
                          className="small"
                          aria-pressed={tool === kind}
                          onClick={() => setTool(tool === kind ? undefined : kind)}
                        >
                          {kind === 'rectangle' ? 'Draw rectangle' : 'Draw freeform'}
                        </button>
                      ))}
                    </div>
                    {tool && (
                      <span className="muted">
                        {tool === 'rectangle'
                          ? 'Drag on the sheet to draw a rectangle.'
                          : 'Click the corners on the sheet; double-click to finish. Escape cancels.'}
                      </span>
                    )}
                  </div>
                  <div className="row-actions wrap">
                    <button
                      className="small"
                      disabled={index === 0}
                      onClick={() => move(sheet.id, index - 1)}
                    >
                      Move up
                    </button>
                    <button
                      className="small"
                      disabled={index === sheets.length - 1}
                      onClick={() => move(sheet.id, index + 1)}
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
  // Each sheet where it is drawn.
  const placed = boxes.map((b, i): Box => {
    const [dx, dy] = offsets[i];
    return [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
  });
  return { offsets, boxes, placed, gap, extent };
}

/** An arrow across the gap from one sheet to the next, at height `y`. */
function orderArrow(from: number, to: number, y: number, upp: number) {
  const [a, b] = [from + (to - from) * 0.25, from + (to - from) * 0.75];
  const head = Math.min(8 * upp, (b - a) / 2);
  return `M${a} ${-y}H${b}M${b - head} ${-y - head}L${b} ${-y}L${b - head} ${-y + head}`;
}

/** A defect in a few words: a rectangle by its size and corner, or freeform by its corners. */
function describeDefect(defect: Contour, unit: DisplayUnit): string {
  const at = (mm: number) => formatLength(mm, unit);
  if (defect.type === 'rectangle')
    return `${at(defect.width)} × ${at(defect.height)} ${unit} at ${at(defect.x_min)}, ${at(defect.y_min)}`;
  const corners = flattenContour(defect, 0.1).length;
  return `Freeform, ${corners} corners`;
}

/**
 * The defect being drawn on the selected sheet, in its coordinates: a rectangle from where the
 * drag started, or the corners clicked so far; `at` follows the pointer.
 */
type Draft = { from?: Point; corners: Point[]; at?: Point };

function SheetsCanvas({ selected, select, tool, setTool }: Selection) {
  const { project, edit, showError } = useStudio();
  const sheets = project.stock.sheets;
  const arrangement = useMemo(() => arrangeSheets(sheets), [sheets]);
  const [draft, setDraft] = useState<Draft>({ corners: [] });
  const index = sheets.findIndex((sheet) => sheet.id === selected);
  const [x0, y0, x1, y1] = arrangement.extent;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.08;

  // Putting the tool down, or choosing another one, drops the draft; Escape puts it down.
  useEffect(() => {
    setDraft({ corners: [] });
    if (!tool) return;
    const key = (event: KeyboardEvent) => event.key === 'Escape' && setTool(undefined);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [tool, selected]);

  const add = (defect: Contour) => {
    edit((current) =>
      updateSheet(current, selected!, (sheet) => ({
        ...sheet,
        defects: [...(sheet.defects ?? []), defect],
      })),
    );
    setTool(undefined);
  };
  const [dx, dy] = index >= 0 ? arrangement.offsets[index] : [0, 0];
  // The selected sheet's own coordinates of a canvas point, to the millimetre.
  const local = ([x, y]: [number, number]): Point => [Math.round(x - dx), Math.round(y - dy)];
  const canvasTool: CanvasTool | undefined =
    tool && index >= 0
      ? tool === 'rectangle'
        ? {
            down: (point) => setDraft({ corners: [], from: local(point), at: local(point) }),
            move: (point) => setDraft((d) => (d.from ? { ...d, at: local(point) } : d)),
            cancel: () => setDraft({ corners: [] }),
            up: (point) => {
              const from = draft.from;
              const [ax, ay] = local(point);
              setDraft({ corners: [] });
              if (!from) return;
              const [width, height] = [Math.abs(ax - from[0]), Math.abs(ay - from[1])];
              if (width > 0 && height > 0)
                add({
                  type: 'rectangle',
                  x_min: Math.min(ax, from[0]),
                  y_min: Math.min(ay, from[1]),
                  width,
                  height,
                });
            },
          }
        : {
            move: (point) => setDraft((d) => ({ ...d, at: local(point) })),
            up: (point) => setDraft((d) => ({ ...d, corners: [...d.corners, local(point)] })),
            double: () => {
              // A double-click clicked twice: its second click added a corner too many.
              const corners = draft.corners
                .slice(0, -1)
                .filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]);
              setDraft({ corners: [] });
              if (isSimpleRing(corners)) add({ type: 'polygon', points: corners });
              else
                showError(
                  'A freeform defect needs three corners or more, and its edges must not cross. Draw it again.',
                );
            },
          }
      : undefined;

  // Without a defect tool, dragging a sheet moves it in the nesting order; a click selects it.
  const [moving, setMoving] = useState<{ id: string; from: Point; at: Point; moved: boolean }>();
  const others = moving ? arrangement.placed.filter((_, i) => sheets[i].id !== moving.id) : [];
  const movingIndex = moving ? sheets.findIndex((sheet) => sheet.id === moving.id) : -1;
  // Where the moved sheet would go: after every other sheet whose middle lies left of its own.
  const target =
    moving && movingIndex >= 0
      ? (() => {
          const b = arrangement.placed[movingIndex];
          const middle = (b[0] + b[2]) / 2 + moving.at[0] - moving.from[0];
          return others.filter((o) => (o[0] + o[2]) / 2 < middle).length;
        })()
      : -1;
  const reorder: CanvasTool = {
    // The sheet drawn under the pointer, its outline, copies or label; elsewhere the canvas pans.
    down: (point, event) => {
      const id = (event.target as Element).closest<SVGElement>('[data-sheet]')?.dataset.sheet;
      if (!id) return false;
      setMoving({ id, from: point, at: point, moved: false });
    },
    cancel: () => setMoving(undefined),
    move: (point) =>
      setMoving(
        (m) =>
          m && {
            ...m,
            at: point,
            moved:
              m.moved || Math.hypot(point[0] - m.from[0], point[1] - m.from[1]) > (x1 - x0) * 0.005,
          },
      ),
    up: () => {
      if (!moving) return;
      if (moving.moved) edit((current) => moveSheet(current, moving.id, target));
      else select(moving.id === selected ? undefined : moving.id);
      setMoving(undefined);
    },
  };
  // Where the moved sheet would land, between the sheets it would stand between.
  const marker =
    moving?.moved && target >= 0
      ? target === 0
        ? (others[0]?.[0] ?? 0) - arrangement.gap / 2
        : others[target - 1][2] + arrangement.gap / 2
      : undefined;

  const draftRing: Point[] | undefined =
    draft.from && draft.at
      ? [draft.from, [draft.at[0], draft.from[1]], draft.at, [draft.from[0], draft.at[1]]]
      : draft.corners.length
        ? [...draft.corners, ...(draft.at ? [draft.at] : [])]
        : undefined;

  return (
    <Canvas
      label="The sheets"
      extent={[x0 - pad, y0 - pad * 2, x1 + pad, y1 + pad * 2]}
      tool={canvasTool ?? (tool ? undefined : reorder)}
      onBackgroundClick={() => !tool && select(undefined)}
      toolbar={
        sheets.length > 1 && (
          <span className="chip">
            Nested in this order: sheet 1 first. Drag a sheet to move it in the order.
          </span>
        )
      }
    >
      {({ upp }) => (
        <>
          {sheets.map((sheet, i) => {
            const [ox, oy] = arrangement.offsets[i];
            const box = arrangement.boxes[i];
            const { outer, holes } = outline(sheet.shape);
            const d = ringsPath([outer, ...holes], ox, oy);
            // Sheets in stock beyond the first show as outlines stacked behind it.
            const behind = Math.min(sheet.quantity, 3) - 1;
            const step = 8 * upp;
            const chosen = sheet.id === selected;
            const lifted = moving?.moved && moving.id === sheet.id;
            const next = arrangement.placed[i + 1];
            return (
              <g
                key={sheet.id}
                data-sheet={sheet.id}
                opacity={sheet.quantity ? (lifted ? 0.7 : 1) : 0.4}
                transform={
                  lifted
                    ? `translate(${moving.at[0] - moving.from[0]} ${-(moving.at[1] - moving.from[1])})`
                    : undefined
                }
                style={tool ? undefined : { cursor: lifted ? 'grabbing' : 'grab' }}
              >
                {/* An arrow to the next sheet in the order. */}
                {next && !moving?.moved && (
                  <path
                    d={orderArrow(
                      arrangement.placed[i][2] + Math.max(0, behind) * step,
                      next[0],
                      Math.min(arrangement.placed[i][3], next[3]) / 2,
                      upp,
                    )}
                    className="order-arrow"
                    strokeWidth={1.5 * upp}
                    fill="none"
                    pointerEvents="none"
                  />
                )}
                {Array.from({ length: Math.max(0, behind) }, (_, k) => (
                  <path
                    key={k}
                    d={d}
                    transform={`translate(${(behind - k) * step} ${-(behind - k) * step})`}
                    fill="var(--sheet)"
                    className="sheet-edge"
                    strokeWidth={upp}
                  />
                ))}
                <path
                  d={d}
                  fillRule="evenodd"
                  fill="var(--sheet)"
                  className={chosen ? 'sheet-edge selected' : 'sheet-edge'}
                  strokeWidth={(chosen ? 3 : 2) * upp}
                />
                {(sheet.defects ?? []).map((defect, k) => (
                  <path
                    key={k}
                    d={ringsPath([flattenContour(defect, upp / 4)], ox, oy)}
                    className="defect"
                    strokeWidth={upp}
                  />
                ))}
                <text
                  className="sheet-label"
                  x={box[0] + ox}
                  y={-(box[3] + oy) - (behind * 8 + 8) * upp}
                  fontSize={12 * upp}
                >
                  {i + 1} · {sheet.name} · ×{sheet.quantity}
                </text>
              </g>
            );
          })}
          {marker !== undefined && (
            <path
              d={`M${marker} ${-y1 - pad}V${pad}`}
              className="accent-line"
              strokeWidth={3 * upp}
              pointerEvents="none"
            />
          )}
          {draftRing && (
            <path
              d={
                draft.from
                  ? ringsPath([draftRing], dx, dy)
                  : `M${draftRing.map(([x, y]) => `${x + dx},${-(y + dy)}`).join('L')}`
              }
              className="defect draft"
              strokeWidth={upp}
              pointerEvents="none"
            />
          )}
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
