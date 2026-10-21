import { useEffect, useMemo, useRef, useState } from 'react';
import type { Job } from '../../api/client';
import { client } from '../client';
import { Dialog } from '../Dialog';
import { explain } from '../explain';
import { formatSeconds, formatWhen } from '../format';
import { patiently } from '../patiently';
import { href } from '../route';
import { elapsed, useNow, useRun, type Runner } from '../runs';
import { entryName, entrySummary, type ProjectEntry } from '../workspace';

/** The account's jobs as far as they are loaded, and where the next page starts. */
type Loaded =
  | { status: 'loading' }
  | { status: 'failed'; error: string }
  | { status: 'ready'; jobs: Job[]; next: string | null; more: boolean };

/**
 * The account, over the page: every job of it, newest first, by month with the credits each
 * month's jobs were charged, each with its project. The account's list of jobs is the API's;
 * which project each belongs to, its summary says, so a project whose summary does not say yet
 * is opened.
 */
export function AccountDialog({
  projects,
  runner,
  onOpen,
  onClose,
}: {
  projects: ProjectEntry[];
  runner: Runner;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  // A job starting or ending anywhere shows on the first page.
  const running = projects
    .flatMap((entry) => entrySummary(entry)?.running ?? [])
    .sort()
    .join();
  // Each reload starts the list again from its first page: an answer to an earlier one is dropped.
  const generation = useRef(0);
  useEffect(() => {
    const mine = ++generation.current;
    patiently(() => client.listJobs()).then(
      (page) =>
        generation.current === mine &&
        setLoaded({ status: 'ready', jobs: page.data, next: page.next_cursor, more: false }),
      (reason) =>
        generation.current === mine && setLoaded({ status: 'failed', error: explain(reason) }),
    );
    return () => {
      generation.current++;
    };
  }, [running]);
  const older = (next: string) => {
    if (loaded.status !== 'ready') return;
    const mine = generation.current;
    setLoaded({ ...loaded, more: true });
    patiently(() => client.listJobs(next)).then(
      (page) =>
        generation.current === mine &&
        setLoaded((now) =>
          now.status === 'ready'
            ? {
                status: 'ready',
                jobs: [...now.jobs, ...page.data],
                next: page.next_cursor,
                more: false,
              }
            : now,
        ),
      (reason) =>
        generation.current === mine && setLoaded({ status: 'failed', error: explain(reason) }),
    );
  };

  // A project whose summary does not list its jobs yet is opened, to name the project of each.
  useEffect(() => {
    for (const entry of projects) {
      const summary = entrySummary(entry);
      if (entry.status === 'listed' && summary?.jobs && !summary.jobNumbers) onOpen(entry.id);
    }
  }, [projects]);
  const owners = useMemo(() => {
    const owners = new Map<string, { entry: ProjectEntry; number: number }>();
    for (const entry of projects)
      for (const [id, number] of Object.entries(entrySummary(entry)?.jobNumbers ?? {}))
        owners.set(id, { entry, number });
    return owners;
  }, [projects]);

  const months = useMemo(() => {
    if (loaded.status !== 'ready') return [];
    const months: { name: string; jobs: Job[]; credits: number }[] = [];
    for (const job of loaded.jobs) {
      const name = new Date(job.created_at).toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
      });
      if (months.at(-1)?.name !== name) months.push({ name, jobs: [], credits: 0 });
      months.at(-1)!.jobs.push(job);
      months.at(-1)!.credits += job.credits.charged;
    }
    return months;
  }, [loaded]);

  return (
    <Dialog title="Account" onClose={onClose} size="large">
      {loaded.status === 'loading' && <p className="muted">Loading the jobs…</p>}
      {loaded.status === 'failed' && (
        <p className="field-error">Could not load the jobs: {loaded.error}</p>
      )}
      {loaded.status === 'ready' && !loaded.jobs.length && (
        <div className="empty">
          <p>No jobs yet.</p>
          <p className="muted">Start nesting in a project: its jobs show here.</p>
        </div>
      )}
      {months.map((month, index) => (
        <section key={month.name} className="job-section">
          <div className="job-section-head">
            <h3 id={`month-${index}`}>{month.name}</h3>
            <span className="muted">
              {month.jobs.length} {month.jobs.length === 1 ? 'job' : 'jobs'} ·{' '}
              {credits(month.credits)}
              {loaded.status === 'ready' &&
                loaded.next &&
                index === months.length - 1 &&
                ' so far: older jobs are not loaded'}
            </span>
          </div>
          <table className="job-table account-jobs" aria-labelledby={`month-${index}`}>
            <colgroup>
              <col className="started" />
              <col />
              <col />
              <col className="credits" />
            </colgroup>
            <thead className="visually-hidden">
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Project and job</th>
                <th scope="col">Status</th>
                <th scope="col">Credits</th>
              </tr>
            </thead>
            <tbody>
              {month.jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  owner={owners.get(job.id)}
                  runner={runner}
                  onOpen={onClose}
                />
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {loaded.status === 'ready' && loaded.next && (
        <span>
          <button disabled={loaded.more} onClick={() => older(loaded.next!)}>
            {loaded.more ? 'Loading…' : 'Show older jobs'}
          </button>
        </span>
      )}
    </Dialog>
  );
}

const credits = (count: number) =>
  `${count.toLocaleString('en')} ${count === 1 ? 'credit' : 'credits'}`;

function JobRow({
  job,
  owner,
  runner,
  onOpen,
}: {
  job: Job;
  owner?: { entry: ProjectEntry; number: number };
  runner: Runner;
  /** Opening the job leaves the account for it. */
  onOpen: () => void;
}) {
  // The job as studio follows it, while it does: a queued job starts, a running one ends.
  const current = useRun(runner, job.id)?.job ?? job;
  const state = current.state;
  const active = state.status === 'queued' || state.status === 'running';
  return (
    <tr className={active ? 'running' : undefined}>
      <td className="muted">{formatWhen(job.created_at)}</td>
      <td>
        {owner ? (
          <a
            href={href({ page: 'job', id: owner.entry.id, number: owner.number, view: 'layout' })}
            onClick={onOpen}
          >
            {entryName(owner.entry)} <span className="mono">#{owner.number}</span>
          </a>
        ) : (
          <span className="muted">Project not known</span>
        )}
      </td>
      <td>
        <span className="job-progress">
          {active ? (
            <i className="live-dot" aria-hidden="true" />
          ) : (
            <i
              className={state.status === 'completed' ? 'status-dot' : 'status-dot failed'}
              aria-hidden="true"
            />
          )}
          {state.status === 'queued' ? (
            'Queued'
          ) : state.status === 'running' ? (
            <Running runner={runner} jobId={job.id} />
          ) : state.status === 'completed' ? (
            `${state.termination === 'stopped' ? 'Stopped' : 'Finished'} after ${formatSeconds(state.solver_seconds)}`
          ) : state.status === 'cancelled' ? (
            'Cancelled'
          ) : (
            'Failed'
          )}
        </span>
      </td>
      <td className="mono">
        {active ? `${credits(current.credits.held)} held` : credits(current.credits.charged)}
      </td>
    </tr>
  );
}

/** A running job's time so far, once studio has heard it from the job. */
function Running({ runner, jobId }: { runner: Runner; jobId: string }) {
  const run = useRun(runner, jobId);
  const seconds = elapsed(run, useNow(!!run && !run.error));
  return <>Running{run?.clock && ` for ${formatSeconds(seconds)}`}</>;
}
