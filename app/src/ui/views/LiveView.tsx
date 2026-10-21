import { useEffect, useMemo, useRef, useState } from 'react';
import type { Input, Schemas } from '../../api/client';
import { worldParts } from '../../engine/geometry/world';
import type { LiveGeometry } from '../../engine/geometry/live';
import type { GeometryReply } from '../../engine/workers/protocol';
import type { ProjectJob } from '../../project/model';
import { drawable, type DrawnLayout } from '../../project/solution';
import type { Job } from '../../engine/model';
import type { Box } from '../../project/layout';
import { Canvas } from '../Canvas';
import { backend, usesSparrowPro } from '../client';
import { useStudio } from '../context';
import { formatLength, formatPercent, formatSeconds } from '../format';
import { rulerStep } from '../rulers';
import { elapsed, useNow, type Run } from '../runs';
import { arrangeLayouts, LayoutDrawing } from './LayoutDrawing';
import { JobAside } from './JobView';
import { explain, explainJobError } from '../explain';

/**
 * The layouts the search is working on, with their overlaps, worked out off the main thread for one
 * run's input. One frame is in progress at a time; layouts that arrive meanwhile are skipped for
 * the newest, and each frame is shown at the next animation frame.
 */
function useSearchFrame(
  input: Input | undefined,
  search: Schemas['Search'] | undefined,
  names: Map<string, string>,
) {
  const [frame, setFrame] = useState<{
    job: Job;
    layouts: DrawnLayout[];
    geometry: LiveGeometry[];
  }>();
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
    // The layouts of the frame being worked out.
    let pending: ReturnType<typeof drawable> | undefined;
    next.current = () => {
      const search = latest.current;
      busy.current = !!search && search.sequence !== shown;
      if (!busy.current || !search) return;
      pending = drawable(input, search.solution, names);
      worker.postMessage({
        type: 'live-preview',
        runId: 0,
        documentRevision: 0,
        sequence: search.sequence,
        document: pending.job,
        results: pending.layouts.map((layout) => layout.result),
      });
    };
    worker.onmessage = ({ data }: MessageEvent<GeometryReply>) => {
      if (data.type === 'live-frame' && pending) {
        shown = data.sequence;
        const drawn = pending;
        requestAnimationFrame(() => setFrame({ ...drawn, geometry: data.geometry }));
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
  // A job followed again after a reload has no earlier history: its chart starts where watching did.
  const from = run.resumed ? (run.history[0]?.seconds ?? 0) : 0;
  return <ImprovementChart history={run.history} from={from} elapsed={seconds} />;
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

/** The union of two boxes. */
const union = (a: Box, b: Box): Box => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
];

/**
 * A running job, live: its best result so far, or the layout the search is working on.
 * `run` is how far following it got, absent before it is followed.
 */
export function LiveView({
  job,
  run,
}: {
  job: Extract<ProjectJob, { stage: 'running' }>;
  run?: Run;
}) {
  const { unit, runner, showError } = useStudio();
  const running = !!run && !run.error;
  const [mode, setMode] = useState<'live' | 'best'>('live');
  // The names the parts and sheets had when the job started.
  const names = useMemo(() => new Map(Object.entries(job.names)), [job.names]);
  const input = job.request.input;
  const best = useMemo(
    () => (run?.best ? drawable(input, run.best.solution, names, run.best.stats) : undefined),
    [input, run?.best, names],
  );
  const frame = useSearchFrame(running ? input : undefined, run?.search, names);
  const showLive = mode === 'live' && !!frame && running;
  const bestWorlds = useMemo(
    () => best?.layouts.map((layout) => worldParts(best.job, layout.result)) ?? [],
    [best],
  );
  const shown = showLive ? frame : best;
  const worlds = showLive ? frame.geometry.map((geometry) => geometry.world) : bestWorlds;
  const onSheets = input.problem.type === 'minimize_sheets_in_order';
  const strip = input.problem.type === 'minimize_strip_length' ? input.problem.height : 1000;
  // A live layout may overlap and is not cut yet: the strip reaches to its rightmost part.
  const lengths =
    shown?.layouts.map((layout, i) =>
      showLive
        ? Math.max(0, ...worlds[i].flatMap((part) => part.outer.map(([x]) => x)))
        : layout.result.usedLengthMm,
    ) ?? [];
  const [aspect, setAspect] = useState(4 / 3);
  const stack = shown && arrangeLayouts(shown.job, shown.layouts, lengths, aspect);
  // Keep the view still while the layout shrinks: fit to everything this run has shown.
  const seen = useRef<{ request?: unknown; extent?: Box }>({});
  if (seen.current.request !== job.request) seen.current = { request: job.request };
  if (stack?.boxes.length)
    seen.current.extent = seen.current.extent
      ? union(seen.current.extent, stack.extent)
      : stack.extent;
  const [x0, y0, x1, y1] = seen.current.extent ?? [0, 0, strip * 2, strip];
  const pad = Math.max(x1 - x0, y1 - y0) * 0.05;

  const state = run?.job?.state;
  const failure =
    run?.error ?? (state?.status === 'failed' ? explainJobError(state.error, onSheets) : undefined);
  const reduced = run?.job?.diagnostics?.find(
    (diagnostic) => diagnostic.kind === 'threads_reduced',
  ) as { used: number; reason: string } | undefined;
  const bestLength = best?.layouts[0]?.result.usedLengthMm;

  return (
    <>
      <Canvas
        label="Live layout"
        onAspect={setAspect}
        extent={[x0 - pad, y0 - pad, x1 + pad, y1 + pad]}
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
                  Best result
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
          shown &&
          stack &&
          shown.layouts.map((layout, i) => (
            <LayoutDrawing
              key={i}
              job={shown.job}
              world={worlds[i]}
              sheet={layout.sheet}
              overlaps={showLive ? frame.geometry[i].overlaps : undefined}
              usedLength={lengths[i]}
              upp={upp}
              offset={stack.offsets[i]}
              label={onSheets ? `${i + 1} · ${layout.name}` : undefined}
            />
          ))
        }
      </Canvas>
      <JobAside
        job={job}
        status={`${run ? status(run) : 'Following the job…'}${running ? ` · ${backend.solves}` : ''}`}
        footer={
          <div className="run-bar">
            {run?.error ? (
              <>
                <button className="primary" onClick={() => runner.reconnect(job.id)}>
                  Reconnect
                </button>
                <span className="muted">The job may still be running. Reconnect to follow it.</span>
              </>
            ) : (
              <>
                <button
                  className="primary"
                  disabled={!running || run.stopping}
                  onClick={() => runner.stop(job.id).catch((reason) => showError(explain(reason)))}
                >
                  {run?.stopping ? 'Stopping…' : 'Stop'}
                </button>
                <span className="muted">Stopping keeps the best result so far.</span>
              </>
            )}
          </div>
        }
      >
        {run && (
          <div className="summary">
            <div className="metrics">
              <div className="metric">
                <span className="metric-value">
                  {run.best ? formatPercent(run.best.stats.density * 100) : '—'}
                </span>
                <span className="muted">utilization</span>
              </div>
              {onSheets ? (
                <div className="metric">
                  <span className="metric-value">{best ? best.layouts.length : '—'}</span>
                  <span className="muted">sheets used</span>
                </div>
              ) : (
                <div className="metric">
                  <span className="metric-value">
                    {bestLength !== undefined ? formatLength(bestLength, unit) : '—'}{' '}
                    <small>{unit}</small>
                  </span>
                  <span className="muted">length used</span>
                </div>
              )}
            </div>
            <span className="muted">Of the best result so far.</span>
            <RunClock run={run} running={running} />
            {run.history.length > 1 && <LiveChart run={run} running={running} />}
            {failure && <p className="field-error">{failure}</p>}
            <p className="muted">
              Solved {backend.solves}
              {reduced
                ? ` · ${reduced.used} solver thread${reduced.used === 1 ? '' : 's'}: ${reduced.reason}`
                : ''}
              {running && !usesSparrowPro ? ' · keep this tab visible for the best speed.' : ''}
            </p>
          </div>
        )}
      </JobAside>
    </>
  );
}

/**
 * Utilization of the best result over time, as a step line: each improvement holds until
 * the next. Utilization is plotted by its distance below the current best on a log scale, so even
 * small late improvements show; time runs linearly.
 */
function ImprovementChart({
  history,
  from,
  elapsed,
}: {
  history: Run['history'];
  /** Where the time axis starts, in seconds. */
  from: number;
  elapsed: number;
}) {
  const W = 300;
  const H = 110;
  const pad = { left: 44, right: 6, top: 8, bottom: 16 };
  const values = history.map((entry) => entry.utilization);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const start = from * 1000;
  const end = Math.max(elapsed * 1000, history.at(-1)!.seconds * 1000, start + 1);
  const x = (ms: number) => pad.left + ((ms - start) / (end - start)) * (W - pad.left - pad.right);
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
  const step = rulerStep((((end - start) / 1000) * 70) / (W - pad.left - pad.right));
  const first = Math.ceil(from / step) * step;
  const xTicks = Array.from(
    { length: Math.floor((end / 1000 - first) / step) + 1 },
    (_, i) => first + i * step,
  );
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
