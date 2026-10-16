import { useEffect, useMemo, useRef, useState } from 'react';
import type { Input, Schemas } from '../../api/client';
import { worldParts } from '../../engine/geometry/world';
import type { LiveGeometry } from '../../engine/geometry/live';
import type { GeometryReply } from '../../engine/workers/protocol';
import { activeMachine, copyCount } from '../../project/model';
import { drawable, utilization } from '../../project/solution';
import { Canvas } from '../Canvas';
import { backend, usesSparrowPro } from '../client';
import { useStudio } from '../context';
import { formatLength, formatPercent, formatSeconds } from '../format';
import { RunBar } from '../RunBar';
import { rulerStep } from '../rulers';
import { elapsed, useNow, type Run } from '../useJob';
import { LayoutDrawing } from './LayoutDrawing';

/**
 * The overlaps of the layout the search is working on, worked out off the main thread for one
 * run's input. One frame is in progress at a time; layouts that arrive meanwhile are skipped for
 * the newest, and each frame is shown at the next animation frame.
 */
function useSearchFrame(
  input: Input | undefined,
  search: Schemas['Search'] | undefined,
  names: Map<string, string>,
) {
  const [frame, setFrame] = useState<LiveGeometry>();
  const latest = useRef(search);
  latest.current = search;
  const next = useRef<() => void>(undefined);
  const busy = useRef(false);
  useEffect(() => {
    setFrame(undefined);
    busy.current = false;
    if (!input) return;
    const worker = new Worker(new URL('../../engine/workers/geometry.worker.ts', import.meta.url), {
      type: 'module',
    });
    let shown = -1;
    next.current = () => {
      const search = latest.current;
      busy.current = !!search && search.sequence !== shown;
      if (!busy.current || !search) return;
      const { job, result } = drawable(input, search.solution, names);
      worker.postMessage({
        type: 'live-preview',
        runId: 0,
        documentRevision: 0,
        sequence: search.sequence,
        document: job,
        result,
      });
    };
    worker.onmessage = ({ data }: MessageEvent<GeometryReply>) => {
      if (data.type === 'live-frame') {
        shown = data.sequence;
        requestAnimationFrame(() => setFrame(data.geometry));
      }
      next.current?.();
    };
    return () => {
      next.current = undefined;
      worker.terminate();
    };
  }, [input, names]);
  useEffect(() => {
    if (!busy.current) next.current?.();
  }, [search]);
  return frame;
}

