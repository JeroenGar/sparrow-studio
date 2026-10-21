import { useMemo } from 'react';
import type { Schemas } from '../../api/client';
import type { DisplayUnit } from '../../engine/units';
import type { ProjectJob } from '../../project/model';
import { jobFacts, usedBy, type JobFacts } from '../../project/summary';
import { usesSparrowPro } from '../client';
import { explainJobError } from '../explain';
import { useStudio } from '../context';
import { formatLength, formatPercent, formatSeconds, formatWhen } from '../format';
import { href } from '../route';
import { RunBar } from '../RunBar';
import { elapsed, useNow, useRun, type Run } from '../runs';
import { JobView } from './JobView';

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

/**
 * The project's jobs, newest first, with one open: `number`'s, or the newest. A job is opened by
 * its address, so the breadcrumb and the browser's history follow it.
 */
export function JobsView({ number }: { number?: number }) {
  const { project } = useStudio();
  const jobs = useMemo(() => [...project.jobs].reverse(), [project.jobs]);
  const job = number === undefined ? jobs[0] : jobs.find((job) => job.number === number);
  return (
    <div className="view">
      <section className="list-panel narrow" aria-label={`Jobs of ${project.name}`}>
        <div className="list-head">
          <span className="label">
            {jobs.length
              ? `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'} · newest first`
              : 'No jobs yet'}
          </span>
        </div>
        <div className="list-scroll">
          {!jobs.length && (
            <div className="empty">
              <p>
                Each time you start nesting, the run becomes a job of this project: #1, #2, and so
                on.
              </p>
              <p className="muted">
                A job keeps what it was given and what it found, also when the project changes
                later.
              </p>
            </div>
          )}
          {jobs.map((item) => (
            <JobRow key={item.number} job={item} selected={item === job} />
          ))}
        </div>
        <RunBar />
      </section>
      {job ? (
        <JobView key={job.number} job={job} />
      ) : (
        <section className="explanation">
          <span className="chip">
            {jobs.length
              ? `There is no job #${number}: it may have been removed.`
              : 'The first job’s layout shows here'}
          </span>
        </section>
      )}
    </div>
  );
}

function JobRow({ job, selected }: { job: ProjectJob; selected: boolean }) {
  const { projectId, unit, runner } = useStudio();
  const run = useRun(runner, job.stage === 'running' ? job.id : undefined);
  const facts = useMemo(() => jobFacts(job), [job]);
  const figures = jobFigures(facts, run?.best, unit);
  return (
    <a
      className={selected ? 'row selected' : 'row'}
      aria-current={selected ? 'page' : undefined}
      href={href({ page: 'job', id: projectId, number: job.number, view: 'layout' })}
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
    </a>
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
