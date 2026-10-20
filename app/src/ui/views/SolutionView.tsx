import { useMemo, useState } from 'react';
import { worldParts, type WorldPart } from '../../engine/geometry/world';
import { geometryTask } from '../../engine/workers/geometryTask';
import { projectFileName } from '../../project/file';
import { drawable, isStale } from '../../project/solution';
import { Canvas } from '../Canvas';
import { ProRow } from '../ProTag';
import { useStudio } from '../context';
import { download } from '../download';
import { withKind } from '../../api/client';
import { explainDiagnostic } from '../explain';
import { formatArea, formatLength, formatPercent, formatSeconds } from '../format';
import { serializeProject } from '../../project/file';
import { RunBar } from '../RunBar';
import { LayoutDrawing, placementKey, stackLayouts } from './LayoutDrawing';
import { PartThumb } from './PartsView';

type Format = 'svg' | 'dxf' | 'pdf';
type Hover = { part: WorldPart; x: number; y: number };

/** The names of the project's parts and sheet entries, by ID. */
export function useNames() {
  const { project } = useStudio();
  return useMemo(
    () =>
      new Map(
        [...project.parts, ...project.stock.sheets].map((item) => [item.id, item.name] as const),
      ),
    [project.parts, project.stock.sheets],
  );
}

