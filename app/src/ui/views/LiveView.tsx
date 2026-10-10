import { useMemo, useRef, useState } from 'react';
import { netArea, worldParts } from '../../engine/geometry/validate';
import type { Job } from '../../engine/model';
import type { DisplayUnit } from '../../engine/units';
import type { Timing } from '../../engine/workers/useSolver';
import { activeMachine, copyCount, utilization } from '../../project/model';
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
                    {best && runJob ? `${utilization(runJob, best, netArea).toFixed(1)}%` : '—'}
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
 * the next. Time runs on a logarithmic axis, because most of the gain comes in the first seconds.
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
  const H = 90;
  const pad = { left: 4, right: 4, top: 14, bottom: 16 };
  const area = job.parts.reduce((sum, part) => sum + netArea(part) * part.quantity, 0);
  const percent = (lengthMm: number) => (area / (job.settings.materialWidthMm * lengthMm)) * 100;
  const values = history.map((entry) => percent(entry.lengthMm));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const end = Math.max(elapsed * 1000, history.at(-1)!.elapsedMs, 1);
  // log(1 + t / 100 ms): close to linear for the first tenths of a second, logarithmic after.
  const scale = (ms: number) => Math.log1p(ms / 100);
  const x = (ms: number) => pad.left + (scale(ms) / scale(end)) * (W - pad.left - pad.right);
  const y = (value: number) =>
    H -
    pad.bottom -
    (high === low ? 0.5 : (value - low) / (high - low)) * (H - pad.top - pad.bottom);
  let d = `M${x(history[0].elapsedMs)},${y(values[0])}`;
  history.slice(1).forEach((entry, i) => (d += `H${x(entry.elapsedMs)}V${y(values[i + 1])}`));
  d += `H${x(end)}`;
  const fill = `${d}V${H - pad.bottom}H${x(history[0].elapsedMs)}Z`;
  // Ticks at 1, 10, 100… seconds, leaving room for the end label.
  const ticks = [1, 10, 100, 1000].map((s) => s * 1000).filter((ms) => x(ms) < x(end) - 36);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Utilization over time">
      <path className="area" d={fill} />
      <path className="line" d={d} />
      <line
        className="axis"
        x1={pad.left}
        x2={W - pad.right}
        y1={H - pad.bottom}
        y2={H - pad.bottom}
      />
      {ticks.map((ms) => (
        <g key={ms}>
          <line
            className="axis"
            x1={x(ms)}
            x2={x(ms)}
            y1={H - pad.bottom}
            y2={H - pad.bottom + 3}
          />
          <text x={x(ms)} y={H - 3} textAnchor="middle">
            {ms / 1000} s
          </text>
        </g>
      ))}
      <text x={W - pad.right} y={H - 3} textAnchor="end">
        {formatSeconds(end / 1000)}
      </text>
      <text x={W - pad.right} y={10} textAnchor="end">
        {low.toFixed(1)}% → {high.toFixed(1)}%
      </text>
    </svg>
  );
}
