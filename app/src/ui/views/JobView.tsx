import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { jobInput, jobNames, type ProjectJob } from '../../project/model';
import { jobFacts } from '../../project/summary';
import { isStale, projectInput } from '../../project/solution';
import type { DisplayUnit } from '../../engine/units';
import { describeChanges } from '../changes';
import { client, usesSparrowPro } from '../client';
import { useStudio } from '../context';
import { Dialog } from '../Dialog';
import { formatLength, formatSeconds, formatWhen } from '../format';
import { go, href } from '../route';
import { useRun } from '../runs';
import { jobNote, jobStatus } from './JobsView';
import { LiveView } from './LiveView';
import { SolutionView, type SolvedJob } from './SolutionView';

/** What a job cost, from the account's record of it at Sparrow Pro, once it ended. */
function useCredits(job: ProjectJob) {
  const id = job.stage === 'ended' ? job.id : undefined;
  const [credits, setCredits] = useState<{ id: string; charged?: number }>();
  useEffect(() => {
    if (!id || !usesSparrowPro) return;
    let current = true;
    client.getJob(id).then(
      (record) => current && setCredits({ id, charged: record.credits.charged ?? undefined }),
      // A job the account no longer has, such as one from another account's project file.
      () => {},
    );
    return () => {
      current = false;
    };
  }, [id]);
  return credits?.id === id ? credits?.charged : undefined;
}

/**
 * The job open in the Jobs tab: its layout in the middle, live while it runs, and its details on
 * the right.
 */
export function JobView({ job }: { job: ProjectJob }) {
  const { runner } = useStudio();
  const run = useRun(runner, job.stage === 'running' ? job.id : undefined);
  const credits = useCredits(job);
  if (job.stage === 'running') return <LiveView job={job} run={run} />;
  if (job.stage === 'ended' && job.document.outcome)
    return <SolutionView job={job as SolvedJob} credits={credits} />;
  const facts = jobFacts(job);
  return (
    <>
      <section className="explanation" aria-label={`Job #${job.number}`}>
        <span className="chip">No layout to show</span>
      </section>
      <JobAside job={job} status={jobStatus(facts).replace(/^./, (c) => c.toUpperCase())}>
        <p className="notice warning">{jobNote(facts)}</p>
      </JobAside>
    </>
  );
}

/**
 * A job's details, on the right of its layout: its number and start, how it stands, what is its
 * own (`children`), whether the project changed since, and what it ran with, which its preview
 * shows in full. `footer` takes the place of removing it, such as Stop while it runs.
 */
