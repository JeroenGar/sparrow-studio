import { useMemo } from 'react';
import type { DisplayUnit } from '../engine/units';
import { jobInput, runningJobs, type ProjectJob } from '../project/model';
import { isStale } from '../project/solution';
import { usesSparrowPro } from './client';
import { formatSeconds, formatWhen } from './format';
import { JobThumb } from './JobThumb';
import { href } from './route';
import { elapsed, useBest, useNow, useRun, type Runner } from './runs';
import { JobDot, jobFigures, jobNote, jobStatus } from './views/JobsView';
import type { OpenEntry } from './workspace';

/** How many of a project's newest jobs Home shows. */
const SHOWN = 4;

/** The jobs of every project, by project, the most recently started first. */
export function HomeJobs({
  projects,
  searching,
  runner,
  unit,
}: {
  projects: OpenEntry[];
  /** Whether a search left out some of the projects. */
  searching: boolean;
  runner: Runner;
  unit: DisplayUnit;
}) {
  const sections = useMemo(
    () =>
      projects
        .filter((entry) => entry.history.present.jobs.length)
        .sort((a, b) => latest(b).localeCompare(latest(a))),
    [projects],
  );
  if (!sections.length)
    return searching ? (
      <p className="muted">No project with jobs is named like that.</p>
    ) : (
      <div className="empty">
        <p>No jobs yet.</p>
        <p className="muted">Start nesting in a project: its jobs show here.</p>
      </div>
    );
  return (
    <>
      {sections.map((entry) => (
        <JobSection key={entry.id} entry={entry} runner={runner} unit={unit} />
      ))}
      {!usesSparrowPro && (
        <p className="muted">Jobs in this browser run only while studio is open.</p>
      )}
    </>
  );
}

/** When a project's newest job started. */
const latest = (entry: OpenEntry) => entry.history.present.jobs.at(-1)?.submittedAt ?? '';

/** One project's newest jobs, as a table named after the project. */
function JobSection({
  entry,
  runner,
  unit,
}: {
  entry: OpenEntry;
  runner: Runner;
  unit: DisplayUnit;
}) {
  const project = entry.history.present;
  const jobs = [...project.jobs].reverse();
  const running = runningJobs(project).length;
  // Each part's place in the project, for the color the Parts tab gives it.
  const order = useMemo(
    () => new Map(project.parts.map((part, index) => [part.id, index])),
    [project.parts],
  );
  const heading = `jobs-of-${entry.id}`;
  return (
    <section className="job-section">
      <div className="job-section-head">
        <a id={heading} href={href({ page: 'project', id: entry.id, tab: 'jobs' })}>
          {project.name}
        </a>
        <span className="muted">
          {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
          {running > 0 && ` · ${running} running`}
          {jobs.length > SHOWN && ` · showing the last ${SHOWN}`}
        </span>
      </div>
      <table className="job-table" aria-labelledby={heading}>
        <colgroup>
          <col className="thumb" />
          <col className="number" />
          <col className="started" />
          <col />
          <col className="result" />
        </colgroup>
        <thead className="visually-hidden">
          <tr>
            <th scope="col">Layout</th>
            <th scope="col">Job</th>
            <th scope="col">Started</th>
            <th scope="col">Status</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {jobs.slice(0, SHOWN).map((job) => (
            <JobLine
              key={job.number}
              entry={entry}
              job={job}
              order={order}
              runner={runner}
              unit={unit}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function JobLine({
  entry,
  job,
  order,
  runner,
  unit,
}: {
  entry: OpenEntry;
  job: ProjectJob;
  order: Map<string, number>;
  runner: Runner;
  unit: DisplayUnit;
}) {
  // The best layout alone: the search moves on many times a second, the best less often.
  const id = job.stage === 'running' ? job.id : undefined;
  const best = useBest(runner, id);
  const figures = jobFigures(job, best, unit);
  const link = href({ page: 'job', id: entry.id, number: job.number, view: 'layout' });
  const project = entry.history.present;
  const stale = useMemo(
    () => job.stage !== 'running' && isStale(project, jobInput(job)),
    [project, job],
  );
  const failed = job.stage === 'lost' || (job.stage === 'ended' && !job.document.outcome);
  return (
    <tr className={id ? 'running' : undefined}>
      <td>
        <a href={link} tabIndex={-1} aria-hidden="true">
          <JobThumb job={job} live={best} order={order} />
        </a>
      </td>
      <td className="mono">
        <a href={link}>#{job.number}</a>
      </td>
      <td className="muted">{formatWhen(job.submittedAt)}</td>
      <td>
        {id ? (
          <span className="job-progress">
            <JobDot job={job} />
            <strong>Running</strong>
            <Progress runner={runner} jobId={id} />
          </span>
        ) : (
          <span className="job-progress">
            <JobDot job={job} />
            {job.stage === 'ended' && job.document.state.status === 'completed'
              ? `${jobStatus(job) === 'stopped' ? 'Stopped' : 'Finished'} after ${formatSeconds(job.document.state.solver_seconds)}`
              : jobStatus(job).replace(/^./, (c) => c.toUpperCase())}
            {stale && <span className="muted"> · project changed since</span>}
          </span>
        )}
      </td>
      <td className={failed ? 'muted' : 'mono'}>
        {failed
          ? jobNote(job)
          : figures && [figures.utilization, figures.used].filter(Boolean).join(' · ')}
      </td>
    </tr>
  );
}

/** A running job's time against its limit, as a bar and in figures. */
function Progress({ runner, jobId }: { runner: Runner; jobId: string }) {
  const run = useRun(runner, jobId);
  const seconds = elapsed(run, useNow(!!run && !run.error));
  if (!run) return null;
  const limit = run.request.settings.time_limit_seconds;
  return (
    <>
      <span className="progress small" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (seconds / limit) * 100)}%` }} />
      </span>
      <span className="muted mono">
        {formatSeconds(seconds)} of {formatSeconds(limit)}
      </span>
    </>
  );
}
