import { useEffect, useMemo, useState } from 'react';
import { jobInput, jobNames, type ProjectJob } from '../project/model';
import { isStale, projectInput } from '../project/solution';
import { describeChanges } from './changes';
import { client, usesSparrowPro } from './client';
import { useStudio } from './context';
import { Dialog } from './Dialog';
import { formatLength, formatSeconds, formatWhen } from './format';
import { go, href, type JobView } from './route';
import { useRun, useSubmitting } from './runs';
import { jobNote } from './views/JobsView';
import { LiveView } from './views/LiveView';
import { SolutionView, type SolvedJob } from './views/SolutionView';

/** What a job cost, from the account's record of it at Sparrow Pro, once it ended. */
function useCredits(job: ProjectJob | undefined) {
  const id = job?.stage === 'ended' ? job.id : undefined;
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

/** One job of the project: live while it runs, its result once it ended, and its inputs. */
export function JobPage({ number, view }: { number: number; view: JobView }) {
  const { projectId, project, unit, runner, startRun, removeJob, copyJob } = useStudio();
  const submitting = useSubmitting(runner, projectId);
  const job = project.jobs.find((job) => job.number === number);
  const run = useRun(runner, job?.stage === 'running' ? job.id : undefined);
  const credits = useCredits(job);
  const [removing, setRemoving] = useState(false);
  const stale = useMemo(() => !!job && isStale(project, jobInput(job)), [project, job]);
  // What changed since, named as the job named it, or as the project names what it added.
  const changes = useMemo(() => {
    if (!job || !stale) return [];
    const now = jobNames(project);
    const name = (id: string) => job.names[id] ?? now[id] ?? 'A part';
    return describeChanges(jobInput(job), projectInput(project), name, unit);
  }, [project, job, stale, unit]);
  if (!job)
    return (
      <div className="boot stack">
        <p>
          {project.name} has no job #{number}. It may have been removed.
        </p>
        <span>
          <a href={href({ page: 'project', id: projectId, tab: 'jobs' })}>
            Show the jobs of {project.name}
          </a>
        </span>
      </div>
    );
  const link = (view: JobView) => href({ page: 'job', id: projectId, number, view });
  const tab = (target: JobView) => (target === view ? 'tab active' : 'tab');
  const solved = job.stage === 'ended' && job.document.outcome ? (job as SolvedJob) : undefined;
  return (
    <>
      <nav className="tabs" aria-label="Job">
        <a
          className={tab('layout')}
          aria-current={view === 'layout' ? 'page' : undefined}
          href={link('layout')}
        >
          {job.stage === 'running' && <i className="live-dot" aria-hidden="true" />}
          {job.stage === 'running' ? 'Live' : 'Result'}
        </a>
        <a
          className={tab('inputs')}
          aria-current={view === 'inputs' ? 'page' : undefined}
          href={link('inputs')}
        >
          Inputs
        </a>
        <span className="spacer" />
        <span className="tabs-note">
          Started {formatWhen(job.submittedAt).toLowerCase()} ·{' '}
          {stale ? `${project.name} has changed since` : "its inputs are the project's now"}
        </span>
        {job.stage !== 'running' && (
          <button className="small tabs-action" onClick={() => setRemoving(true)}>
            Remove job
          </button>
        )}
      </nav>
      {stale && job.stage !== 'running' && (
        <div className="changed-notice" role="status">
          <span className="grow">
            <strong>
              {project.name} has changed since job #{number}.
            </strong>{' '}
            {changes.length
              ? `${changes.join('. ')}.`
              : 'Its inputs are not what this job ran with.'}
          </span>
          <a className="button small" href={href({ page: 'project', id: projectId, tab: 'parts' })}>
            Open project
          </a>
          <button className="small" disabled={submitting} onClick={startRun}>
            {submitting ? 'Starting…' : 'Run the project now'}
          </button>
          <button className="small" onClick={() => copyJob(number)}>
            New project from this job
          </button>
        </div>
      )}
      <main className="main">
        {view === 'inputs' ? (
          <JobInputs job={job} />
        ) : job.stage === 'running' ? (
          <LiveView job={job} run={run} />
        ) : solved ? (
          <SolutionView job={solved} credits={credits} />
        ) : (
          <div className="view">
            <section className="list-panel" aria-label="Result">
              <div className="empty">
                <p>{jobNote(job)}</p>
              </div>
            </section>
            <section className="explanation" />
          </div>
        )}
      </main>
      {removing && (
        <Dialog
          title={`Remove job #${number}`}
          onClose={() => setRemoving(false)}
          actions={
            <>
              <button onClick={() => setRemoving(false)}>Keep</button>
              <button
                className="danger"
                onClick={() => {
                  setRemoving(false);
                  go({ page: 'project', id: projectId, tab: 'jobs' }, { replace: true });
                  removeJob(number);
                }}
              >
                Remove
              </button>
            </>
          }
        >
          <p>
            Remove job #{number} and its result from {project.name}? This cannot be undone.
          </p>
        </Dialog>
      )}
    </>
  );
}

/** What a job ran with: its parts, material, distances and time. */
function JobInputs({ job }: { job: ProjectJob }) {
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
          <div className="list-head">
            <span className="label">Parts</span>
          </div>
          {input.parts.map((part) => (
            <div key={part.id} className="row static">
              <span className="row-text">
                <span>{name(part.id)}</span>
                <span className="muted">
                  {part.orientation.rotation.type === 'continuous'
                    ? 'Any rotation'
                    : `Rotations ${part.orientation.rotation.angles.join('°, ')}°`}
                  {part.orientation.reflection?.includes('x_axis') && ' · may be mirrored'}
                  {part.hole_mode === 'nestable' && ' · parts nest in its holes'}
                </span>
              </span>
              <span className="mono">×{part.quantity}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="explanation" />
    </div>
  );
}
