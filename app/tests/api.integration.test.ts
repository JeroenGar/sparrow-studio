// Runs the client against a real Sparrow Pro API, such as the local Docker Compose stack, when
// SPARROW_API_URL (with /v1) and SPARROW_API_KEY are set; skipped otherwise. Each run submits a few
// jobs, and every completed job costs at least 60 credits, so grant the key's account enough.
import { describe, expect, it } from 'vitest';
import { createClient } from '../src/api/client';
import { backendContract } from './backend.contract';

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
});
