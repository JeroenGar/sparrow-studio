import { useMemo, useState } from 'react';
import { worldParts, type WorldPart } from '../../engine/geometry/validate';
import { geometryTask } from '../../engine/workers/geometryTask';
import { projectFileName } from '../../project/file';
import { drawable, isStale } from '../../project/solution';
import { Canvas } from '../Canvas';
import { ProRow } from '../ProTag';
import { useStudio } from '../context';
import { download } from '../download';
import { formatArea, formatLength, formatPercent, formatSeconds } from '../format';
import { serializeProject } from '../../project/file';
import { RunBar } from '../RunBar';
import { LayoutDrawing, placementKey } from './LayoutDrawing';
import { PartThumb } from './PartsView';

type Format = 'svg' | 'dxf' | 'pdf';
type Hover = { part: WorldPart; x: number; y: number };

export function SolutionView() {
  const { project, unit, showError } = useStudio();
  const solution = project.solutions[0];
  const document = solution?.document;
  const outcome = document?.outcome;
  const [highlight, setHighlight] = useState<string>();
  const [hover, setHover] = useState<Hover>();
  const [busy, setBusy] = useState<Format>();
  const names = useMemo(
    () => new Map(project.parts.map((part) => [part.id, part.name])),
    [project.parts],
  );
  const layout = useMemo(
    () =>
      document && outcome
        ? drawable(document.input, outcome.solution, names, outcome.stats.layouts[0]?.cut_x)
        : undefined,
    [document, outcome, names],
  );
  const world = useMemo(() => (layout ? worldParts(layout.job, layout.result) : []), [layout]);
  const stale = useMemo(() => !!document && isStale(project, document), [document, project]);

  if (!solution || !document || !outcome || !layout)
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

  const { job, result } = layout;
  const { stats } = outcome;
  const width = job.settings.materialWidthMm;
  const waste = stats.consumed_area - stats.placed_area;
  const placed = job.parts;
  const state = document.state;

  async function exportLayout(format: Format) {
    setBusy(format);
    try {
      const reply = await geometryTask({
        type: 'export',
        runId: 1,
        documentRevision: 1,
        document: { ...job, name: project.name },
        result,
      });
      if (reply.type !== 'export-result') throw Error('Could not export the layout.');
      const name = projectFileName(project.name, format);
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
    hovered && result.placements.find((p) => placementKey(p) === placementKey(hovered));

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
              <div className="metric">
                <span className="metric-value">
                  {formatLength(result.usedLengthMm, unit)} <small>{unit}</small>
                </span>
                <span className="muted">length used</span>
              </div>
            </div>
            <dl className="facts">
              <dt>Strip</dt>
              <dd>
                {formatLength(width, unit)} × {formatLength(result.usedLengthMm, unit)} {unit}
              </dd>
              <dt>Waste</dt>
              <dd>{formatArea(waste, unit)}</dd>
              <dt>Placed</dt>
              <dd>
                {result.placements.length} parts
                {outcome.unplaced.length
                  ? `, ${outcome.unplaced.reduce((n, u) => n + u.quantity, 0)} not placed`
                  : ', all of them'}
              </dd>
              <dt>Run</dt>
              <dd>
                {state.status === 'completed' && state.termination === 'stopped'
                  ? 'Stopped'
                  : 'Finished'}{' '}
                after {formatSeconds(state.status === 'completed' ? state.solver_seconds : 0)}
              </dd>
            </dl>
            {stale && (
              <p className="notice">
                The parts or settings changed since this run. Start nesting again to update the
                solution.
              </p>
            )}
            <span className="label">Download the layout</span>
            <div className="downloads">
              {(['svg', 'dxf', 'pdf'] as Format[]).map((format) => (
                <button
                  key={format}
                  aria-label={`Download ${format.toUpperCase()}`}
                  disabled={!!busy}
                  onClick={() => void exportLayout(format)}
                >
                  {busy === format ? 'Preparing…' : format.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="list-head">
            <span className="label">Parts in this solution</span>
            {highlight && (
              <button className="small" onClick={() => setHighlight(undefined)}>
                Show all
              </button>
            )}
          </div>
          {placed.map((part) => (
            <button
              key={part.id}
              className={part.id === highlight ? 'row selected' : 'row'}
              aria-pressed={part.id === highlight}
              onClick={() => setHighlight(part.id === highlight ? undefined : part.id)}
            >
              <PartThumb part={part} index={job.parts.indexOf(part)} />
              <span className="row-text">
                <span>{part.name}</span>
                <span className="muted">
                  {part.quantity} of {part.quantity} placed
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
        extent={[0, -width * 0.1, result.usedLengthMm * 1.05, width * 1.1]}
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
              </span>
            </div>
          )
        }
      >
        {({ upp }) => (
          <LayoutDrawing
            job={job}
            world={world}
            usedLength={result.usedLengthMm}
            upp={upp}
            highlight={highlight}
            hovered={hovered && placementKey(hovered)}
            onPick={(part) => setHighlight(part.partId === highlight ? undefined : part.partId)}
            onHover={(part, event) => {
              if (!part || !event) return setHover(undefined);
              const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
              setHover({ part, x: event.clientX - rect.left, y: event.clientY - rect.top });
            }}
          />
        )}
      </Canvas>
    </div>
  );
}
