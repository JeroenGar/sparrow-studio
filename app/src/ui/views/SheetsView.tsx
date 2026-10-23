import { useEffect, useId, useState } from 'react';
import { flattenContour, outline, type Contour } from '../../engine/geometry/contour';
import { bounds, isSimpleRing } from '../../engine/geometry/normalize';
import { LIMITS, newId, type Point } from '../../engine/model';
import type { DisplayUnit } from '../../engine/units';
import type { SheetsPlace, StripPlace } from '../../project/layout';
import {
  copyCount,
  newSheet,
  rectangleOf,
  type ProjectDocument,
  type SheetEntry,
  type Stock,
} from '../../project/model';
import { ringsPath, type CanvasTool } from '../Canvas';
import { usesSparrowPro } from '../client';
import { ProTag } from '../ProTag';
import { useStudio } from '../context';
import { Editable } from '../Editable';
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

/** The selected sheet entry and the tool drawing on it, kept for the shared canvas of Parts and Sheets. */
export function useSheetSelection(): Selection {
  const { project } = useStudio();
  const [chosen, setSelected] = useState<string>();
  const [held, setTool] = useState<Tool>();
  // A sheet that is gone, such as after undo, is no longer selected, nor drawn on.
  const selected = project.stock.sheets.some((sheet) => sheet.id === chosen) ? chosen : undefined;
  // Choosing another sheet puts the tool down.
  return {
    selected,
    select: (id) => {
      setSelected(id);
      setTool(undefined);
    },
    tool: selected ? held : undefined,
    setTool,
  };
}

/** The Sheets tab's list: what parts nest into, the strip or the sheets in their order. */
export function SheetsList(selection: Selection) {
  const { project, edit } = useStudio();
  const packing = project.stock.packing;
  const { selected } = selection;
  // + and − change the selected sheet's stock, as they change a part's quantity.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!selected || packing !== 'sheets' || document.querySelector('dialog[open]')) return;
      if ((event.target as HTMLElement).closest('input, select, textarea, [contenteditable]'))
        return;
      const step =
        event.key === '+' || event.key === '='
          ? 1
          : event.key === '-' || event.key === '_'
            ? -1
            : 0;
      if (!step) return;
      event.preventDefault();
      edit(
        (current) =>
          updateSheet(current, selected, (sheet) => ({
            ...sheet,
            quantity: Math.max(0, sheet.quantity + step),
          })),
        `sheet-quantity:${selected}`,
      );
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  return (
    <section className="list-panel" aria-label="Sheets">
      <Editable>
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
      </Editable>
      {packing === 'strip' ? <StripList /> : <SheetList {...selection} />}
      <RunBar />
    </section>
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
          <Editable className="properties">
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
          </Editable>
        )}
      </div>
    </>
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
  const { project, edit, unit, openImport, readOnly } = useStudio();
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
          <Editable>
            <button className="small" onClick={add}>
              + New
            </button>
          </Editable>
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
            <Editable className="row-actions wrap">
              <button onClick={add}>Add a sheet</button>
              <button onClick={() => openImport('sheets', 'files')}>Import files…</button>
              <button onClick={() => openImport('sheets', 'project')}>From another project…</button>
            </Editable>
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
                draggable={!readOnly}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  setDragged({ id: sheet.id });
                }}
                onDragEnd={() => setDragged(undefined)}
                title={readOnly ? undefined : 'Drag to change the nesting order'}
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
                <Editable className="properties">
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
                </Editable>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
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

/**
 * The sheets on the shared canvas of Parts and Sheets, in their rows. While the Sheets tab is open
 * (`active`), a sheet is chosen by a click, moved in the order by dragging, and drawn on with the
 * defect tools; otherwise a click on one picks it for the Sheets tab (`onPick`).
 */