export function SolutionView() {
  const { project, unit, showError } = useStudio();
  const solution = project.solutions[0];
  const document = solution?.document;
  const outcome = document?.outcome;
  const [highlight, setHighlight] = useState<string>();
  const [hover, setHover] = useState<Hover>();
  const [busy, setBusy] = useState<Format>();
  // The layout chosen in the list: downloads are of it, and the canvas zooms to it.
  const [chosen, setChosen] = useState({ index: 0, serial: 0 });
  const names = useNames();
  const drawn = useMemo(
    () =>
      document && outcome
        ? drawable(document.input, outcome.solution, names, outcome.stats)
        : undefined,
    [document, outcome, names],
  );
  const worlds = useMemo(
    () => drawn?.layouts.map((layout) => worldParts(drawn.job, layout.result)) ?? [],
    [drawn],
  );
  const stack = useMemo(
    () =>
      drawn &&
      stackLayouts(
        drawn.job,
        drawn.layouts,
        drawn.layouts.map((layout) => layout.result.usedLengthMm),
      ),
    [drawn],
  );
  const stale = useMemo(() => !!document && isStale(project, document), [document, project]);

  if (!solution || !document || !outcome || !drawn || !stack)
    return (
      <div className="view">
        <section className="list-panel" aria-label="Solution">
          <div className="list-head">
            <span className="label">Solution</span>
          </div>
          <div className="list-scroll">
            <div className="empty">
              <p>No solution yet.</p>
              <p className="muted">
                Start nesting. The best valid layout appears here when the run ends.
              </p>
            </div>
          </div>
          <RunBar />
        </section>
        <section className="explanation" aria-label="No solution" />
      </div>
    );

  const { job, layouts } = drawn;
  const { stats } = outcome;
  const onSheets = document.input.problem.type === 'minimize_sheets_in_order';
  const index = Math.min(chosen.index, Math.max(0, layouts.length - 1));
  const layout = layouts[index];
  const waste = stats.consumed_area - stats.placed_area;
  const state = document.state;
  const placedCopies = layouts.reduce((n, l) => n + l.result.placements.length, 0);
  const unplacedCopies = outcome.unplaced.reduce((n, u) => n + u.quantity, 0);
  const placedOf = (partId: string) =>
    layouts.reduce((n, l) => n + l.result.placements.filter((p) => p.partId === partId).length, 0);
  // Parts with copies that fit on no empty sheet: the unplaced list says so for each.
  const tooLarge = new Set(
    outcome.diagnostics.flatMap((d) => withKind(d, 'no_valid_placement')?.part_id ?? []),
  );
  const notes = outcome.diagnostics.flatMap((diagnostic) =>
    withKind(diagnostic, 'no_valid_placement')
      ? []
      : (explainDiagnostic(diagnostic, names, unit) ?? []),
  );
  const [x0, y0, x1, y1] = stack.extent;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.05;

  async function exportLayout(format: Format) {
    if (!layout) return;
    setBusy(format);
    try {
      const reply = await geometryTask({
        type: 'export',
        runId: 1,
        documentRevision: 1,
        document: { ...job, name: project.name },
        result: layout.result,
        utilization: (layout.stats?.density ?? stats.density) * 100,
        sheet: layout.sheet,
      });
      if (reply.type !== 'export-result') throw Error('Could not export the layout.');
      const base = layouts.length > 1 ? `${project.name} sheet ${index + 1}` : project.name;
      const name = projectFileName(base, format);
      if (format === 'pdf') {
        const { exportPDF } = await import('../../engine/export/pdf');
        download(name, await exportPDF(reply.bundle.svg), 'application/pdf');
      } else
        download(
          name,
          reply.bundle[format],
          format === 'svg' ? 'image/svg+xml' : 'application/dxf',
        );
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }
  function diagnostics() {
    download(
      'sparrow-studio-diagnostics.json',
      JSON.stringify({ project: JSON.parse(serializeProject(project)), job: document }, null, 2),
      'application/json',
    );
  }

  const hovered = hover?.part;
  const hoveredPlacement =
    hovered &&
    layouts
      .flatMap((l) => l.result.placements)
      .find((p) => placementKey(p) === placementKey(hovered));
  const choose = (i: number) => setChosen(({ serial }) => ({ index: i, serial: serial + 1 }));

  return (
    <div className="view">
      <section className="list-panel" aria-label="Solution">
        <div className="list-head">
          <span className="label">Solution</span>
          <span className="muted">{new Date(solution.createdAt).toLocaleString()}</span>
        </div>
        <div className="list-scroll">
          <div className="summary">
            <div className="metrics">
              <div className="metric">
                <span className="metric-value">{formatPercent(stats.density * 100)}</span>
                <span className="muted">utilization</span>
              </div>
              {onSheets ? (
                <div className="metric">
                  <span className="metric-value">{layouts.length}</span>
                  <span className="muted">{layouts.length === 1 ? 'sheet' : 'sheets'} used</span>
                </div>
              ) : (
                <div className="metric">
                  <span className="metric-value">
                    {formatLength(layout?.result.usedLengthMm ?? 0, unit)} <small>{unit}</small>
                  </span>
                  <span className="muted">length used</span>
                </div>
              )}
            </div>
            <dl className="facts">
              {!onSheets && (
                <>
                  <dt>Strip</dt>
                  <dd>
                    {formatLength(job.settings.materialWidthMm, unit)} ×{' '}
                    {formatLength(layout?.result.usedLengthMm ?? 0, unit)} {unit}
                  </dd>
                </>
              )}
              <dt>Waste</dt>
              <dd>{formatArea(waste, unit)}</dd>
              <dt>Placed</dt>
              <dd>
                {placedCopies} parts
                {unplacedCopies ? `, ${unplacedCopies} not placed` : ', all of them'}
              </dd>
              <dt>Run</dt>
              <dd>
                {state.status === 'completed' && state.termination === 'stopped'
                  ? 'Stopped'
                  : 'Finished'}{' '}
                after {formatSeconds(state.status === 'completed' ? state.solver_seconds : 0)}
              </dd>
            </dl>
            {unplacedCopies > 0 && (
              <div className="notice warning">
                <p>
                  {unplacedCopies} {unplacedCopies === 1 ? 'copy' : 'copies'} could not be placed:
                </p>
                <ul>
                  {outcome.unplaced.map((u) => (
                    <li key={u.part_id}>
                      {names.get(u.part_id) ?? 'A part'}: {u.quantity} not placed
                      {tooLarge.has(u.part_id) && ', as it fits nowhere on the material'}
                    </li>
                  ))}
                </ul>
                <p>
                  {tooLarge.size
                    ? 'Check that each part fits the material with the gap and the distance to the edge.'
                    : 'Add material, or lower the quantities, and start nesting again.'}
                </p>
              </div>
            )}
            {notes.length > 0 && (
              <div className="notice">
                <ul>
                  {notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
            {stale && (
              <p className="notice">
                The parts or settings changed since this run. Start nesting again to update the
                solution.
              </p>
            )}
            <span className="label">
              Download {layouts.length > 1 ? `sheet ${index + 1}` : 'the layout'}
            </span>
            <div className="downloads">
              {(['svg', 'dxf', 'pdf'] as Format[]).map((format) => (
                <button
                  key={format}
                  aria-label={`Download ${format.toUpperCase()}`}
                  disabled={!!busy || !layout}
                  onClick={() => void exportLayout(format)}
                >
                  {busy === format ? 'Preparing…' : format.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {onSheets && (
            <>
              <div className="list-head">
                <span className="label">Sheets in this solution</span>
              </div>
              {layouts.map((l, i) => (
                <button
                  key={i}
                  className={i === index ? 'row selected' : 'row'}
                  aria-pressed={i === index}
                  onClick={() => choose(i)}
                >
                  <span className="order">{i + 1}</span>
                  <span className="row-text">
                    <span>{l.name}</span>
                    <span className="muted">
                      {l.result.placements.length} parts
                      {l.stats && ` · ${formatPercent(l.stats.density * 100)}`}
                      {l.sheet?.cutX != null &&
                        ` · cut at ${formatLength(l.sheet.cutX, unit)} ${unit}`}
                    </span>
                  </span>
                </button>
              ))}
            </>
          )}
          <div className="list-head">
            <span className="label">Parts in this solution</span>
            {highlight && (
              <button className="small" onClick={() => setHighlight(undefined)}>
                Show all
              </button>
            )}
          </div>
          {job.parts.map((part, i) => (
            <button
              key={part.id}
              className={part.id === highlight ? 'row selected' : 'row'}
              aria-pressed={part.id === highlight}
              onClick={() => setHighlight(part.id === highlight ? undefined : part.id)}
            >
              <PartThumb part={part} index={i} />
              <span className="row-text">
                <span>{part.name}</span>
                <span className={placedOf(part.id) < part.quantity ? 'warning-text' : 'muted'}>
                  {placedOf(part.id)} of {part.quantity} placed
                </span>
              </span>
            </button>
          ))}
          <div className="pad stack">
            <ProRow>Lock placements and nest the rest again</ProRow>
            <ProRow>Compare several solutions</ProRow>
            <button className="small" onClick={diagnostics}>
              Download diagnostics
            </button>
          </div>
        </div>
        <RunBar />
      </section>
      <Canvas
        label="Solution layout"
        extent={[x0 - pad, y0 - pad, x1 + pad, y1 + pad]}
        focus={
          chosen.serial
            ? { box: stack.boxes[index], key: `${index}:${chosen.serial}`, margin: 0.08 }
            : undefined
        }
        onBackgroundClick={() => setHighlight(undefined)}
        toolbar={
          <span className="chip">
            Select a part type in the list to find its copies. Hover a part for details.
          </span>
        }
        overlay={
          hovered &&
          hoveredPlacement && (
            <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
              <strong>
                {names.get(hovered.partId)} · copy {hovered.copyIndex + 1}
              </strong>
              <span className="mono">
                {formatLength(hoveredPlacement.xMm, unit, 2)},{' '}
                {formatLength(hoveredPlacement.yMm, unit, 2)} {unit} ·{' '}
                {Number(hoveredPlacement.angleDeg.toFixed(2))}°
                {hoveredPlacement.mirrored && ' · mirrored'}
              </span>
            </div>
          )
        }
      >
        {({ upp }) =>
          layouts.map((l, i) => (
            <LayoutDrawing
              key={i}
              job={job}
              world={worlds[i]}
              sheet={l.sheet}
              usedLength={l.result.usedLengthMm}
              upp={upp}
              shift={stack.shifts[i]}
              label={onSheets ? `${i + 1} · ${l.name}` : undefined}
              highlight={highlight}
              hovered={hovered && placementKey(hovered)}
              onPick={(part) => setHighlight(part.partId === highlight ? undefined : part.partId)}
              onHover={(part, event) => {
                if (!part || !event) return setHover(undefined);
                const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
                setHover({ part, x: event.clientX - rect.left, y: event.clientY - rect.top });
              }}
            />
          ))
        }
      </Canvas>
    </div>
  );
}
