import { useMemo, useState } from 'react';
import { worldParts } from '../../engine/geometry/world';
import type { Schemas } from '../../api/client';
import type { DisplayUnit } from '../../engine/units';
import { jobInput, type ProjectJob } from '../../project/model';
import { jobFacts, usedBy, type JobFacts } from '../../project/summary';
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
export function jobStatus(job: JobFacts): string {
  switch (job.stage) {
    case 'running':
      return 'running';
    case 'lost':
      return 'result lost';
    case 'completed':
      return job.stopped ? 'stopped' : 'finished';
    case 'cancelled':
    case 'failed':
      return job.stage;
  }
}

/** What a job found, for lists: the utilization and the material used, or so far. */
export function jobFigures(
  job: JobFacts,
  live: Schemas['Snapshot'] | undefined,
  unit: DisplayUnit,
) {
  const found =
    job.stage === 'completed'
      ? { utilization: job.utilization, used: job.used, soFar: '' }
      : job.stage === 'running' && live
        ? {
            utilization: live.stats.density * 100,
            used: usedBy(live, job.onSheets),
            soFar: ' so far',
          }
        : undefined;
  if (!found) return undefined;
  const { utilization, used, soFar } = found;
  return {
    utilization: `${formatPercent(utilization)}${soFar}`,
    used:
      used && 'sheets' in used
        ? `${used.sheets} ${used.sheets === 1 ? 'sheet' : 'sheets'}`
        : used && `${formatLength(used.lengthMm, unit)} ${unit}`,
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
  const facts = useMemo(() => jobFacts(job), [job]);
  const figures = jobFigures(facts, run?.best, unit);
  return (
    <button
      className={selected ? 'row selected' : 'row'}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <JobDot job={facts} />
      <span className="row-text">
        <span>#{job.number}</span>
        <span className="muted">
          {formatWhen(job.submittedAt)} · {jobStatus(facts)}
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
export function jobNote(job: JobFacts): string {
  switch (job.stage) {
    case 'running':
      return 'The job is starting. Its best layout shows here as soon as it has one.';
    case 'lost':
      return usesSparrowPro
        ? 'Sparrow Pro no longer has this job, and studio did not get its result.'
        : 'This job ended when studio closed: jobs in this browser run only while studio is open.';
    case 'failed':
      return explainJobError(job.error, job.onSheets);
    case 'cancelled':
      return 'The job was cancelled before it started.';
    case 'completed':
      return 'The job found no layout.';
  }
}

/** A dot for how a job stands: pulsing while it runs. */
export function JobDot({ job }: { job: JobFacts }) {
  if (job.stage === 'running') return <i className="live-dot" aria-hidden="true" />;
  const failed = job.stage !== 'completed';
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
  const facts = useMemo(() => jobFacts(job), [job]);
  const figures = jobFigures(facts, live, unit);
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
            {[jobStatus(facts), figures?.utilization, figures?.used].filter(Boolean).join(' · ')} ·{' '}
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
          <p className="muted">{jobNote(facts)}</p>
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