/** The run's time, and how much of its time limit it used, read every animation frame. */
function RunClock({ run, running }: { run: Run; running: boolean }) {
  const seconds = elapsed(run, useNow(running));
  const limit = run.request.settings.time_limit_seconds;
  return (
    <div className="stack">
      <span className="muted">
        {formatSeconds(seconds)} of up to {formatSeconds(limit)}
        {run.request.settings.auto_termination ? ' · stops early once it stops improving' : ''}
      </span>
      <div className="progress" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (seconds / limit) * 100)}%` }} />
      </div>
    </div>
  );
}

/** The improvement chart, running on with the clock between improvements. */
function LiveChart({ run, running }: { run: Run; running: boolean }) {
  const seconds = elapsed(run, useNow(running));
  return <ImprovementChart history={run.history} elapsed={seconds} />;
}

function status(run: Run) {
  if (run.error) return 'The run failed';
  const state = run.job?.state;
  switch (state?.status) {
    case undefined:
    case 'queued':
      return 'Starting the solver…';
    case 'running':
      return 'Searching';
    case 'completed':
      return state.termination === 'stopped' ? 'Stopped' : 'Finished';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return 'The run failed';
  }
}

export function LiveView() {
  const { run, unit, running, project, setTab } = useStudio();
  const [mode, setMode] = useState<'live' | 'best'>('live');
  const names = useMemo(
    () => new Map(project.parts.map((part) => [part.id, part.name])),
    [project.parts],
  );
  const input = run?.request.input;
  const best = useMemo(
    () => (input && run?.best ? drawable(input, run.best.solution, names) : undefined),
    [input, run?.best, names],
  );
  const frame = useSearchFrame(running ? input : undefined, run?.search, names);
  const showLive = mode === 'live' && !!frame && running;
  const bestWorld = useMemo(() => (best ? worldParts(best.job, best.result) : []), [best]);
  const strip =
    input?.problem.type === 'minimize_strip_length'
      ? input.problem.height
      : project.stock.strip.widthMm;
  const liveLength = frame
    ? Math.max(0, ...frame.world.flatMap((part) => part.outer.map(([x]) => x)))
    : 0;
  const shownLength = (showLive ? liveLength : best?.result.usedLengthMm) || strip * 2;
  // Keep the view still while the layout shrinks: fit to the longest layout of this run.
  const longest = useRef({ run, length: 0 });
  if (longest.current.run?.request !== run?.request) longest.current = { run, length: 0 };
  longest.current.length = Math.max(longest.current.length, shownLength);

  const state = run?.job?.state;
  const failure = run?.error ?? (state?.status === 'failed' ? state.error.message : undefined);
  const reduced = run?.job?.diagnostics?.find(
    (diagnostic) => diagnostic.kind === 'threads_reduced',
  ) as { used: number; reason: string } | undefined;

  return (
    <div className="view">
      <section className="list-panel" aria-label="Run progress">
        <div className="list-head">
          <span className="label">{run ? status(run) : 'Next run'}</span>
          {running && <span className="muted">{backend.solves}</span>}
        </div>
        <div className="list-scroll">
          {!run ? (
            <NextRun onSolution={project.solutions.length ? () => setTab('solution') : undefined} />
          ) : (
            <div className="summary">
              <div className="metrics">
                <div className="metric">
                  <span className="metric-value">
                    {best ? formatPercent(utilization(best)) : '—'}
                  </span>
                  <span className="muted">utilization</span>
                </div>
                <div className="metric">
                  <span className="metric-value">
                    {best ? formatLength(best.result.usedLengthMm, unit) : '—'}{' '}
                    <small>{unit}</small>
                  </span>
                  <span className="muted">length used</span>
                </div>
              </div>
              <span className="muted">Of the best valid layout so far.</span>
              <RunClock run={run} running={running} />
              {run.history.length > 1 && <LiveChart run={run} running={running} />}
              {failure && <p className="field-error">{failure}</p>}
              {!running && best && project.solutions.length > 0 && (
                <button className="primary" onClick={() => setTab('solution')}>
                  Show the solution
                </button>
              )}
              <p className="muted">
                Solved {backend.solves}
                {reduced
                  ? ` · ${reduced.used} solver thread${reduced.used === 1 ? '' : 's'}: ${reduced.reason}`
                  : ''}
                {running && !usesSparrowPro ? ' · keep this tab visible for the best speed.' : ''}
              </p>
            </div>
          )}
        </div>
        <RunBar />
      </section>
      <Canvas
        label="Live layout"
        extent={[0, -strip * 0.1, longest.current.length * 1.05, strip * 1.1]}
        toolbar={
          run && (
            <>
              <div className="segmented" role="group" aria-label="Layout shown">
                <button
                  aria-pressed={showLive}
                  disabled={!frame || !running}
                  onClick={() => setMode('live')}
                >
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
          showLive && best ? (
            <LayoutDrawing
              job={best.job}
              world={frame!.world}
              overlaps={frame!.overlaps}
              usedLength={shownLength}
              upp={upp}
            />
          ) : best ? (
            <LayoutDrawing job={best.job} world={bestWorld} usedLength={shownLength} upp={upp} />
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
          after {formatSeconds(settings.timeLimitSeconds)} at most
          {settings.autoTermination ? ', or once it stops improving' : ''}
        </dd>
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
function ImprovementChart({ history, elapsed }: { history: Run['history']; elapsed: number }) {
  const W = 300;
  const H = 110;
  const pad = { left: 44, right: 6, top: 8, bottom: 16 };
  const values = history.map((entry) => entry.utilization);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const end = Math.max(elapsed * 1000, history.at(-1)!.seconds * 1000, 1);
  const x = (ms: number) => pad.left + (ms / end) * (W - pad.left - pad.right);
  // The best sits at the top and the first layout at the bottom; in between, the log distance.
  const floor = Math.max((high - low) * 0.01, 1e-6);
  const depth = (value: number) => Math.log((high - value + floor) / floor);
  const y = (value: number) =>
    high === low
      ? (H - pad.bottom + pad.top) / 2
      : pad.top + (depth(value) / depth(low)) * (H - pad.top - pad.bottom);
  let d = `M${x(history[0].seconds * 1000)},${y(values[0])}`;
  history.slice(1).forEach((entry, i) => (d += `H${x(entry.seconds * 1000)}V${y(values[i + 1])}`));
  d += `H${x(end)}`;
  const fill = `${d}V${H - pad.bottom}H${x(history[0].seconds * 1000)}Z`;
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
