import { describe, expect, it } from 'vitest';
import { ApiError, createClient, withCode, type JobEvent } from '../src/api/client';
import { readEvents } from '../src/api/sse';
import { stripInput } from './fixtures/api-input';

const BASE = 'https://api.example.test/v1';
const job = {
  id: 'job_1',
  state: { status: 'running' },
  created_at: '2026-10-16T00:00:00Z',
  started_at: null,
  finished_at: null,
  document_expires_at: null,
  settings: { time_limit_seconds: 5, auto_termination: false, seed: 1, on_input_error: 'fallback' },
  credits: { held: 60, charged: 0 },
};
const project = {
  id: 'prj_1',
  name: 'Brackets',
  created_at: '2026-10-16T00:00:00Z',
  updated_at: '2026-10-16T00:00:00Z',
  summary: { parts: 3 },
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** A client whose `fetch` records each request and answers with `reply`. */
function stub(reply: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const client = createClient({
    baseUrl: BASE,
    fetch: async (request) => {
      requests.push(request.clone());
      return reply(request);
    },
  });
  return { client, requests };
}

/** A stream of the given chunks, as text or raw bytes. */
function chunks(...parts: (string | Uint8Array)[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts)
        controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part);
      controller.close();
    },
  });
}

async function collect<T>(events: AsyncIterable<T>) {
  const all: T[] = [];
  for await (const event of events) all.push(event);
  return all;
}

describe('requests', () => {
  it('sends each operation to its path under the base URL', async () => {
    const { client, requests } = stub((request) =>
      request.method === 'DELETE' || request.url.endsWith('/validate')
        ? new Response(null, { status: 204 })
        : request.url.includes('/projects')
          ? json(project, 200, { ETag: '"v1"' })
          : json(job),
    );
    await client.validateJob({ settings: { time_limit_seconds: 5 }, input: stripInput });
    await client.submitJob({ settings: { time_limit_seconds: 5 }, input: stripInput }, 'key-1');
    await client.getJob('job_1');
    await client.stopJob('job_1');
    await client.getProject('prj_1');
    await client.deleteProject('prj_1', '"v1"');
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `POST ${BASE}/jobs/validate`,
      `POST ${BASE}/jobs`,
      `GET ${BASE}/jobs/job_1`,
      `POST ${BASE}/jobs/job_1/stop`,
      `GET ${BASE}/projects/prj_1`,
      `DELETE ${BASE}/projects/prj_1`,
    ]);
    expect(requests[1].headers.get('Idempotency-Key')).toBe('key-1');
    expect(await requests[1].json()).toEqual({
      settings: { time_limit_seconds: 5 },
      input: stripInput,
    });
    expect(requests[5].headers.get('If-Match')).toBe('"v1"');
  });

  it('returns nothing for a 204', async () => {
    const { client } = stub(() => new Response(null, { status: 204 }));
    await expect(
      client.validateJob({ settings: { time_limit_seconds: 5 }, input: stripInput }),
    ).resolves.toBeUndefined();
  });
});

