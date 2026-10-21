import { useMemo, useState } from 'react';
import type { DisplayUnit } from '../engine/units';
import type { Summary } from '../project/summary';
import { backend, usesSparrowPro } from './client';
import { formatAgo, formatSeconds, formatWhen } from './format';
import { Trash } from './icons';
import { JobThumb, LiveJobThumb, ThumbDrawing } from './JobThumb';
import { Progress } from './JobsPage';
import { href } from './route';
import { useBest, type Runner } from './runs';
import { Search } from './Search';
import { JobDot, jobFigures, jobNote, jobStatus } from './views/JobsView';
import {
  entryName,
  entrySummary,
  type OpenEntry,
  type ProjectEntry,
  type WorkspaceState,
} from './workspace';

/** The account's projects, as cards, most recently changed first, each with its last job. */
export function ProjectsPage({
  state,
  onNew,
  onExample,
  onOpenFile,
  onRetry,
  onDelete,
  runner,
  unit,
}: {
  state: Extract<WorkspaceState, { status: 'ready' }>;
  runner: Runner;
  unit: DisplayUnit;
  onNew: () => void;
  onExample: () => void;
  onOpenFile: () => void;
  onRetry: (id: string) => void;
  onDelete: (entry: ProjectEntry) => void;
}) {
  const [search, setSearch] = useState('');
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase();
    return [...state.projects]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((entry) => entryName(entry).toLowerCase().includes(words));
  }, [state.projects, search]);
  const count = state.projects.length;
  const running = state.projects.reduce(
    (sum, entry) => sum + (entrySummary(entry)?.running.length ?? 0),
    0,
  );
  return (
    <main className="home">
      <div className="home-head">
        <h1>Projects</h1>
        <span className="spacer" />
        <Search value={search} onChange={setSearch} />
        <button onClick={onExample}>Open example</button>
        <button onClick={onOpenFile}>Open project file</button>
        <button className="primary" onClick={onNew}>
          New project
        </button>
      </div>
      <section aria-label="Projects" className="stack">
        <span className="home-count">
          <span className="label">
            {count} {count === 1 ? 'project' : 'projects'} · last changed first
          </span>
          {running > 0 && (
            <span className="job-progress muted">
              <i className="live-dot" aria-hidden="true" />
              {running} {running === 1 ? 'job' : 'jobs'} running
            </span>
          )}
        </span>
        {!count && (
          <div className="empty">
            <p>No projects yet.</p>
            <p className="muted">Start a new project, or open an example to try sparrow.</p>
          </div>
        )}
        {count > 0 && !shown.length && <p className="muted">No project is named like that.</p>}
        <div className="project-grid">
          {shown.map((entry) => (
            <ProjectCard
              key={entry.id}
              entry={entry}
              runner={runner}
              unit={unit}
              onRetry={() => onRetry(entry.id)}
              onDelete={() => onDelete(entry)}
            />
          ))}
        </div>
        {!usesSparrowPro && (
          <p className="muted">
            Projects are saved {backend.saves} only. Export a project file to keep a copy elsewhere.
          </p>
        )}
      </section>
    </main>
  );
}

