import { useMemo, useState } from 'react';
import type { DisplayUnit } from '../engine/units';
import { RECENT_JOBS, type JobListing, type Summary } from '../project/summary';
import { usesSparrowPro } from './client';
import { formatSeconds, formatWhen } from './format';
import { JobThumb, LiveJobThumb } from './JobThumb';
import { href } from './route';
import { Search } from './Search';
import { elapsed, useBest, useNow, useRun, type Runner } from './runs';
import { JobDot, jobFigures, jobNote, jobStatus } from './views/JobsView';
import { entryName, entrySummary, type ProjectEntry } from './workspace';

type Section = { entry: ProjectEntry; summary: Summary };

/**
 * The jobs of every project, by project, the most recently started first, from the projects'
 * summaries: the page needs no project's document.
 */
export function JobsPage({
  projects,
  runner,
  unit,
}: {
  projects: ProjectEntry[];
  runner: Runner;
  unit: DisplayUnit;
}) {
  const [search, setSearch] = useState('');
  const words = search.trim().toLowerCase();
  const sections = useMemo(
    () =>
      projects
        .flatMap((entry): Section[] => {
          const summary = entrySummary(entry);
          return summary?.jobs ? [{ entry, summary }] : [];
        })
        .sort((a, b) => latest(b).localeCompare(latest(a))),
    [projects],
  );
  const shown = sections.filter(({ entry }) => entryName(entry).toLowerCase().includes(words));
  return (
    <main className="home">
      <div className="home-head">
        <h1>All jobs</h1>
        <span className="spacer" />
        <Search value={search} onChange={setSearch} />
      </div>
      {!sections.length ? (
        <div className="empty">
          <p>No jobs yet.</p>
          <p className="muted">Start nesting in a project: its jobs show here.</p>
        </div>
      ) : !shown.length ? (
        <p className="muted">No project with jobs is named like that.</p>
      ) : (
        shown.map((section) => (
          <JobSection key={section.entry.id} {...section} runner={runner} unit={unit} />
        ))
      )}
      {!usesSparrowPro && (
        <p className="muted">Jobs in this browser run only while studio is open.</p>
      )}
    </main>
  );
}

/** When a project's newest job started. */
const latest = ({ summary }: Section) => summary.recent[0]?.submittedAt ?? '';

/** One project's newest jobs, as a table named after the project. */
function JobSection({
  entry,
  summary,
  runner,
  unit,
}: Section & {
  runner: Runner;
  unit: DisplayUnit;
}) {
  // Each part's place in the project, for the color the Parts tab gives it to a running job.
  const parts = entry.status === 'open' ? entry.history.present.parts : undefined;
  const order = useMemo(() => new Map(parts?.map((part, index) => [part.id, index])), [parts]);
  const running = summary.running.length;
  const heading = `jobs-of-${entry.id}`;
  return (
    <section className="job-section">
      <div className="job-section-head">
        <a id={heading} href={href({ page: 'project', id: entry.id, tab: 'jobs' })}>
          {entryName(entry)}
        </a>
        <span className="muted">
          {summary.jobs} {summary.jobs === 1 ? 'job' : 'jobs'}
          {running > 0 && ` · ${running} running`}
          {summary.jobs > RECENT_JOBS && ` · showing the last ${RECENT_JOBS}`}
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
          {summary.recent.map((job) => (
            <JobLine
              key={job.number}
              projectId={entry.id}
              job={job}
              stale={job.stage !== 'running' && job.input !== summary.input}
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
  projectId,
  job,
  stale,
  order,
  runner,
  unit,
}: {
  projectId: string;
  job: JobListing;
  /** Whether the project changed since the job, in anything its input asks. */
  stale: boolean;
  order: Map<string, number>;
  runner: Runner;
  unit: DisplayUnit;
}) {
  // The best layout alone: the search moves on many times a second, the best less often.
  const id = job.stage === 'running' ? job.id : undefined;
  const best = useBest(runner, id);
  const input = id ? runner.get(id)?.request.input : undefined;
  const figures = jobFigures(job, best, unit);
  const link = href({ page: 'job', id: projectId, number: job.number, view: 'layout' });
  const failed = job.stage !== 'completed' && job.stage !== 'running';
  return (
    <tr className={id ? 'running' : undefined}>
      <td>
        <a href={link} tabIndex={-1} aria-hidden="true">
          {input ? (
            <LiveJobThumb input={input} best={best} order={order} />
          ) : (
            <JobThumb thumb={job.thumb} more={job.more} />
          )}
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
            {job.stage === 'completed'
              ? `${job.stopped ? 'Stopped' : 'Finished'} after ${formatSeconds(job.solverSeconds)}`
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
export function Progress({ runner, jobId }: { runner: Runner; jobId: string }) {
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
