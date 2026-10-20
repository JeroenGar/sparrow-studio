import { useMemo, useState } from 'react';
import { worldParts } from '../../engine/geometry/world';
import type { Schemas } from '../../api/client';
import type { DisplayUnit } from '../../engine/units';
import { jobInput, type ProjectJob } from '../../project/model';
import { drawable, isStale } from '../../project/solution';
import { Canvas } from '../Canvas';
import { usesSparrowPro } from '../client';
import { explainJobError } from '../explain';
import { useStudio } from '../context';
import { formatLength, formatPercent, formatSeconds, formatWhen } from '../format';
import { href } from '../route';
import { RunBar } from '../RunBar';
import { elapsed, useBest, useNow, useRun, type Run } from '../runs';
import { arrangeLayouts, LayoutDrawing } from './LayoutDrawing';

/** How a job stands, in a few words, for lists. */
export function jobStatus(job: ProjectJob): string {
  if (job.stage === 'running') return 'running';
  if (job.stage === 'lost') return 'result lost';
  const state = job.document.state;
  if (state.status === 'completed') return state.termination === 'stopped' ? 'stopped' : 'finished';
  return state.status;
}

/** What a job found, for lists: the utilization and the material used, or so far. */
export function jobFigures(
  job: ProjectJob,
  live: Schemas['Snapshot'] | undefined,
  unit: DisplayUnit,
) {
  const best =
    job.stage === 'ended' ? job.document.outcome : job.stage === 'running' ? live : undefined;
  if (!best) return undefined;
  const input = jobInput(job);
  const layouts = best.solution.layouts;
  const cut = best.stats.layouts[0]?.cut_x;
  const used =
    input.problem.type === 'minimize_sheets_in_order'
      ? `${layouts.length} ${layouts.length === 1 ? 'sheet' : 'sheets'}`
      : cut != null
        ? `${formatLength(cut, unit)} ${unit}`
        : undefined;
  return {
    utilization: `${formatPercent(best.stats.density * 100)}${job.stage === 'running' ? ' so far' : ''}`,
    used,
  };
}

/** The project's jobs, newest first, and the one chosen, drawn. */
export function JobsView() {
  const { project } = useStudio();
  const jobs = useMemo(() => [...project.jobs].reverse(), [project.jobs]);
  const [chosen, setChosen] = useState<number>();
  const job = jobs.find((job) => job.number === chosen) ?? jobs[0];
  return (
    <div className="view">
      <section className="list-panel" aria-label={`Jobs of ${project.name}`}>
        <div className="list-head">
          <span className="label">
            {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} · newest first
          </span>
        </div>
        <div className="list-scroll">
          {!jobs.length && (
            <div className="empty">
              <p>No jobs yet.</p>
              <p className="muted">
                Each time you start nesting, the run becomes a job of this project, numbered, and
                keeps its result.
              </p>
            </div>
          )}
          {jobs.map((item) => (
            <JobRow
              key={item.number}
              job={item}
              selected={item === job}
              onSelect={() => setChosen(item.number)}
            />
          ))}
        </div>
        <RunBar />
      </section>
      {job ? <JobPreview key={job.number} job={job} /> : <section className="explanation" />}
    </div>
  );
}

function JobRow({
  job,
  selected,
  onSelect,
}: {
  job: ProjectJob;
  selected: boolean;
  onSelect: () => void;
}) {
  const { unit, runner } = useStudio();
  const run = useRun(runner, job.stage === 'running' ? job.id : undefined);
  const figures = jobFigures(job, run?.best, unit);
  return (
    <button
      className={selected ? 'row selected' : 'row'}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <JobDot job={job} />
      <span className="row-text">
        <span>#{job.number}</span>
        <span className="muted">
          {formatWhen(job.submittedAt)} · {jobStatus(job)}
          {job.stage === 'running' && run && <RunTime run={run} />}
          {figures && job.stage !== 'running' && ` · ${figures.used}`}
        </span>
      </span>
      {figures && <span className="mono">{figures.utilization}</span>}
    </button>
  );
}

