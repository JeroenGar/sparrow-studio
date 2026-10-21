import { useMemo, useState } from 'react';
import { backend, usesSparrowPro } from './client';
import { formatAgo } from './format';
import { Trash } from './icons';
import { href } from './route';
import { HomeJobs } from './HomeJobs';
import { ThumbDrawing } from './JobThumb';
import type { Runner } from './runs';
import { entryName, entrySummary, type ProjectEntry, type WorkspaceState } from './workspace';
import type { DisplayUnit } from '../engine/units';

/** The account's projects, as cards, most recently changed first. */
export function HomePage({
  state,
  onNew,
  onExample,
  onOpenFile,
  onRetry,
  onDelete,
  view,
  runner,
  unit,
}: {
  state: Extract<WorkspaceState, { status: 'ready' }>;
  view: 'projects' | 'jobs';
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
  const running = state.projects.some((entry) => entrySummary(entry)?.running.length);
  return (
    <main className="home">
      <div className="home-head">
        <h1>Home</h1>
        <div className="segmented boxed" role="group" aria-label="Show">
          <a
            className="button"
            aria-current={view === 'projects' ? 'page' : undefined}
            href={href({ page: 'home', view: 'projects' })}
          >
            Projects
          </a>
          <a
            className="button"
            aria-current={view === 'jobs' ? 'page' : undefined}
            href={href({ page: 'home', view: 'jobs' })}
          >
            Jobs
            {running && <i className="live-dot" role="img" aria-label="Jobs running" />}
          </a>
        </div>
        <span className="spacer" />
        <label className="search">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            aria-label="Search projects"
            placeholder="Search projects"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {view === 'projects' && (
          <>
            <button onClick={onExample}>Open example</button>
            <button onClick={onOpenFile}>Open project file</button>
            <button className="primary" onClick={onNew}>
              New project
            </button>
          </>
        )}
      </div>
      {view === 'jobs' ? (
        <HomeJobs
          projects={shown}
          searching={shown.length < state.projects.length}
          runner={runner}
          unit={unit}
        />
      ) : (
        <section aria-label="Projects" className="stack">
          <span className="label">
            {count} {count === 1 ? 'project' : 'projects'} · last changed first
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
                onRetry={() => onRetry(entry.id)}
                onDelete={() => onDelete(entry)}
              />
            ))}
          </div>
          {!usesSparrowPro && (
            <p className="muted">
              Projects are saved {backend.saves} only. Export a project file to keep a copy
              elsewhere.
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function ProjectCard({
  entry,
  onRetry,
  onDelete,
}: {
  entry: ProjectEntry;
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
          </span>
          <span className="muted">
            {summary.jobs
              ? `${summary.jobs} ${summary.jobs === 1 ? 'job' : 'jobs'}`
              : 'No jobs yet'}
            {running > 0 && ` · ${running} running`}
          </span>
        </span>
      </a>
      {problem && <span className="card-body">{problem}</span>}
      {remove}
    </div>
  );
}
