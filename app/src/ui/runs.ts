import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, type Client, type Job, type JobRequest, type Schemas } from '../api/client';
import {
  addJob,
  endJob,
  hasEnded,
  jobNames,
  nextJobNumber,
  runningJobs,
  type EndedDocument,
} from '../project/model';
import { projectRequest } from '../project/solution';
import { explain } from './explain';
import { patiently } from './patiently';
import type { Workspace } from './workspace';

/** A job being followed live: what was asked, and what has come back so far. */
export type Run = {
  projectId: string;
  request: JobRequest;
  /** The job's latest status, once the backend answered. */
  job?: Job;
  /** The best feasible layout so far. */
  best?: Schemas['Snapshot'];
  /** The layout the search is working on, which may overlap. */
  search?: Schemas['Search'];
  /** The utilization of each better layout, in percent, by the second it arrived. */
  history: { seconds: number; utilization: number }[];
  /** Followed again, such as after the page reopened: what came before is not shown. */
  resumed: boolean;
  /** Asked to stop: it ends with the best layout found so far. */
  stopping: boolean;
  /** Why following stopped before the job ended, such as a lost connection. */
  error?: string;
  /**
   * The job's solver time at a moment of this page's clock, from the events' own elapsed time:
   * the server's timestamps need not agree with this computer's clock. Stopped once the job ends.
   */
  clock?: { seconds: number; at: number; stopped: boolean };
};

/** The job's solver time now, in seconds. */
export function elapsed(run: Run | undefined, now = performance.now()): number {
  const clock = run?.clock;
  if (!clock) return 0;
  return clock.stopped ? clock.seconds : clock.seconds + Math.max(0, now - clock.at) / 1000;
}

/** A clock for the job: set by an event's elapsed time, started by its start, stopped by its end. */
function tick(run: Run, job: Job, seconds?: number): Run['clock'] {
  const at = performance.now();
  if (isFinal(job)) return run.clock && { seconds: elapsed(run, at), at, stopped: true };
  // An event can arrive a moment late; the clock never runs backwards for it.
  if (seconds !== undefined)
    return { seconds: Math.max(seconds, elapsed(run, at)), at, stopped: false };
  if (job.state.status === 'running') return run.clock ?? { seconds: 0, at, stopped: false };
  return run.clock;
}

const FINAL = ['completed', 'cancelled', 'failed'];
export const isFinal = (job?: Job) => !!job && FINAL.includes(job.state.status);
/** Whether the backend no longer has a job: it ended without studio keeping how. */
const isGone = (reason: unknown) =>
  reason instanceof ApiError && (reason.status === 404 || reason.status === 410);

/**
 * Follows every running job of every project, live, and records in its project how it ended,
 * whether or not the project is shown. A job the projects record as running is followed as soon
 * as the workspace has it, such as when studio opens: a job in this browser that was running
 * when the page closed is found gone, and recorded as lost.
 */
