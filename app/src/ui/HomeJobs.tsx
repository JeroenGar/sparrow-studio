import { useMemo } from 'react';
import type { DisplayUnit } from '../engine/units';
import { jobInput, runningJobs, type ProjectJob } from '../project/model';
import { isStale } from '../project/solution';
import { usesSparrowPro } from './client';
import { formatSeconds, formatWhen } from './format';
import { JobThumb } from './JobThumb';
import { href } from './route';
import { elapsed, useNow, useRun, type Run, type Runner } from './runs';
import { JobDot, jobFigures, jobNote, jobStatus } from './views/JobsView';
import type { OpenEntry } from './workspace';

/** How many of a project's newest jobs Home shows. */
const SHOWN = 4;

/** The jobs of every project, by project, the most recently started first. */
export function HomeJobs({
  projects,
  runner,
  unit,
}: {
  projects: OpenEntry[];
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
    return (
      <div className="empty">
        <p>No jobs yet.</p>
        <p className="muted">Start nesting in a project: its jobs show here.</p>
      </div>
    );
  return (
    <>
      {sections.map((entry) => {
        const project = entry.history.present;
        const jobs = [...project.jobs].reverse();
        const running = runningJobs(project).length;
        return (
          <section key={entry.id} className="job-section" aria-label={`Jobs of ${project.name}`}>
            <div className="job-section-head">
              <a href={href({ page: 'project', id: entry.id, tab: 'jobs' })}>{project.name}</a>
              <span className="muted">
                {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
                {running > 0 && ` · ${running} running`}
                {jobs.length > SHOWN && ` · showing the last ${SHOWN}`}
              </span>
            </div>
            <table className="job-table">
              <tbody>
                {jobs.slice(0, SHOWN).map((job) => (
                  <JobLine key={job.number} entry={entry} job={job} runner={runner} unit={unit} />
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      {!usesSparrowPro && (
        <p className="muted">Jobs in this browser run only while studio is open.</p>
      )}
    </>
  );
}

/** When a project's newest job started. */
const latest = (entry: OpenEntry) => entry.history.present.jobs.at(-1)?.submittedAt ?? '';

function JobLine({
  entry,
  job,
  runner,
  unit,
}: {
  entry: OpenEntry;
  job: ProjectJob;
  runner: Runner;
  unit: DisplayUnit;
}) {
  const run = useRun(runner, job.stage === 'running' ? job.id : undefined);
  const figures = jobFigures(job, run?.best, unit);
  const link = href({ page: 'job', id: entry.id, number: job.number, view: 'layout' });
  const project = entry.history.present;
  const stale = useMemo(
    () => job.stage !== 'running' && isStale(project, jobInput(job)),
    [project, job],
  );
  const failed = job.stage === 'lost' || (job.stage === 'ended' && !job.document.outcome);
  return (
    <tr className={job.stage === 'running' ? 'running' : undefined}>
      <td>
        <a href={link} tabIndex={-1} aria-hidden="true">
          <JobThumb job={job} run={run} />
        </a>
      </td>
      <td className="mono">
        <a href={link}>#{job.number}</a>
      </td>
      <td className="muted">{formatWhen(job.submittedAt)}</td>
      <td>
        {job.stage === 'running' ? (
          <span className="job-progress">
            <JobDot job={job} />
            <strong>Running</strong>
            {run && <Progress run={run} />}
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
function Progress({ run }: { run: Run }) {
  const seconds = elapsed(run, useNow(!run.error));
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
