import { useMemo, useRef, useState } from 'react';
import { worldParts } from '../../engine/geometry/validate';
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
  const width = runJob?.settings.materialWidthMm ?? 100;
  const shownLength = (showLive ? frame?.result.usedLengthMm : best?.usedLengthMm) ?? width * 2;
  // Keep the view still while the layout shrinks: fit to the longest layout of this run.
  const longest = useRef({ job: runJob, length: 0 });
  if (longest.current.job !== runJob) longest.current = { job: runJob, length: 0 };
  longest.current.length = Math.max(longest.current.length, shownLength);
  const status =
    solver.state === 'Initializing'
      ? 'Starting the solver'
      : solver.state === 'Running'
        ? (solver.phase ?? 'Running')
        : solver.state === 'Complete'
          ? 'Finished'
          : solver.state;
  return (
    <div className="view">
      <section className="list-panel" aria-label="Run progress">
        <div className="list-head">
          <span className="label">
            {running ? 'Run in progress · in this browser' : 'Last run'}
          </span>
        </div>
        <div className="list-scroll pad stack">
          {!runJob ? (
            <div className="empty">
              <p>No run yet in this session.</p>
              <p className="muted">
                Start nesting from any tab. Progress shows here while the solver works.
              </p>
              {!!project.solutions.length && (
                <button onClick={() => setTab('solution')}>Show the saved solution</button>
              )}
            </div>
          ) : (
            <>
              <dl className="stats">
                <dt>Status</dt>
                <dd>{status}</dd>
                <dt>Elapsed</dt>
                <dd>{formatSeconds(solver.elapsed)}</dd>
                <dt>Best valid length</dt>
                <dd>{best ? `${formatLength(best.usedLengthMm, unit, 2)} ${unit}` : '—'}</dd>
                <dt>Solver threads</dt>
                <dd>{solver.workers?.actual ?? '—'}</dd>
              </dl>
              {solver.error && <p className="field-error">{solver.error}</p>}
              {running && solver.canSkip && solver.phase === 'Exploration' && (
                <button
                  className="small"
                  disabled={!best || solver.skipping}
                  onClick={solver.skipToCompression}
                >
                  Skip to compression
                </button>
              )}
              <span className="label">Improvements</span>
              {history.length ? (
                <ol className="history">
                  {[...history]
                    .reverse()
                    .slice(0, 12)
                    .map((entry) => (
                      <li key={entry.sequence}>
                        <span>{formatSeconds(entry.elapsedMs / 1000)}</span>
                        <span>
                          {formatLength(entry.lengthMm, unit, 2)} {unit}
                        </span>
                      </li>
                    ))}
                </ol>
              ) : (
                <p className="muted">The first valid layout appears after the solver starts.</p>
              )}
              {!running && best && (
                <button onClick={() => setTab('solution')}>Show the solution</button>
              )}
              <p className="muted">
                Keep this tab visible for the best speed. Stop keeps the best valid layout so far.
              </p>
            </>
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
                  Overlaps in red · intermediate layouts may overlap
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