/** A running job's time, and its time limit. */
function RunTime({ run }: { run: Run }) {
  const seconds = elapsed(run, useNow(!run.error));
  return (
    <>
      {' '}
      · {formatSeconds(seconds)} of {formatSeconds(run.request.settings.time_limit_seconds)}
    </>
  );
}

/** Why a job has no layout to draw. */
export function jobNote(job: ProjectJob): string {
  if (job.stage === 'running')
    return 'The job is starting. Its best layout shows here as soon as it has one.';
  if (job.stage === 'lost')
    return usesSparrowPro
      ? 'Sparrow Pro no longer has this job, and studio did not get its result.'
      : 'This job ended when studio closed: jobs in this browser run only while studio is open.';
  const state = job.document.state;
  if (state.status === 'failed')
    return explainJobError(
      state.error,
      job.document.input.problem.type === 'minimize_sheets_in_order',
    );
  if (state.status === 'cancelled') return 'The job was cancelled before it started.';
  return 'The job found no layout.';
}

/** A dot for how a job stands: pulsing while it runs. */
export function JobDot({ job }: { job: ProjectJob }) {
  if (job.stage === 'running') return <i className="live-dot" aria-hidden="true" />;
  const failed = job.stage === 'lost' || job.document.state.status !== 'completed';
  return <i className={failed ? 'status-dot failed' : 'status-dot'} aria-hidden="true" />;
}

/** The chosen job drawn: its layout, or the best so far while it runs. */
function JobPreview({ job }: { job: ProjectJob }) {
  const { projectId, project, unit, runner } = useStudio();
  // The best layout alone: the search moves on many times a second, the best less often.
  const live = useBest(runner, job.stage === 'running' ? job.id : undefined);
  const input = jobInput(job);
  const best = job.stage === 'ended' ? job.document.outcome : live;
  const names = useMemo(() => new Map(Object.entries(job.names)), [job.names]);
  const drawn = useMemo(
    () => best && drawable(input, best.solution, names, best.stats),
    [input, best, names],
  );
  const worlds = useMemo(
    () => drawn?.layouts.map((layout) => worldParts(drawn.job, layout.result)) ?? [],
    [drawn],
  );
  const [aspect, setAspect] = useState(4 / 3);
  const stack = useMemo(
    () =>
      drawn &&
      arrangeLayouts(
        drawn.job,
        drawn.layouts,
        drawn.layouts.map((layout) => layout.result.usedLengthMm),
        aspect,
      ),
    [drawn, aspect],
  );
  const figures = jobFigures(job, live, unit);
  const onSheets = input.problem.type === 'minimize_sheets_in_order';
  const [x0, y0, x1, y1] = stack?.extent ?? [0, 0, 1000, 600];
  const pad = Math.max(x1 - x0, y1 - y0) * 0.05;
  const stale = useMemo(() => isStale(project, input), [project, input]);
  return (
    <section className="job-preview" aria-label={`Job #${job.number}`}>
      <div className="preview-head">
        <span className="stack tight">
          <strong>
            #{job.number} · {formatWhen(job.submittedAt)}
          </strong>
          <span className="muted">
            {[jobStatus(job), figures?.utilization, figures?.used].filter(Boolean).join(' · ')} ·{' '}
            {stale ? 'the project has changed since' : "its inputs are the project's now"}
          </span>
        </span>
        <a
          className="button primary"
          href={href({ page: 'job', id: projectId, number: job.number, view: 'layout' })}
        >
          Open job
        </a>
      </div>
      {!drawn ? (
        <div className="empty">
          <p className="muted">{jobNote(job)}</p>
        </div>
      ) : (
        <Canvas
          label={`Layout of job #${job.number}`}
          onAspect={setAspect}
          extent={[x0 - pad, y0 - pad, x1 + pad, y1 + pad]}
        >
          {({ upp }) =>
            drawn &&
            stack &&
            drawn.layouts.map((layout, i) => (
              <LayoutDrawing
                key={i}
                job={drawn.job}
                world={worlds[i]}
                sheet={layout.sheet}
                usedLength={layout.result.usedLengthMm}
                upp={upp}
                offset={stack.offsets[i]}
                label={onSheets ? `${i + 1} · ${layout.name}` : undefined}
              />
            ))
          }
        </Canvas>
      )}
    </section>
  );
}
