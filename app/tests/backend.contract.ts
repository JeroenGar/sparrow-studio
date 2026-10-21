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
  for await (const event of client.streamJobEvents(job.id, { search: true, signal })) {
    if (event.type === 'status') statuses.push(event.data);
    // Each better layout comes with the statistics its outcome would have.
    if (event.type === 'snapshot') expect(event.data.stats.layouts[0].cut_x).toBeGreaterThan(0);
  }
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

  it(
    'keeps summaries and document bytes, and refuses a save over a stale version',
    { timeout: 30_000 },
    async () => {
      const bytes = (step: number) => new Blob([new Uint8Array([0x1f, 0x8b, step, 0, 255])]);
      const created = await client().createProject(
        { name: 'Integration test', summary: { step: 1 }, document: bytes(1) },
        crypto.randomUUID(),
      );
      let current = created.version;
      const id = created.project.id;
      try {
        expect(created.project.summary).toEqual({ step: 1 });
        expect(created.project).not.toHaveProperty('document');
        const saved = await client().saveProject(
          id,
          { name: 'Integration test', summary: { step: 2 }, document: bytes(2) },
          current,
        );
        current = saved.version;
        expect(current).not.toBe(created.version);

        const stale = await refusal(
          client().saveProject(
            id,
            { name: 'Integration test', document: bytes(3) },
            created.version,
          ),
        );
        expect(stale.status).toBe(412);
        expect(withCode(stale.error, 'version_conflict')).toBeDefined();

        const stored = await client().getProjectDocument(id);
        expect([...new Uint8Array(await stored.document.arrayBuffer())]).toEqual([
          0x1f, 0x8b, 2, 0, 255,
        ]);
        expect(stored.version).toBe(current);
        const listed = (await client().listProjects()).data.find((project) => project.id === id);
        expect(listed?.summary).toEqual({ step: 2 });

        const large = await refusal(
          client().saveProject(
            id,
            { name: 'Integration test', summary: 'x'.repeat(16 * 1024), document: bytes(4) },
            current,
          ),
        );
        expect(large.status).toBe(422);
        expect(withCode(large.error, 'limit_exceeded')?.limit.name).toBe(
          'max_project_summary_bytes',
        );
        expect(large.error?.param).toBe('summary');
      } finally {
        await client().deleteProject(id, current);
      }
      expect((await refusal(client().getProject(id))).status).toBe(404);
    },
  );
}
