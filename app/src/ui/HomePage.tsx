import { useMemo, useState } from 'react';
import { colors } from '../engine/colors';
import { outline } from '../engine/geometry/contour';
import { bounds } from '../engine/geometry/normalize';
import { arrangeParts } from '../project/layout';
import { copyCount, resolvedParts, runningJobs, type ProjectDocument } from '../project/model';
import { ringsPath } from './Canvas';
import { backend, usesSparrowPro } from './client';
import { formatAgo } from './format';
import { Trash } from './icons';
import { href } from './route';
import { entryName, type ProjectEntry, type WorkspaceState } from './workspace';

/** How many of a project's largest parts its card draws. */
const THUMB_PARTS = 10;

/** The account's projects, as cards, most recently changed first. */
export function HomePage({
  state,
  onNew,
  onExample,
  onOpenFile,
  onRetry,
  onDelete,
}: {
  state: Extract<WorkspaceState, { status: 'ready' }>;
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
  return (
    <main className="home">
      <div className="home-head">
        <h1>Home</h1>
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
        <button onClick={onExample}>Open example</button>
        <button onClick={onOpenFile}>Open project file</button>
        <button className="primary" onClick={onNew}>
          New project
        </button>
      </div>
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
            Projects are saved {backend.saves} only. Export a project file to keep a copy elsewhere.
          </p>
        )}
      </section>
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
  if (entry.status !== 'open')
    return (
      <div className="project-card">
        <div className="card-thumb" />
        <div className="card-body">
          <span className="card-name">{name}</span>
          {entry.status === 'loading' ? (
            <span className="muted">Opening…</span>
          ) : (
            <>
              <span className="field-error">Could not open this project: {entry.error}</span>
              <span className="row-actions">
                <button className="small" onClick={onRetry}>
                  Try again
                </button>
              </span>
            </>
          )}
        </div>
        {entry.status === 'failed' && remove}
      </div>
    );
  const project = entry.history.present;
  const jobs = project.jobs.length;
  const running = runningJobs(project).length;
  const sheets = copyCount(project.stock.sheets);
  return (
    <div className="project-card">
      <a className="card-link" href={href({ page: 'project', id: entry.id, tab: 'parts' })}>
        <ProjectThumb project={project} />
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
            Changed {formatAgo(entry.updatedAt)} · {copyCount(project.parts)} parts ·{' '}
            {project.stock.packing === 'sheets'
              ? `${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}`
              : 'strip'}
          </span>
          <span className="muted">
            {jobs ? `${jobs} ${jobs === 1 ? 'job' : 'jobs'}` : 'No jobs yet'}
            {running > 0 && ` · ${running} running`}
          </span>
        </span>
      </a>
      {remove}
    </div>
  );
}

/** The project's largest parts, laid out side by side at true scale. */
function ProjectThumb({ project }: { project: ProjectDocument }) {
  const drawn = useMemo(() => {
    const parts = resolvedParts(project);
    const size = (index: number) => {
      const b = bounds(outline(parts[index].shape).outer);
      return (b[2] - b[0]) * (b[3] - b[1]);
    };
    // Each keeps its index, so its color is the one the Parts tab gives it.
    const largest = parts
      .map((_, index) => index)
      .sort((a, b) => size(b) - size(a))
      .slice(0, THUMB_PARTS);
    const arrangement = arrangeParts(largest.map((index) => parts[index]));
    return { parts, largest, arrangement };
  }, [project.parts]);
  const { parts, largest, arrangement } = drawn;
  const [x0, y0, x1, y1] = arrangement.extent;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
  return (
    <svg
      className="card-thumb"
      viewBox={`${x0 - pad} ${-y1 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`}
      aria-hidden="true"
    >
      {largest.map((index) => {
        const part = parts[index];
        const [dx, dy] = arrangement.offsets.get(part.id)!;
        const { outer, holes } = outline(part.shape);
        return (
          <path
            key={part.id}
            d={ringsPath([outer, ...holes], dx, dy)}
            fillRule="evenodd"
            fill={colors[index % colors.length]}
            stroke="var(--ink)"
            strokeWidth={0.8}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}
