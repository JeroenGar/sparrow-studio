import { useMemo, useRef, useState } from 'react';
import { worldParts } from '../../engine/geometry/validate';
import type { DisplayUnit } from '../../engine/units';
import type { Timing } from '../../engine/workers/useSolver';
import { activeMachine, copyCount } from '../../project/model';
import { Canvas } from '../Canvas';
import { useStudio } from '../context';
import { formatLength, formatSeconds } from '../format';
import { RunBar } from '../RunBar';
import { LayoutDrawing } from './LayoutDrawing';

export function LiveView() {
  const { solver, runJob, unit, running, project, setTab } = useStudio();
  const [mode, setMode] = useState<'live' | 'best'>('live');
  const best = solver.result;
  const frame = solver.live;
  const showLive = mode === 'live' && !!frame;
  const bestWorld = useMemo(() => (runJob && best ? worldParts(runJob, best) : []), [runJob, best]);
  const history = (solver.diagnostics.current?.history ?? []).filter(
    (entry) => entry.validation === 'passed',
  );
  const width = runJob?.settings.materialWidthMm ?? project.stock.strip.widthMm;
  const shownLength = (showLive ? frame?.result.usedLengthMm : best?.usedLengthMm) ?? width * 2;
  // Keep the view still while the layout shrinks: fit to the longest layout of this run.
  const longest = useRef({ job: runJob, length: 0 });
  if (longest.current.job !== runJob) longest.current = { job: runJob, length: 0 };
  longest.current.length = Math.max(longest.current.length, shownLength);

  const limit = runJob?.settings.timeLimitSeconds ?? null;
  const first = history[0]?.lengthMm;
  const improvement = first && best ? (1 - best.usedLengthMm / first) * 100 : 0;
  const status =
    solver.state === 'Initializing'
      ? 'Starting the solver…'
      : solver.state === 'Running'
        ? 'Searching'
        : solver.state === 'Complete'
          ? 'Finished'
          : solver.state === 'Stopped'
            ? 'Stopped'
            : solver.state === 'Error'
              ? 'The run failed'
              : 'Ready';

  return (
    <div className="view">
      <section className="list-panel" aria-label="Run progress">
        <div className="list-head">
          <span className="label">{runJob ? status : 'Next run'}</span>
          {running && <span className="muted">in this browser</span>}
        </div>
        <div className="list-scroll">
          {!runJob ? (
            <NextRun onSolution={project.solutions.length ? () => setTab('solution') : undefined} />
          ) : (
            <div className="summary">
              <div className="metrics">
                <div className="metric">
                  <span className="metric-value">
                    {best ? formatLength(best.usedLengthMm, unit) : '—'} <small>{unit}</small>
                  </span>
                  <span className="muted">best length so far</span>
                </div>
                <div className="metric">
                  <span className="metric-value">
                    {improvement ? `−${improvement.toFixed(1)}%` : '—'}
                  </span>
                  <span className="muted">since the first valid layout</span>
                </div>
              </div>
              <div className="stack">
                <span className="muted">
                  {formatSeconds(solver.elapsed)}
                  {limit ? ` of up to ${formatSeconds(limit)}` : ' · stops when the search stalls'}
                </span>
                {limit && (
                  <div className="progress" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, (solver.elapsed / limit) * 100)}%` }} />
                  </div>
                )}
              </div>
              {history.length > 1 && (
                <ImprovementChart history={history} unit={unit} elapsed={solver.elapsed} />
              )}
              {solver.error && <p className="field-error">{solver.error}</p>}
              {!running && best && (
                <button className="primary" onClick={() => setTab('solution')}>
                  Show the solution
                </button>
              )}
              {running && solver.canSkip && solver.phase === 'Exploration' && (
                <button
                  className="small"
                  disabled={!best || solver.skipping}
                  onClick={solver.skipToCompression}
                >
                  Skip to compression
                </button>
              )}
              <p className="muted">
                {solver.phase ? `${solver.phase} · ` : ''}
                {solver.workers ? `${solver.workers.actual} solver threads` : 'Preparing threads'}
                {running ? ' · keep this tab visible for the best speed.' : ''}
              </p>
            </div>
          )}
        </div>
        <RunBar />
      </section>
      <Canvas
        label="Live layout"
        extent={[0, -width * 0.1, longest.current.length * 1.05, width * 1.1]}
        toolbar={
          runJob && (
            <>
              <div className="segmented" role="group" aria-label="Layout shown">
                <button aria-pressed={showLive} disabled={!frame} onClick={() => setMode('live')}>
                  Live search
                </button>
                <button aria-pressed={!showLive} disabled={!best} onClick={() => setMode('best')}>
                  Best valid
                </button>
              </div>
              {showLive && (
                <span className="chip">
                  <i className="overlap-key" aria-hidden="true" />
                  Overlaps in red · the search passes through overlapping layouts
                </span>
              )}
            </>
          )
        }
      >
        {({ upp }) =>
          runJob && (showLive ? frame : best) ? (
            <LayoutDrawing
              job={runJob}
              world={showLive ? frame!.world : bestWorld}
              overlaps={showLive ? frame!.overlaps : []}
              usedLength={shownLength}
              upp={upp}
            />
          ) : null
        }
      </Canvas>
    </div>
  );
}

/** What the next run will solve, shown before the first run of this session. */
function NextRun({ onSolution }: { onSolution?: () => void }) {
  const { project, unit } = useStudio();
  const settings = project.settings;
  const machine = activeMachine(project);
  return (
    <div className="summary">
      <p className="muted">Start nesting from any tab. Progress shows here while sparrow works.</p>
      <dl className="facts">
        <dt>Parts</dt>
        <dd>
          {project.parts.length} types, {copyCount(project.parts)} copies
        </dd>
        <dt>Strip</dt>
        <dd>
          {formatLength(project.stock.strip.widthMm, unit)} {unit} wide
        </dd>
        <dt>Gap</dt>
        <dd>
          {formatLength(machine.gapMm, unit, 3)} {unit} · {machine.name}
        </dd>
        <dt>Stops</dt>
        <dd>
          {settings.timeLimitSeconds
            ? `after ${formatSeconds(settings.timeLimitSeconds)} at most`
            : 'when the search stalls'}
        </dd>
        <dt>Search</dt>
        <dd>{settings.preset === 'fast' ? 'Fast' : 'Standard'}</dd>
      </dl>
      {onSolution && <button onClick={onSolution}>Show the saved solution</button>}
    </div>
  );
}

/** Best length over time, as a step line: each improvement holds until the next. */
function ImprovementChart({
  history,
  unit,
  elapsed,
}: {
  history: Timing[];
  unit: DisplayUnit;
  elapsed: number;
}) {
  const W = 300;
  const H = 90;
  const pad = { left: 4, right: 4, top: 14, bottom: 16 };
  const lengths = history.map((entry) => entry.lengthMm);
  const max = Math.max(...lengths);
  const min = Math.min(...lengths);
  const end = Math.max(elapsed * 1000, history.at(-1)!.elapsedMs, 1);
  const x = (ms: number) => pad.left + (ms / end) * (W - pad.left - pad.right);
  const y = (mm: number) =>
    pad.top + (max === min ? 0.5 : (max - mm) / (max - min)) * (H - pad.top - pad.bottom);
  let d = `M${x(history[0].elapsedMs)},${y(history[0].lengthMm)}`;
  for (const entry of history.slice(1)) d += `H${x(entry.elapsedMs)}V${y(entry.lengthMm)}`;
  d += `H${x(end)}`;
  const area = `${d}V${H - pad.bottom}H${x(history[0].elapsedMs)}Z`;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Best length over time">
      <path className="area" d={area} />
      <path className="line" d={d} />
      <line
        className="axis"
        x1={pad.left}
        x2={W - pad.right}
        y1={H - pad.bottom}
        y2={H - pad.bottom}
      />
      <text x={pad.left} y={H - 3}>
        0 s
      </text>
      <text x={W - pad.right} y={H - 3} textAnchor="end">
        {formatSeconds(end / 1000)}
      </text>
      <text x={W - pad.right} y={10} textAnchor="end">
        {formatLength(max, unit)} → {formatLength(min, unit)} {unit}
      </text>
    </svg>
  );
}