describe('versions', () => {
  it('returns the exact ETag with every project, and saves with it', async () => {
    const { client, requests } = stub((request) =>
      json(project, request.method === 'POST' ? 201 : 200, {
        ETag: request.method === 'PUT' ? '"v2"' : '"v1"',
      }),
    );
    const document = new Blob(['bytes as chosen']);
    const created = await client.createProject(
      { name: 'Brackets', summary: { parts: 3 }, document },
      'key-2',
    );
    expect(created).toEqual({ project, version: '"v1"' });
    expect(requests[0].headers.get('Idempotency-Key')).toBe('key-2');
    const saved = await client.saveProject(
      'prj_1',
      { name: 'Brackets', document },
      created.version,
    );
    expect(saved.version).toBe('"v2"');
    expect(requests[1].headers.get('If-Match')).toBe('"v1"');
  });

  it('saves a project as its parts, and reads its document as bytes', async () => {
    const { client, requests } = stub((request) =>
      request.url.endsWith('/document')
        ? new Response('stored bytes', {
            headers: { 'Content-Type': 'application/octet-stream', ETag: '"v3"' },
          })
        : json(project, 201, { ETag: '"v1"' }),
    );
    await client.createProject(
      { name: 'Brackets', summary: { parts: 3 }, document: new Blob(['bytes']) },
      'key-3',
    );
    expect(requests[0].headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/);
    const form = await requests[0].formData();
    expect(form.get('name')).toBe('Brackets');
    expect(JSON.parse(await (form.get('summary') as Blob).text())).toEqual({ parts: 3 });
    expect(await (form.get('document') as Blob).text()).toBe('bytes');
    // Without a summary, the part is left out, and the save clears it.
    await client.createProject({ name: 'Brackets', document: new Blob(['bytes']) }, 'key-4');
    expect((await requests[1].formData()).has('summary')).toBe(false);

    const { document, version } = await client.getProjectDocument('prj_1');
    expect(requests[2].url).toBe(`${BASE}/projects/prj_1/document`);
    expect(await document.text()).toBe('stored bytes');
    expect(version).toBe('"v3"');
  });

  it('refuses a project without a version', async () => {
    const { client } = stub(() => json(project));
    await expect(client.getProject('prj_1')).rejects.toThrow('without its version');
  });
});

describe('errors', () => {
  const invalid = {
    error: {
      code: 'invalid_job_input',
      message: 'Geometry plate is not closed.',
      param: '/input/geometries/0',
      doc_url: null,
      field_errors: [{ param: '/input/geometries/0', message: 'Not closed.' }],
    },
  };

  it('keeps the status, the headers and the typed error', async () => {
    const { client } = stub(() => json(invalid, 400, { 'X-Request-Id': 'req_1' }));
    const error: unknown = await client
      .validateJob({ settings: { time_limit_seconds: 5 }, input: stripInput })
      .catch((reason) => reason);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.headers.get('X-Request-Id')).toBe('req_1');
    expect(apiError.message).toBe('Geometry plate is not closed.');
    expect(withCode(apiError.error, 'invalid_job_input')?.field_errors).toHaveLength(1);
    expect(withCode(apiError.error, 'feature_unavailable')).toBeUndefined();
  });

  it('tells a feature that needs Sparrow Pro from an error', async () => {
    const unavailable = {
      error: {
        ...invalid.error,
        code: 'feature_unavailable',
        message: 'Reflection needs Sparrow Pro.',
      },
    };
    const { client } = stub(() => json(unavailable, 422));
    const error = (await client
      .validateJob({ settings: { time_limit_seconds: 5 }, input: stripInput })
      .catch((reason) => reason)) as ApiError;
    expect(withCode(error.error, 'feature_unavailable')?.field_errors[0].param).toBe(
      '/input/geometries/0',
    );
    expect(withCode(error.error, 'invalid_job_input')).toBeUndefined();
  });

  it('keeps unknown codes', async () => {
    const { client } = stub(() =>
      json({ error: { code: 'brand_new', message: 'New.', param: null, doc_url: null } }, 409),
    );
    const error = (await client.getJob('job_1').catch((reason) => reason)) as ApiError;
    expect(error.error?.code).toBe('brand_new');
  });

  it('survives an error page and an empty error', async () => {
    const { client } = stub((request) =>
      request.url.endsWith('job_1')
        ? new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' })
        : new Response(null, { status: 503, headers: { 'Retry-After': '5' } }),
    );
    const page = (await client.getJob('job_1').catch((reason) => reason)) as ApiError;
    expect(page.status).toBe(502);
    expect(page.error).toBeUndefined();
    expect(page.message).toBe('The API answered 502 Bad Gateway');
    const empty = (await client.getJob('job_2').catch((reason) => reason)) as ApiError;
    expect(empty.status).toBe(503);
    expect(empty.headers.get('Retry-After')).toBe('5');
    expect(empty.error).toBeUndefined();
  });
});

