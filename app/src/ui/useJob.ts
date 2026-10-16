import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  withCode,
  type Client,
  type Job,
  type JobDocument,
  type JobRequest,
  type Schemas,
} from '../api/client';
import { drawable, utilization } from '../project/solution';

/** A run of one job through the API: what was asked, and what has come back so far. */
export type Run = {
  request: JobRequest;
  /** The job's latest status, once it is submitted. */
  job?: Job;
  /** The best feasible layout so far. */
  best?: Schemas['Snapshot'];
  /** The layout the search is working on, which may overlap. */
  search?: Schemas['Search'];
  /** The utilization of each better layout, in percent, by the second it arrived. */
  history: { seconds: number; utilization: number }[];
  /** Why the run could not go on: a refused submission, or a lost connection. */
  error?: string;
  /** The finished job's document has been handed on. */
  done?: boolean;
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

/** Says what went wrong in words for the run's status, telling missing features apart. */
export function describeError(reason: unknown): string {
  if (!(reason instanceof ApiError))
    return reason instanceof Error ? reason.message : String(reason);
  const unavailable = withCode(reason.error, 'feature_unavailable');
  if (unavailable) return unavailable.field_errors[0]?.message ?? reason.message;
  return withCode(reason.error, 'invalid_job_input')?.field_errors[0]?.message ?? reason.message;
}

/**
 * Runs jobs through the API client and follows them live. `onDocument` receives each finished
 * job's document, completed or not.
 */
export function useJob(client: Client, onDocument: (document: JobDocument) => void) {
  const [run, setRun] = useState<Run>();
  const following = useRef<AbortController | undefined>(undefined);
  // The job being run, and a stop asked for while it is still being submitted.
  const current = useRef<{ id?: string; stopping: boolean }>({ stopping: false });
  const finished = useRef(onDocument);
  finished.current = onDocument;
  // Leaving, such as for another project, stops the job: nothing would save its result.
  useEffect(
    () => () => {
      following.current?.abort();
      current.current.stopping = true;
      if (current.current.id) void client.stopJob(current.current.id).catch(() => {});
    },
    [client],
  );

  const start = useCallback(
    async (request: JobRequest) => {
      following.current?.abort();
      const controller = new AbortController();
      following.current = controller;
      const update = (change: (run: Run) => Run) =>
        !controller.signal.aborted && setRun((current) => current && change(current));
      const mine = { stopping: false } as { id?: string; stopping: boolean };
      current.current = mine;
      setRun({ request, history: [] });
      try {
        let job = await client.submitJob(request, crypto.randomUUID());
        mine.id = job.id;
        update((run) => ({ ...run, job }));
        if (mine.stopping) await client.stopJob(job.id);
        for await (const event of client.streamJobEvents(job.id, {
          search: true,
          signal: controller.signal,
        })) {
          if (event.type === 'status') job = event.data;
          update((run) => {
            if (event.type === 'status')
              return { ...run, job: event.data, clock: tick(run, event.data) };
            const clock = run.job && tick(run, run.job, event.data.elapsed_seconds);
            if (event.type === 'search') return { ...run, search: event.data, clock };
            const percent = utilization(drawable(request.input, event.data.solution));
            const history = [
              ...run.history,
              { seconds: event.data.elapsed_seconds, utilization: percent },
            ];
            return { ...run, best: event.data, history, clock };
          });
        }
        // The stream can end before the job, such as when the connection drops.
        if (!isFinal(job)) job = await client.getJob(job.id);
        if (!isFinal(job)) throw Error('Lost the connection to the running job.');
        update((run) => ({ ...run, job, clock: tick(run, job) }));
        const document = await client.getJobDocument(job.id);
        // A newer run, or leaving, makes this one's result too late to keep.
        if (controller.signal.aborted) return;
        finished.current(document);
        update((run) => ({ ...run, done: true }));
      } catch (reason) {
        if (!controller.signal.aborted)
          update((run) => ({
            ...run,
            error: describeError(reason),
            clock: run.clock && { seconds: elapsed(run), at: performance.now(), stopped: true },
          }));
      }
    },
    [client],
  );

  const stop = useCallback(() => {
    current.current.stopping = true;
    if (run?.job && !isFinal(run.job)) void client.stopJob(run.job.id);
  }, [client, run?.job]);

  // A run goes on until its result is handed on, so a new one cannot cut it short.
  const running = !!run && !run.error && !run.done;
  return { run, running, start, stop };
}

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
