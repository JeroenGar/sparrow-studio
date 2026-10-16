// What every backend behind the API client must do: the local backend and the hosted API alike.
import { expect, it } from 'vitest';
import { ApiError, withCode, type Client, type Job, type JobRequest } from '../src/api/client';
import { stripInput } from './fixtures/api-input';

const FINAL = ['completed', 'cancelled', 'failed'];

/** The API's refusal of a request that must fail. */
export async function refusal(request: Promise<unknown>): Promise<ApiError> {
  try {
    await request;
  } catch (reason) {
    if (reason instanceof ApiError) return reason;
    throw reason;
  }
  throw new Error('The API accepted a request it should refuse.');
}

/** Follows a job live until it ends, and returns every status it streamed. */
export async function follow(client: Client, job: Job, signal: AbortSignal) {
  const statuses: Job[] = [];
  for await (const event of client.streamJobEvents(job.id, { search: true, signal }))
    if (event.type === 'status') statuses.push(event.data);
  return statuses;
}

export function backendContract(client: () => Client, { timeout }: { timeout: number }) {
  const request: JobRequest = { settings: { time_limit_seconds: 2, seed: 7 }, input: stripInput };

  it('validates, and tells invalid input apart', { timeout }, async () => {
    await expect(client().validateJob(request)).resolves.toBeUndefined();
    const invalid = await refusal(
      client().validateJob({ ...request, input: { ...stripInput, parts: [] } }),
    );
    expect(invalid.status).toBe(400);
    expect(withCode(invalid.error, 'invalid_job_input')?.field_errors.length).toBeGreaterThan(0);
  });

  it('runs a job, streaming its status until it ends', { timeout }, async () => {
    const submitted = await client().submitJob(request, crypto.randomUUID());
    let last = submitted;
    try {
      const statuses = await follow(client(), submitted, AbortSignal.timeout(timeout - 5000));
      // The stream sends the job's status on connection, at least.
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses.every((status) => status.id === submitted.id)).toBe(true);
      last = statuses.at(-1)!;
      // The stream may end early; then the job itself says whether it ended.
      if (!FINAL.includes(last.state.status)) last = await client().getJob(submitted.id);
      expect(last.state.status, 'the stream ended before the job').toBe('completed');
      const document = await client().getJobDocument(submitted.id);
      expect(document.outcome?.solution.layouts.map((layout) => layout.sheet_id)).toEqual([
        'strip',
      ]);
      expect(document.outcome?.solution.layouts[0].placements).toHaveLength(5);
      expect(document.outcome?.stats.layouts[0].cut_x).toBeGreaterThan(0);
    } finally {
      if (!FINAL.includes(last.state.status))
        await client()
          .stopJob(submitted.id)
          .catch(() => {});
    }
  });

  it('runs a submission once, whatever the retries', { timeout }, async () => {
    const key = crypto.randomUUID();
    const first = await client().submitJob(request, key);
    try {
      expect((await client().submitJob(request, key)).id).toBe(first.id);
      const conflict = await refusal(
        client().submitJob({ ...request, settings: { time_limit_seconds: 3 } }, key),
      );
      expect(conflict.status).toBe(409);
      expect(withCode(conflict.error, 'idempotency_conflict')).toBeDefined();
    } finally {
      await client().stopJob(first.id);
    }
  });

  it('stops a job, ending it and its stream', { timeout }, async () => {
    const submitted = await client().submitJob(
      { ...request, settings: { time_limit_seconds: 30 } },
      crypto.randomUUID(),
    );
    const following = follow(client(), submitted, AbortSignal.timeout(timeout - 5000));
    await client().stopJob(submitted.id);
    const statuses = await following;
    const last = statuses.at(-1)!;
    expect(FINAL).toContain(last.state.status);
    if (last.state.status === 'completed') expect(last.state.termination).toBe('stopped');
  });

  it('knows no other jobs', { timeout }, async () => {
    const missing = await refusal(client().getJob('job_missing'));
    expect(missing.status).toBe(404);
    expect(withCode(missing.error, 'not_found')).toBeDefined();
  });
}
