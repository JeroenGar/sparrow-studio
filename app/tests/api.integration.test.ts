// Runs the client against a real Sparrow Pro API, such as the local Docker Compose stack, when
// SPARROW_API_URL (with /v1) and SPARROW_API_KEY are set; skipped otherwise. Each run submits one
// job, and every completed job costs at least 60 credits, so grant the key's account enough.
import { describe, expect, it } from 'vitest';
import { ApiError, createClient, withCode, type Job } from '../src/api/client';
import { stripInput } from './fixtures/api-input';

const url = process.env.SPARROW_API_URL;
const key = process.env.SPARROW_API_KEY;
const FINAL = ['completed', 'cancelled', 'failed'];

/** The API's refusal of a request that must fail. */
async function refusal(request: Promise<unknown>): Promise<ApiError> {
  try {
    await request;
  } catch (reason) {
    if (reason instanceof ApiError) return reason;
    throw reason;
  }
  throw new Error('The API accepted a request it should refuse.');
}

describe.skipIf(!url || !key)('the API', () => {
  const client = createClient({
    baseUrl: url!,
    fetch: (request) => {
      const headers = new Headers(request.headers);
      headers.set('Authorization', `Bearer ${key}`);
      return fetch(new Request(request, { headers }));
    },
  });

  it('validates, runs and streams a job', { timeout: 90_000 }, async () => {
    const request = { settings: { time_limit_seconds: 2, seed: 7 }, input: stripInput };
    await expect(client.validateJob(request)).resolves.toBeUndefined();
    const invalid = await refusal(
      client.validateJob({ ...request, input: { ...stripInput, parts: [] } }),
    );
    expect(withCode(invalid.error, 'invalid_job_input')?.field_errors.length).toBeGreaterThan(0);

    const submitted = await client.submitJob(request, crypto.randomUUID());
    let last: Job = submitted;
    const deadline = AbortSignal.timeout(60_000);
    try {
      for await (const event of client.streamJobEvents(submitted.id, {
        search: true,
        signal: deadline,
      }))
        if (event.type === 'status') last = event.data;
      // The stream may end early; then the job itself says whether it ended.
      if (!FINAL.includes(last.state.status)) last = await client.getJob(submitted.id);
      expect(last.state.status, 'the stream ended before the job').toBe('completed');

      const document = await client.getJobDocument(submitted.id);
      expect(document.outcome?.solution.layouts.map((layout) => layout.sheet_id)).toEqual([
        'strip',
      ]);
      expect(document.outcome?.solution.layouts[0].placements).toHaveLength(5);
    } finally {
      if (!FINAL.includes(last.state.status)) await client.stopJob(submitted.id).catch(() => {});
    }
  });

  it('refuses a save over a stale version', { timeout: 30_000 }, async () => {
    const created = await client.createProject(
      { name: 'Integration test', document: { step: 1 } },
      crypto.randomUUID(),
    );
    let current = created.version;
    try {
      const saved = await client.saveProject(
        created.project.id,
        { name: 'Integration test', document: { step: 2 } },
        current,
      );
      current = saved.version;
      expect(current).not.toBe(created.version);

      const stale = await refusal(
        client.saveProject(
          created.project.id,
          { name: 'Integration test', document: { step: 3 } },
          created.version,
        ),
      );
      expect(stale.status).toBe(412);
      expect(withCode(stale.error, 'version_conflict')).toBeDefined();

      const stored = await client.getProject(created.project.id);
      expect(stored.project.document).toEqual({ step: 2 });
      expect(stored.version).toBe(current);
    } finally {
      await client.deleteProject(created.project.id, current);
    }
    expect((await refusal(client.getProject(created.project.id))).status).toBe(404);
  });
});
