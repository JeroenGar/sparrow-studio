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

/** What a run tells its owner: a job submitted, one picked up again, and one over, with its document if it has one. */
export type JobEvents = {
  submitted: (jobId: string) => void;
  /** A remembered job is running still, and is followed again. */
  resumed: () => void;
  ended: (document?: JobDocument) => void;
};

/**
 * Runs jobs through the API client and follows them live, also jobs submitted by an earlier page.
 * With `stopOnLeave`, leaving stops the job, for a backend whose jobs end with the page anyway.
 */
export function useJob(
  client: Client,
  events: JobEvents,
  { stopOnLeave }: { stopOnLeave: boolean },
) {
  const [run, setRun] = useState<Run>();
  const following = useRef<AbortController | undefined>(undefined);
  // The job being run, and a stop asked for while it is still being submitted.
  const current = useRef<{ id?: string; stopping: boolean }>({ stopping: false });
  const owner = useRef(events);
  owner.current = events;
  useEffect(
    () => () => {
      following.current?.abort();
      if (!stopOnLeave) return;
      current.current.stopping = true;
      if (current.current.id) void client.stopJob(current.current.id).catch(() => {});
    },
    [client, stopOnLeave],
  );

  /** Starts showing a run of `request`; its updates stop once a newer run starts. */
  const begin = useCallback((request: JobRequest) => {
    following.current?.abort();
    const controller = new AbortController();
    following.current = controller;
    const mine: { id?: string; stopping: boolean } = { stopping: false };
    current.current = mine;
    setRun({ request, history: [] });
    const update = (change: (run: Run) => Run) =>
      !controller.signal.aborted && setRun((current) => current && change(current));
    const fail = (reason: unknown) =>
      update((run) => ({
        ...run,
        error: describeError(reason),
        clock: run.clock && { seconds: elapsed(run), at: performance.now(), stopped: true },
      }));
    return { controller, mine, update, fail };
  }, []);

  /** Follows a job until it ends, then hands on its document. */
  const follow = useCallback(
    async (job: Job, { controller, update }: ReturnType<typeof begin>) => {
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
          const history = [
            ...run.history,
            { seconds: event.data.elapsed_seconds, utilization: event.data.stats.density * 100 },
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
      owner.current.ended(document);
      update((run) => ({ ...run, done: true }));
    },
    [client],
  );

  const start = useCallback(
    async (request: JobRequest) => {
      const runner = begin(request);
      try {
        const job = await client.submitJob(request, crypto.randomUUID());
        runner.mine.id = job.id;
        owner.current.submitted(job.id);
        runner.update((run) => ({ ...run, job }));
        if (runner.mine.stopping) await client.stopJob(job.id);
        await follow(job, runner);
      } catch (reason) {
        if (!runner.controller.signal.aborted) runner.fail(reason);
      }
    },
    [client, begin, follow],
  );

  /**
   * Picks up a job an earlier page submitted: follows it if it still runs, or hands on its
   * document if it ended meanwhile. A job the backend no longer has is over, without a document.
   */
  // Picking up a remembered job, before its run is shown: it counts as running, so no new run starts.
  const [resuming, setResuming] = useState(false);
  const resume = useCallback(
    async (jobId: string) => {
      following.current?.abort();
      const controller = new AbortController();
      following.current = controller;
      current.current = { id: jobId, stopping: false };
      setResuming(true);
      let document: JobDocument;
      try {
        document = await client.getJobDocument(jobId);
      } catch (reason) {
        // A failed request leaves the job remembered, to reconnect to later.
        if (controller.signal.aborted) return;
        setResuming(false);
        if (reason instanceof ApiError && (reason.status === 404 || reason.status === 410))
          owner.current.ended();
        return;
      }
      // A newer run, or leaving, cancels picking up.
      if (controller.signal.aborted) return;
      setResuming(false);
      if (FINAL.includes(document.state.status)) return owner.current.ended(document);
      const stopping = current.current.stopping;
      const runner = begin({ input: document.input, settings: document.settings });
      runner.mine.id = jobId;
      owner.current.resumed();
      try {
        if (stopping) await client.stopJob(jobId);
        await follow(await client.getJob(jobId), runner);
      } catch (reason) {
        if (!runner.controller.signal.aborted) runner.fail(reason);
      }
    },
    [client, begin, follow],
  );

  const stop = useCallback(() => {
    current.current.stopping = true;
    const id = current.current.id;
    if (id && !isFinal(run?.job)) void client.stopJob(id);
  }, [client, run?.job]);

  // A run goes on until its result is handed on, so a new one cannot cut it short.
  const running = resuming || (!!run && !run.error && !run.done);
  // Submitted, but the backend has not answered with the job yet.
  const submitting = !!run && !run.job && !run.error;
  return { run, running, submitting, start, resume, stop };
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
