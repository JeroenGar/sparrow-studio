// Runs the client against a real Sparrow Pro API, such as the local Docker Compose stack, when
// SPARROW_API_URL (with /v1) and SPARROW_API_KEY are set; skipped otherwise. Each run submits a few
// jobs, and every completed job costs at least 60 credits, so grant the key's account enough.
import { describe, expect, it } from 'vitest';
import { createClient, withCode } from '../src/api/client';
import { backendContract, refusal } from './backend.contract';

const url = process.env.SPARROW_API_URL;
const key = process.env.SPARROW_API_KEY;
describe.skipIf(!url || !key)('the API', () => {
  const client = createClient({
    baseUrl: url!,
    fetch: (request) => {
      const headers = new Headers(request.headers);
      headers.set('Authorization', `Bearer ${key}`);
      return fetch(new Request(request, { headers }));
    },
  });

  backendContract(() => client, { timeout: 90_000 });

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
