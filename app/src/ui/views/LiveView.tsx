import { useMemo, useRef, useState } from 'react';
import { netArea, worldParts } from '../../engine/geometry/validate';
import type { Job } from '../../engine/model';
import type { DisplayUnit } from '../../engine/units';
import type { Timing } from '../../engine/workers/useSolver';
import { activeMachine, copyCount, utilization } from '../../project/model';
import { Canvas } from '../Canvas';
import { useStudio } from '../context';
import { formatLength, formatPercent, formatSeconds } from '../format';
import { RunBar } from '../RunBar';
import { rulerStep } from '../rulers';
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
                    {best && runJob ? formatPercent(utilization(runJob, best, netArea)) : '—'}
                  </span>
                  <span className="muted">utilization</span>
                </div>
                <div className="metric">
                  <span className="metric-value">
                    {best ? formatLength(best.usedLengthMm, unit) : '—'} <small>{unit}</small>
                  </span>
                  <span className="muted">length used</span>
                </div>
              </div>
              <span className="muted">Of the best valid layout so far.</span>
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
                <ImprovementChart history={history} job={runJob} elapsed={solver.elapsed} />
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

/**
 * Utilization of the best valid layout over time, as a step line: each improvement holds until
 * the next. Utilization is plotted by its distance below the current best on a log scale, so even
 * small late improvements show; time runs linearly.
 */
function ImprovementChart({
  history,
  job,
  elapsed,
}: {
  history: Timing[];
  job: Job;
  elapsed: number;
}) {
  const W = 300;
  const H = 110;
  const pad = { left: 44, right: 6, top: 8, bottom: 16 };
  const area = job.parts.reduce((sum, part) => sum + netArea(part) * part.quantity, 0);
  const percent = (lengthMm: number) => (area / (job.settings.materialWidthMm * lengthMm)) * 100;
  const values = history.map((entry) => percent(entry.lengthMm));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const end = Math.max(elapsed * 1000, history.at(-1)!.elapsedMs, 1);
  const x = (ms: number) => pad.left + (ms / end) * (W - pad.left - pad.right);
  // The best sits at the top and the first layout at the bottom; in between, the log distance.
  const floor = Math.max((high - low) * 0.01, 1e-6);
  const depth = (value: number) => Math.log((high - value + floor) / floor);
  const y = (value: number) =>
    high === low
      ? (H - pad.bottom + pad.top) / 2
      : pad.top + (depth(value) / depth(low)) * (H - pad.top - pad.bottom);
  let d = `M${x(history[0].elapsedMs)},${y(values[0])}`;
  history.slice(1).forEach((entry, i) => (d += `H${x(entry.elapsedMs)}V${y(values[i + 1])}`));
  d += `H${x(end)}`;
  const fill = `${d}V${H - pad.bottom}H${x(history[0].elapsedMs)}Z`;
  // Utilization ticks at round distances below the best, kept at least 11 px apart.
  const yTicks: number[] = [];
  for (const value of [high, high - 0.1, high - 1, high - 10, low])
    if (value >= low && yTicks.every((tick) => Math.abs(y(tick) - y(value)) >= 11))
      yTicks.push(value);
  // Time ticks at a round step, about 70 px apart.
  const step = rulerStep(((end / 1000) * 70) / (W - pad.left - pad.right));
  const xTicks = Array.from({ length: Math.floor(end / 1000 / step) + 1 }, (_, i) => i * step);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Utilization over time">
      {yTicks.map((value) => (
        <g key={value}>
          <line className="grid" x1={pad.left} x2={W - pad.right} y1={y(value)} y2={y(value)} />
          <text x={pad.left - 4} y={y(value) + 3} textAnchor="end">
            {formatPercent(value)}
          </text>
        </g>
      ))}
      <path className="area" d={fill} />
      <path className="line" d={d} />
      <line
        className="axis"
        x1={pad.left}
        x2={W - pad.right}
        y1={H - pad.bottom}
        y2={H - pad.bottom}
      />
      {xTicks.map((seconds) => (
        <text key={seconds} x={x(seconds * 1000)} y={H - 3} textAnchor="middle">
          {Number(seconds.toPrecision(6))} s
        </text>
      ))}
    </svg>
  );
}