export function JobAside({
  job,
  status,
  children,
  footer,
}: {
  job: ProjectJob;
  status: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { projectId, project, unit } = useStudio();
  const input = jobInput(job);
  const stale = useMemo(
    () => job.stage !== 'running' && isStale(project, input),
    [project, input, job.stage],
  );
  // What changed since, named as the job named it, or as the project names what it added.
  const changes = useMemo(() => {
    if (!stale) return [];
    const now = jobNames(project);
    const name = (id: string) => job.names[id] ?? now[id] ?? 'A part';
    return describeChanges(input, projectInput(project), name, unit);
  }, [project, input, job.names, stale, unit]);
  const preview = href({ page: 'job', id: projectId, number: job.number, view: 'inputs' });
  return (
    <aside className="inspector" aria-label={`Job #${job.number}`}>
      <div className="inspector-scroll">
        <div className="inspector-head">
          <span className="label">
            #{job.number} · {formatWhen(job.submittedAt)}
          </span>
          <span className="muted">{status}</span>
        </div>
        {stale && (
          <div className="changed-notice" role="status">
            <span>
              <strong>The project changed since #{job.number}.</strong>{' '}
              {changes.length
                ? `${changes.join('. ')}.`
                : 'Its inputs are not what this job ran with.'}
            </span>
            <a className="button small" href={preview}>
              Preview #{job.number}’s inputs
            </a>
          </div>
        )}
        {children}
        <p className="muted">
          Ran with {ranWith(job, unit)} · <a href={preview}>Preview</a>
        </p>
      </div>
      {footer ?? <RemoveJob job={job} />}
    </aside>
  );
}

/** What a job ran with, in one line: its parts, material, gap and time. */
function ranWith(job: ProjectJob, unit: DisplayUnit): string {
  const input = jobInput(job);
  const settings = job.stage === 'ended' ? job.document.settings : job.request.settings;
  const copies = input.parts.reduce((sum, part) => sum + part.quantity, 0);
  const problem = input.problem;
  const sheets =
    problem.type === 'minimize_sheets_in_order'
      ? problem.sheets.reduce((sum, sheet) => sum + (sheet.quantity ?? 1), 0)
      : 0;
  const material =
    problem.type === 'minimize_strip_length'
      ? `a strip ${formatLength(problem.height, unit)} ${unit} wide`
      : `${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}`;
  const gap = formatLength(input.minimum_separation_distance.parts, unit, 3);
  return `${copies} ${copies === 1 ? 'part' : 'parts'} · ${material} · gap ${gap} ${unit} · up to ${formatSeconds(settings.time_limit_seconds)}`;
}

/** Removes a job that ended, after asking. */
function RemoveJob({ job }: { job: ProjectJob }) {
  const { projectId, project, removeJob } = useStudio();
  const [asking, setAsking] = useState(false);
  return (
    <div className="inspector-foot">
      <button className="small danger" onClick={() => setAsking(true)}>
        Remove job
      </button>
      {asking && (
        <Dialog
          title={`Remove job #${job.number}`}
          onClose={() => setAsking(false)}
          actions={
            <>
              <button onClick={() => setAsking(false)}>Keep</button>
              <button
                className="danger"
                onClick={() => {
                  setAsking(false);
                  go({ page: 'project', id: projectId, tab: 'jobs' }, { replace: true });
                  removeJob(job.number);
                }}
              >
                Remove
              </button>
            </>
          }
        >
          <p>
            Remove job #{job.number} and its result from {project.name}? This cannot be undone.
          </p>
        </Dialog>
      )}
    </div>
  );
}

/** What a job ran with: its parts, material, distances and time. */
export function JobInputs({ job }: { job: ProjectJob }) {
  const { unit } = useStudio();
  const input = jobInput(job);
  const settings = job.stage === 'ended' ? job.document.settings : job.request.settings;
  const name = (id: string) => job.names[id] ?? id;
  const problem = input.problem;
  const copies = input.parts.reduce((sum, part) => sum + part.quantity, 0);
  return (
    <div className="view">
      <section className="list-panel" aria-label="Inputs">
        <div className="list-head">
          <span className="label">What job #{job.number} ran with</span>
        </div>
        <div className="list-scroll">
          <dl className="facts pad">
            <dt>Parts</dt>
            <dd>
              {input.parts.length} types, {copies} copies
            </dd>
            {problem.type === 'minimize_strip_length' ? (
              <>
                <dt>Strip</dt>
                <dd>
                  {formatLength(problem.height, unit)} {unit} wide
                </dd>
              </>
            ) : (
              <>
                <dt>Sheets</dt>
                <dd>
                  {problem.sheets.map((sheet) => `${name(sheet.id)} ×${sheet.quantity}`).join(', ')}
                </dd>
              </>
            )}
            <dt>Gap</dt>
            <dd>
              {formatLength(input.minimum_separation_distance.parts, unit, 3)} {unit}
            </dd>
            <dt>Edge</dt>
            <dd>
              {formatLength(input.minimum_separation_distance.boundary, unit, 3)} {unit} to the edge
              of the material
            </dd>
            <dt>Stops</dt>
            <dd>
              after {formatSeconds(settings.time_limit_seconds)} at most
              {settings.auto_termination ? ', or once it stops improving' : ''}
            </dd>
          </dl>
        </div>
      </section>
      <section className="explanation" />
    </div>
  );
}