function ProjectCard({
  entry,
  runner,
  unit,
  onRetry,
  onDelete,
}: {
  entry: ProjectEntry;
  runner: Runner;
  unit: DisplayUnit;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const name = entryName(entry);
  const remove = (
    <button
      className="icon-button card-delete"
      aria-label={`Delete ${name}`}
      title="Delete project"
      onClick={onDelete}
    >
      <Trash />
    </button>
  );
  const summary = entrySummary(entry);
  const link = href({ page: 'project', id: entry.id, tab: 'parts' });
  const problem =
    entry.status === 'failed' ? (
      <>
        <span className="field-error">Could not open this project: {entry.error}</span>
        <span className="row-actions">
          <button className="small" onClick={onRetry}>
            Try again
          </button>
        </span>
      </>
    ) : entry.status === 'open' && 'message' in entry.save ? (
      <span className="field-error">Not saved: {entry.save.message}</span>
    ) : undefined;
  // Without a summary, such as one saved before summaries, the card waits for the document.
  if (!summary)
    return (
      <div className="project-card">
        <div className="card-thumb" />
        <div className="card-body">
          <span className="card-name">{name}</span>
          {problem ?? <span className="muted">Opening…</span>}
        </div>
        {entry.status === 'failed' && remove}
      </div>
    );
  const running = summary.running.length;
  return (
    <div className="project-card">
      <a className="card-link" href={link}>
        {summary.thumb ? (
          <ThumbDrawing className="card-thumb" thumb={summary.thumb} outlined />
        ) : (
          <span className="card-thumb" />
        )}
        <span className="card-body">
          <span className="card-title">
            <span className="card-name">{name}</span>
            {running > 0 && (
              <i
                className="live-dot"
                role="img"
                aria-label={`${running} ${running === 1 ? 'job' : 'jobs'} running`}
              />
            )}
          </span>
          <span className="muted">
            Changed {formatAgo(entry.updatedAt)} · {summary.copies} parts ·{' '}
            {summary.packing === 'sheets'
              ? `${summary.sheets} ${summary.sheets === 1 ? 'sheet' : 'sheets'}`
              : 'strip'}
            {summary.jobs > 0 && ` · ${summary.jobs} ${summary.jobs === 1 ? 'job' : 'jobs'}`}
          </span>
        </span>
      </a>
      {problem && <span className="card-body">{problem}</span>}
      <LastJob entry={entry} summary={summary} runner={runner} unit={unit} />
      {remove}
    </div>
  );
}

/**
 * A project's newest job, under its card: its layout, live while it runs, how it stands, and
 * what it used; a click opens it. A project without jobs says so in the same place.
 */
function LastJob({
  entry,
  summary,
  runner,
  unit,
}: {
  entry: ProjectEntry;
  summary: Summary;
  runner: Runner;
  unit: DisplayUnit;
}) {
  const job = summary.recent[0];
  const id = job?.stage === 'running' ? job.id : undefined;
  // The best layout alone: the search moves on many times a second, the best less often.
  const best = useBest(runner, id);
  const input = id ? runner.get(id)?.request.input : undefined;
  const order = useOrder(entry.status === 'open' ? entry : undefined);
  if (!job)
    return (
      <a className="last-job" href={href({ page: 'project', id: entry.id, tab: 'parts' })}>
        <JobThumb />
        <span className="last-job-text">
          <span>No jobs yet</span>
          <span className="muted">Start nesting from the project</span>
        </span>
      </a>
    );
  const figures = jobFigures(job, best, unit);
  const failed = job.stage !== 'completed' && job.stage !== 'running';
  const stale = !id && job.input !== summary.input;
  return (
    <a
      className={id ? 'last-job running' : 'last-job'}
      href={href({ page: 'job', id: entry.id, number: job.number, view: 'layout' })}
    >
      {input ? (
        <LiveJobThumb input={input} best={best} order={order} />
      ) : (
        <JobThumb thumb={job.thumb} more={job.more} />
      )}
      <span className="last-job-text">
        <span className="job-progress">
          <JobDot job={job} />
          <strong className="mono">#{job.number}</strong>
          {id
            ? 'Running'
            : job.stage === 'completed'
              ? `${job.stopped ? 'Stopped' : 'Finished'} after ${formatSeconds(job.solverSeconds)}`
              : jobStatus(job).replace(/^./, (c) => c.toUpperCase())}
        </span>
        <span className="muted">
          {id ? (
            <span className="job-progress">
              <Progress runner={runner} jobId={id} />
            </span>
          ) : failed ? (
            jobNote(job)
          ) : (
            <>
              {formatWhen(job.submittedAt)}
              {stale && ' · project changed since'}
            </>
          )}
        </span>
      </span>
      {figures && !failed && (
        <span className="last-job-figures mono">
          <span>{figures.utilization}</span>
          {figures.used && <span className="muted">{figures.used}</span>}
        </span>
      )}
    </a>
  );
}

/** Each part's place in an open project, for the color the Parts tab gives it to a running job. */
function useOrder(entry: OpenEntry | undefined) {
  const parts = entry?.history.present.parts;
  return useMemo(() => new Map(parts?.map((part, index) => [part.id, index])), [parts]);
}