export function createRunner(client: Client, workspace: Workspace) {
  const runs = new Map<string, Run>();
  const following = new Map<string, AbortController>();
  // The projects with a job being submitted, replaced on each change for the pages to compare.
  let submitting: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const update = (jobId: string, change: (run: Run) => Run) => {
    const run = runs.get(jobId);
    if (!run) return;
    runs.set(jobId, change(run));
    emit();
  };
  const forget = (jobId: string) => {
    following.get(jobId)?.abort();
    following.delete(jobId);
    runs.delete(jobId);
    emit();
  };
  /**
   * Records how a job ended, with its document or lost without one, in every project that has it
   * running: a project file opened twice holds the same job.
   */
  const record = (jobId: string, document?: EndedDocument) => {
    const state = workspace.get();
    if (state.status !== 'ready') return;
    for (const entry of state.projects)
      if (
        entry.status === 'open' &&
        runningJobs(entry.history.present).some((job) => job.id === jobId)
      )
        workspace.results(entry.id, (present) => ({
          jobs: endJob(present, jobId, document).jobs,
        }));
  };

  /** Follows a job until it ends, then records its document in its project. */
  async function follow(projectId: string, jobId: string, request: JobRequest, resumed: boolean) {
    following.get(jobId)?.abort();
    const controller = new AbortController();
    following.set(jobId, controller);
    const stopping = runs.get(jobId)?.stopping ?? false;
    runs.set(jobId, { projectId, request, history: [], resumed, stopping });
    emit();
    const live = (change: (run: Run) => Run) => !controller.signal.aborted && update(jobId, change);
    try {
      let job = await client.getJob(jobId);
      live((run) => ({ ...run, job, clock: tick(run, job) }));
      if (runs.get(jobId)?.stopping && !isFinal(job))
        await client.stopJob(jobId).catch(() => live((run) => ({ ...run, stopping: false })));
      if (!isFinal(job)) {
        for await (const event of client.streamJobEvents(jobId, {
          search: true,
          signal: controller.signal,
        })) {
          if (event.type === 'status') job = event.data;
          live((run) => {
            if (event.type === 'status')
              return { ...run, job: event.data, clock: tick(run, event.data) };
            const clock = run.job && tick(run, run.job, event.data.elapsed_seconds);
            if (event.type === 'search') return { ...run, search: event.data, clock };
            const history = [
              ...run.history,
              { seconds: event.data.elapsed_seconds, utilization: event.data.stats.density * 100 },
            ];
            return { ...run, best: event.data, history, clock };
          });
        }
        // The stream can end before the job, such as when the connection drops.
        if (!isFinal(job)) job = await client.getJob(jobId);
        if (!isFinal(job)) throw Error('Lost the connection to the running job.');
        live((run) => ({ ...run, job, clock: tick(run, job) }));
      }
      const document = await client.getJobDocument(jobId);
      if (controller.signal.aborted) return;
      if (!hasEnded(document)) throw Error('The job ended, but its record does not say so yet.');
      // Let go first: once recorded, no project has the job running to keep it followed.
      forget(jobId);
      record(jobId, document);
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (isGone(reason)) {
        forget(jobId);
        record(jobId);
        return;
      }
      // Following stops here; the job may well run on, and can be followed again.
      live((run) => ({
        ...run,
        error: explain(reason),
        clock: run.clock && { seconds: elapsed(run), at: performance.now(), stopped: true },
      }));
    }
  }

  // The jobs each project had running when it was last open: a project loading again, or
  // failing to, still holds them.
  const held = new Map<string, string[]>();
  // Follow every job the projects record as running and that is not followed yet. One no project
  // holds any more, such as a job of a project deleted, is stopped and let go.
  workspace.subscribe(() => {
    const state = workspace.get();
    if (state.status !== 'ready') return;
    const present = new Set(state.projects.map((entry) => entry.id));
    for (const id of held.keys()) if (!present.has(id)) held.delete(id);
    // The open projects holding each job.
    const holders = new Map<string, string[]>();
    for (const entry of state.projects) {
      if (entry.status !== 'open') continue;
      const jobs = runningJobs(entry.history.present);
      held.set(
        entry.id,
        jobs.map((job) => job.id),
      );
      for (const job of jobs) {
        holders.set(job.id, [...(holders.get(job.id) ?? []), entry.id]);
        if (!runs.has(job.id)) void follow(entry.id, job.id, job.request, true);
      }
    }
    const kept = new Set([...held.values()].flat());
    for (const [jobId, run] of [...runs]) {
      const open = holders.get(jobId);
      // A job a project file opened twice holds is followed for a project that holds it still.
      if (open && !open.includes(run.projectId)) runs.set(jobId, { ...run, projectId: open[0] });
      else if (!kept.has(jobId)) {
        void patiently(() => client.stopJob(jobId)).catch(() => {});
        forget(jobId);
      }
    }
  });

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** The run of a job, while it is followed. */
    get: (jobId: string) => runs.get(jobId),
    isSubmitting: (projectId: string) => submitting.has(projectId),
    /** Whether a job is being submitted: closing the page now could lose it. */
    pending: () => submitting.size > 0,
    /** Whether a job in this browser is running: it ends with the page. */
    running: () => [...runs.values()].some((run) => !run.error),

    /**
     * Submits a job of the project's inputs as they are now, and records it as the project's next
     * job. Resolves to its number.
     */
    async start(projectId: string): Promise<number> {
      const entry = workspace.find(projectId);
      if (entry?.status !== 'open') throw Error('The project is not open.');
      // One submission per project at a time, so a second click does not submit a second job.
      if (submitting.has(projectId)) throw Error('A job of this project is being submitted.');
      const project = entry.history.present;
      const request = projectRequest(project);
      const names = jobNames(project);
      submitting = new Set([...submitting, projectId]);
      emit();
      try {
        const job = await client.submitJob(request, crypto.randomUUID());
        const current = workspace.find(projectId);
        // A project deleted meanwhile has no place for the job.
        if (current?.status !== 'open') {
          void client.stopJob(job.id).catch(() => {});
          throw Error('The project was deleted, so its job was stopped.');
        }
        const number = nextJobNumber(current.history.present);
        // Followed before it is recorded, so recording it does not start following it again.
        void follow(projectId, job.id, request, false);
        workspace.results(projectId, (present) => ({
          jobs: addJob(present, job.id, request, names).jobs,
        }));
        return number;
      } finally {
        submitting = new Set([...submitting].filter((id) => id !== projectId));
        emit();
      }
    },

    /**
     * Asks a job to stop; it ends with the best layout found so far. A request that fails leaves
     * the job running, to be stopped again.
     */
    async stop(jobId: string) {
      update(jobId, (run) => ({ ...run, stopping: true }));
      if (isFinal(runs.get(jobId)?.job)) return;
      try {
        await client.stopJob(jobId);
      } catch (reason) {
        if (isGone(reason)) return;
        update(jobId, (run) => ({ ...run, stopping: false }));
        throw reason;
      }
    },

    /** Follows a job again after following it stopped, such as when the connection dropped. */
    reconnect(jobId: string) {
      const run = runs.get(jobId);
      if (run?.error) void follow(run.projectId, jobId, run.request, true);
    },
  };
}

export type Runner = ReturnType<typeof createRunner>;

/** A job's run, kept current; undefined once it is no longer followed. */
export const useRun = (runner: Runner, jobId: string | undefined) =>
  useSyncExternalStore(runner.subscribe, () => (jobId ? runner.get(jobId) : undefined));

/** A job's best layout so far, kept current; it changes less often than the run. */
export const useBest = (runner: Runner, jobId: string | undefined) =>
  useSyncExternalStore(runner.subscribe, () => (jobId ? runner.get(jobId)?.best : undefined));

/** Whether a job of the project is being submitted, kept current. */
export const useSubmitting = (runner: Runner, projectId: string) =>
  useSyncExternalStore(runner.subscribe, () => runner.isSubmitting(projectId));

/** This page's clock, read once per animation frame while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    let frame = requestAnimationFrame(function next(time) {
      setNow(time);
      frame = requestAnimationFrame(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return now;
}
