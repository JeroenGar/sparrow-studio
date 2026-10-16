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
};

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
  // A stop asked for while the job is still being submitted, applied once it is.
  const stopping = useRef(false);
  const finished = useRef(onDocument);
  finished.current = onDocument;
  useEffect(() => () => following.current?.abort(), []);

  const start = useCallback(
    async (request: JobRequest) => {
      following.current?.abort();
      const controller = new AbortController();
      following.current = controller;
      const update = (change: (run: Run) => Run) =>
        !controller.signal.aborted && setRun((current) => current && change(current));
      stopping.current = false;
      setRun({ request, history: [] });
      try {
        let job = await client.submitJob(request, crypto.randomUUID());
        update((run) => ({ ...run, job }));
        if (stopping.current) await client.stopJob(job.id);
        for await (const event of client.streamJobEvents(job.id, {
          search: true,
          signal: controller.signal,
        })) {
          if (event.type === 'status') job = event.data;
          update((run) => {
            if (event.type === 'status') return { ...run, job: event.data };
            if (event.type === 'search') return { ...run, search: event.data };
            const percent = utilization(drawable(request.input, event.data.solution));
            const history = [
              ...run.history,
              { seconds: event.data.elapsed_seconds, utilization: percent },
            ];
            return { ...run, best: event.data, history };
          });
        }
        // The stream can end before the job, such as when the connection drops.
        if (!isFinal(job)) job = await client.getJob(job.id);
        if (!isFinal(job)) throw Error('Lost the connection to the running job.');
        update((run) => ({ ...run, job }));
        if (!controller.signal.aborted) finished.current(await client.getJobDocument(job.id));
      } catch (reason) {
        if (!controller.signal.aborted) update((run) => ({ ...run, error: describeError(reason) }));
      }
    },
    [client],
  );

  const stop = useCallback(() => {
    stopping.current = true;
    if (run?.job && !isFinal(run.job)) void client.stopJob(run.job.id);
  }, [client, run?.job]);

  const running = !!run && !run.error && !isFinal(run.job);
  return { run, running, start, stop };
}