export function useSheetsLayer({
  selection,
  place,
  active,
  onPick,
}: {
  selection: Selection;
  place?: SheetsPlace;
  active: boolean;
  onPick: (id: string) => void;
}) {
  const { project, edit, showError, readOnly } = useStudio();
  const { selected, select, tool, setTool } = selection;
  const sheets = project.stock.sheets;
  const [draft, setDraft] = useState<Draft>({ corners: [] });
  const index = sheets.findIndex((sheet) => sheet.id === selected);

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
  const [dx, dy] = place && index >= 0 ? place.offsets[index] : [0, 0];
  // The selected sheet's own coordinates of a canvas point, to the millimetre.
  const local = ([x, y]: [number, number]): Point => [Math.round(x - dx), Math.round(y - dy)];
  // A press on a part, faded beside the sheets, goes to the part: it opens the Parts tab.
  const onPart = (event: { target: EventTarget }) =>
    !!(event.target as Element).closest('.part-shape');
  const canvasTool: CanvasTool | undefined =
    tool && index >= 0
      ? tool === 'rectangle'
        ? {
            down: (point, event) => {
              if (onPart(event)) return false;
              setDraft({ corners: [], from: local(point), at: local(point) });
            },
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
            down: (_, event) => !onPart(event),
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
  const movingIndex = moving ? sheets.findIndex((sheet) => sheet.id === moving.id) : -1;
  // Where the moved sheet would go, read like text: in the row under its middle, after every
  // other sheet of an earlier row and every one of that row whose middle lies left of its own.
  const landing = (() => {
    if (!place || !moving?.moved || movingIndex < 0) return undefined;
    const b = place.boxes[movingIndex];
    const mx = (b[0] + b[2]) / 2 + moving.at[0] - moving.from[0];
    const my = (b[1] + b[3]) / 2 + moving.at[1] - moving.from[1];
    const spans = new Map<number, [number, number]>();
    place.boxes.forEach((box, i) => {
      const [low, high] = spans.get(place.rows[i]) ?? [box[1], box[3]];
      spans.set(place.rows[i], [Math.min(low, box[1]), Math.max(high, box[3])]);
    });
    const off = ([low, high]: [number, number]) =>
      my < low ? low - my : my > high ? my - high : 0;
    const row = [...spans].reduce((best, entry) =>
      off(entry[1]) < off(best[1]) ? entry : best,
    )[0];
    const others = place.boxes
      .map((box, i) => ({ box, row: place.rows[i] }))
      .filter((_, i) => i !== movingIndex);
    const before = others.filter(
      (o) => o.row < row || (o.row === row && (o.box[0] + o.box[2]) / 2 < mx),
    );
    const at = before.length;
    // The marker stands in the gap the sheet would land in, in that row.
    const left = before.at(-1)?.row === row ? before.at(-1)!.box[2] + place.gap / 2 : undefined;
    const right = others[at]?.row === row ? others[at].box[0] - place.gap / 2 : undefined;
    const [low, high] = spans.get(row)!;
    return { at, x: left ?? right ?? b[0], low, high };
  })();
  const reorder: CanvasTool = {
    // The sheet drawn under the pointer, its outline, copies or name; elsewhere the canvas pans.
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
              m.moved ||
              Math.hypot(point[0] - m.from[0], point[1] - m.from[1]) >
                (place ? place.extent[2] - place.extent[0] : 1000) * 0.005,
          },
      ),
    up: () => {
      if (!moving) return;
      if (moving.moved && landing) edit((current) => moveSheet(current, moving.id, landing.at));
      else if (!moving.moved) select(moving.id === selected ? undefined : moving.id);
      setMoving(undefined);
    },
  };

  const draftRing: Point[] | undefined =
    draft.from && draft.at
      ? [draft.from, [draft.at[0], draft.from[1]], draft.at, [draft.from[0], draft.at[1]]]
      : draft.corners.length
        ? [...draft.corners, ...(draft.at ? [draft.at] : [])]
        : undefined;

  // Each entry in stock is numbered in the order it is nested in; one without stock is skipped.
  const order = sheets.map((sheet, i) =>
    sheet.quantity ? sheets.slice(0, i + 1).filter((other) => other.quantity).length : undefined,
  );
  const draw = (upp: number) =>
    place && (
      <>
        {sheets.map((sheet, i) => {
          const [ox, oy] = place.offsets[i];
          const box = place.boxes[i];
          const { outer, holes } = outline(sheet.shape);
          const d = ringsPath([outer, ...holes], ox, oy);
          // Sheets in stock beyond the first show as outlines stacked behind it.
          const behind = Math.max(0, Math.min(sheet.quantity, 3) - 1);
          const step = 8 * upp;
          const chosen = active && sheet.id === selected;
          const lifted = moving?.moved && moving.id === sheet.id;
          const number = order[i];
          const label = number === undefined ? `${sheet.name} · none in stock` : sheet.name;
          return (
            <g
              key={sheet.id}
              data-sheet={sheet.id}
              opacity={lifted ? 0.7 : 1}
              transform={
                lifted
                  ? `translate(${moving.at[0] - moving.from[0]} ${-(moving.at[1] - moving.from[1])})`
                  : undefined
              }
              style={
                !active
                  ? { cursor: 'pointer' }
                  : tool || readOnly
                    ? undefined
                    : { cursor: lifted ? 'grabbing' : 'grab' }
              }
              onClick={active ? undefined : () => onPick(sheet.id)}
            >
              {Array.from({ length: behind }, (_, k) => (
                <path
                  key={k}
                  d={d}
                  transform={`translate(${(behind - k) * step} ${-(behind - k) * step})`}
                  fillRule="evenodd"
                  fill="var(--sheet)"
                  className="sheet-edge behind"
                  strokeWidth={upp}
                />
              ))}
              <path
                d={d}
                fillRule="evenodd"
                fill={number === undefined ? 'none' : 'var(--sheet)'}
                className={chosen ? 'sheet-edge selected' : 'sheet-edge'}
                strokeWidth={(chosen ? 3 : number === undefined ? 1 : 2) * upp}
                strokeDasharray={number === undefined ? `${6 * upp} ${5 * upp}` : undefined}
              />
              {(sheet.defects ?? []).map((defect, k) => (
                <path
                  key={k}
                  d={ringsPath([flattenContour(defect, upp / 4)], ox, oy)}
                  className="defect"
                  strokeWidth={upp}
                />
              ))}
              {number !== undefined && (
                <SheetBadge
                  x={box[0]}
                  y={-box[3]}
                  text={`#${number}`}
                  upp={upp}
                  className={chosen ? 'order-badge selected' : 'order-badge'}
                />
              )}
              {sheet.quantity > 1 && (
                <SheetBadge
                  x={box[2] + behind * step}
                  y={-box[3] - behind * step}
                  text={`×${sheet.quantity}`}
                  upp={upp}
                  className="stock-badge"
                />
              )}
              {/* Its name below it, where it fits at this zoom, clear of its neighbours. */}
              {(box[2] - box[0]) / upp > label.length * 7 &&
                (place.gap / upp > 17 || place.rows[i] === place.rows.at(-1)) && (
                  <text
                    className={chosen ? 'sheet-label selected' : 'sheet-label'}
                    x={(box[0] + box[2]) / 2}
                    y={-box[1] + 14 * upp}
                    fontSize={12 * upp}
                    textAnchor="middle"
                  >
                    {label}
                  </text>
                )}
            </g>
          );
        })}
        {landing && (
          <path
            d={`M${landing.x} ${-landing.high}V${-landing.low}`}
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
          <text
            x={(place.extent[0] + place.extent[2]) / 2}
            y={-place.extent[3]}
            fontSize={14 * upp}
            textAnchor="middle"
            className="muted-text"
          >
            Sheets appear here in nesting order.
          </text>
        )}
      </>
    );
  return {
    // Sheets only shown keep their order.
    tool: active && place ? (canvasTool ?? (tool || readOnly ? undefined : reorder)) : undefined,
    hint:
      sheets.length > 1
        ? `Nested in this order, #1 first.${readOnly ? '' : ' Drag a sheet to move it.'}`
        : undefined,
    draw,
  };
}

/** A small label in a pill, centred on a corner of a sheet: its place in the order, or its stock. */
function SheetBadge({
  x,
  y,
  text,
  upp,
  className,
}: {
  x: number;
  y: number;
  text: string;
  upp: number;
  className: string;
}) {
  const width = (text.length * 6.5 + 12) * upp;
  const height = 18 * upp;
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={height / 2}
        className={className}
        strokeWidth={upp}
      />
      <text
        className={`${className.split(' ')[0]}-text`}
        fontSize={10.5 * upp}
        textAnchor="middle"
        dy={3.8 * upp}
      >
        {text}
      </text>
    </g>
  );
}

/** The strip on the shared canvas: as wide as set, fading out where its length is open. */
export function StripLayer({
  place,
  upp,
  unit,
  active,
  onPick,
}: {
  place: StripPlace;
  upp: number;
  unit: DisplayUnit;
  active: boolean;
  onPick: () => void;
}) {
  const [left, bottom] = place.box;
  return (
    <g
      transform={`translate(${left} ${-bottom})`}
      style={active ? undefined : { cursor: 'pointer' }}
      onClick={active ? undefined : onPick}
    >
      <StripDrawing width={place.width} length={place.length} upp={upp} unit={unit} />
    </g>
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