describe('live events', () => {
  const stream = (body: ReadableStream<Uint8Array>) =>
    new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });

  it('asks for search events and types each event', async () => {
    const { client, requests } = stub(() =>
      stream(
        chunks(
          `event: status\ndata: ${JSON.stringify(job)}\n\n`,
          'event: snapshot\nid: 3\ndata: {"sequence":3,"elapsed_seconds":1.5,',
          '"solution":{"layouts":[]}}\n\nevent: unknown\ndata: {}\n\n',
          'event: search\ndata: {"sequence":4,"elapsed_seconds":1.6,"solution":{"layouts":[]}}\n\n',
        ),
      ),
    );
    const events = await collect(client.streamJobEvents('job_1', { search: true }));
    expect(requests[0].url).toBe(`${BASE}/jobs/job_1/events?search=true`);
    expect(events.map((event) => event.type)).toEqual(['status', 'snapshot', 'search']);
    expect((events[1] as Extract<JobEvent, { type: 'snapshot' }>).data.sequence).toBe(3);
  });

  it('cancels the stream when the loop stops early', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(
          new TextEncoder().encode(`event: status\ndata: ${JSON.stringify(job)}\n\n`),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const { client } = stub(() => stream(body));
    for await (const event of client.streamJobEvents('job_1')) {
      expect(event.type).toBe('status');
      break;
    }
    expect(cancelled).toBe(true);
  });

  it('stops a stalled stream on abort', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const reading = collect(readEvents(body, controller.signal));
    controller.abort(new Error('Left the Live tab.'));
    await expect(reading).rejects.toThrow('Left the Live tab.');
    expect(cancelled).toBe(true);
  });
});

describe('the event stream reader', () => {
  it('reads multi-line data, comments, ids and every line ending', async () => {
    const events = await collect(
      readEvents(
        chunks(': heartbeat\r\nevent: a\r\nid: 7\rdata: one\ndata:two\n\ndata: plain\n\n'),
      ),
    );
    expect(events).toEqual([
      { event: 'a', data: 'one\ntwo', id: '7' },
      { event: 'message', data: 'plain', id: '7' },
    ]);
  });

  it('joins events, CRLF and characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: café\r\n\r\n');
    const split = bytes.indexOf(0xc3) + 1; // Inside the two bytes of é.
    const cr = bytes.indexOf(0x0d) + 1; // Between \r and \n.
    const events = await collect(
      readEvents(chunks(bytes.slice(0, split), bytes.slice(split, cr), bytes.slice(cr))),
    );
    expect(events).toEqual([{ event: 'message', data: 'café', id: undefined }]);
  });

  it('yields an event ended by carriage returns without waiting for more', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const open = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
    controller.enqueue(new TextEncoder().encode('data: ready\r\r'));
    const events = readEvents(open);
    expect((await events.next()).value).toEqual({ event: 'message', data: 'ready', id: undefined });
    // The line feed that may follow belongs to the last line ending, not to a new, empty line.
    controller.enqueue(new TextEncoder().encode('\ndata: next\n\n'));
    expect((await events.next()).value).toEqual({ event: 'message', data: 'next', id: undefined });
    await events.return(undefined);
  });

  it('yields nothing more once aborted, even events already received', async () => {
    const controller = new AbortController();
    const events = readEvents(chunks('data: one\n\ndata: two\n\n'), controller.signal);
    expect((await events.next()).value?.data).toBe('one');
    controller.abort(new Error('Stopped.'));
    await expect(events.next()).rejects.toThrow('Stopped.');
  });

  it('drops an event the stream did not finish', async () => {
    expect(await collect(readEvents(chunks('data: done\n\ndata: cut off')))).toEqual([
      { event: 'message', data: 'done', id: undefined },
    ]);
  });
});
