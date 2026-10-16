import type { Fetch, Input, Job, JobDocument, Schemas } from '../api/client';

/**
 * The local backend: the Sparrow Pro API, answered in the browser by open-source sparrow. Studio
 * uses it when nobody is signed in, through the same client as the hosted API, so it follows the
 * API's contract: its status codes, error bodies, job states and live events.
 *
 * Jobs live as long as the page. One job runs at a time, on the browser's solver threads.
 */

type Diagnostic = Schemas['Diagnostic'];
type FieldError = Schemas['FieldError'];
type Settings = Schemas['Settings'];
type Solution = Schemas['Solution'];
type Stats = Schemas['Stats'];
type Replay = Schemas['Replay'];
type Termination = Schemas['Termination'];

/** What the engine reports while it runs a job. */
export type EngineMessage =
  | { type: 'ready'; threads: number; engine: Schemas['Engine']; fallbackReason?: string }
  | { type: 'started'; diagnostics: Diagnostic[] }
  | { type: 'snapshot'; elapsed_seconds: number; solution: Solution; stats: Stats; replay: Replay }
  | { type: 'search'; elapsed_seconds: number; solution: Solution }
  | { type: 'finished'; termination: Termination; replay: Replay }
  | {
      type: 'failed';
      code: 'invalid_job_input' | 'no_feasible_solution' | 'internal_error';
      message: string;
    };

/** Open-source sparrow behind the local backend. */
export type Engine = {
  /** `null` when the engine can run the input, otherwise why not. */
  check(input: unknown): Promise<{ code: string; field_errors: FieldError[] } | null>;
  /** Runs a checked input; `stop` ends it at once. */
  run(input: Input, settings: Settings, report: (message: EngineMessage) => void): { stop(): void };
};

/** The threads the local backend asks for. */
export const THREADS = 3;

const LIMITS: Schemas['Limits'] = {
  max_request_bytes: 32 * 1024 * 1024,
  max_time_limit_seconds: 600,
  max_part_copies: 500,
  max_running_jobs: 1,
  max_queued_jobs: 0,
  max_projects: 1000,
  max_project_bytes: 100 * 1024 * 1024,
};

type ApiErrorBody = Schemas['ErrorBody']['error'];
// Each error variant without the fields `refuse` fills in.
type ErrorFields = ApiErrorBody extends infer E
  ? E extends unknown
    ? Omit<E, 'doc_url' | 'param'> & { param?: string | null }
    : never
  : never;

class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly error: ErrorFields,
  ) {
    super(error.message);
  }
}

const notFound = (what: string) =>
  new Refusal(404, { code: 'not_found', message: `There is no ${what} here.` });

function respond(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
  });
}

function refuse(refusal: Refusal) {
  const { param, ...error } = refusal.error;
  const fieldParam =
    'field_errors' in error ? (error.field_errors as FieldError[])[0]?.param : undefined;
  return respond(refusal.status, {
    error: { ...error, param: param ?? fieldParam ?? null, doc_url: null },
  });
}

/** Reads a job request strictly, as the API does, and fills in the settings' defaults. */
function readRequest(body: unknown): { input: unknown; settings: Settings } {
  const errors: FieldError[] = [];
  const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!object(body) || !('input' in body) || !object(body.settings))
    throw new Refusal(400, {
      code: 'malformed_request',
      message: 'Send a JSON object with `settings` and `input`.',
    });
  for (const key of Object.keys(body))
    if (key !== 'input' && key !== 'settings')
      errors.push({ param: `/${key}`, message: 'This field is unknown.' });
  const settings = body.settings;
  for (const key of Object.keys(settings))
    if (!['time_limit_seconds', 'auto_termination', 'seed', 'on_input_error'].includes(key))
      errors.push({ param: `/settings/${key}`, message: 'This field is unknown.' });
  const { time_limit_seconds, auto_termination = false, on_input_error = 'fallback' } = settings;
  const seed = settings.seed ?? Math.floor(Math.random() * 2 ** 53);
  if (!Number.isInteger(time_limit_seconds) || (time_limit_seconds as number) < 1)
    errors.push({
      param: '/settings/time_limit_seconds',
      message: 'Give a whole number of seconds, at least 1.',
    });
  if (typeof auto_termination !== 'boolean')
    errors.push({ param: '/settings/auto_termination', message: 'Give true or false.' });
  if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 2 ** 53 - 1)
    errors.push({ param: '/settings/seed', message: 'Give a whole number from 0 to 2⁵³ − 1.' });
  if (on_input_error !== 'fallback' && on_input_error !== 'fail')
    errors.push({ param: '/settings/on_input_error', message: 'Give `fallback` or `fail`.' });
  if (errors.length)
    throw new Refusal(400, {
      code: 'invalid_job_input',
      message: errors[0].message,
      field_errors: errors,
    });
  if ((time_limit_seconds as number) > LIMITS.max_time_limit_seconds)
    throw limitExceeded('max_time_limit_seconds', LIMITS.max_time_limit_seconds);
  return {
    input: body.input,
    settings: {
      time_limit_seconds: time_limit_seconds as number,
      auto_termination: auto_termination as boolean,
      seed: seed as number,
      on_input_error: on_input_error as Settings['on_input_error'],
    },
  };
}

function limitExceeded(name: Schemas['LimitName'], value: number) {
  return new Refusal(422, {
    code: 'limit_exceeded',
    message: `The request exceeds ${name}, ${value}.`,
    limit: { name, value },
  });
}

/** A job of the local backend, and who follows it live. */
type LocalJob = {
  job: Job;
  document: JobDocument;
  /** Ends the engine's work at once. */
  dispose?: () => void;
  /** Ends a running job with the best layout so far. */
  stop?: () => void;
  best?: {
    sequence: number;
    elapsed_seconds: number;
    solution: Solution;
    stats: Stats;
    replay: Replay;
  };
  replay: Replay;
  followers: Set<Follower>;
};
type Follower = {
  search: boolean;
  send: (event: string, data: unknown, id?: number) => void;
  end: () => void;
};

const FINAL = ['completed', 'cancelled', 'failed'];

export function createLocalBackend(engine: Engine): Fetch {
  const jobs = new Map<string, LocalJob>();
  const submissions = new Map<string, { body: string; jobId: string }>();
  let searchSequence = 0;

  const now = () => new Date().toISOString();
  const id = (prefix: string) =>
    `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('')}`;

  async function check(request: { input: unknown; settings: Settings }) {
    const refusal = await engine.check(request.input);
    if (refusal)
      throw new Refusal(refusal.code === 'feature_unavailable' ? 422 : 400, {
        code: refusal.code as 'invalid_job_input',
        message: refusal.field_errors[0]?.message ?? 'The input cannot be used.',
        field_errors: refusal.field_errors,
      });
    const input = request.input as Input;
    const copies = input.parts.reduce((sum, part) => sum + part.quantity, 0);
    if (copies > LIMITS.max_part_copies)
      throw limitExceeded('max_part_copies', LIMITS.max_part_copies);
    return input;
  }

  function publish(
    local: LocalJob,
    event: 'status' | 'snapshot' | 'search',
    data: unknown,
    sequence?: number,
  ) {
    for (const follower of local.followers)
      if (event !== 'search' || follower.search) follower.send(event, data, sequence);
  }

  /** Moves a job to `state`; a final state ends its followers' streams. */
  function enter(local: LocalJob, state: Job['state'], outcome?: Schemas['Outcome']) {
    local.job = { ...local.job, state };
    local.document = { ...local.document, state, ...(outcome && { outcome }) };
    if (FINAL.includes(state.status)) {
      local.stop = undefined;
      local.dispose = undefined;
      local.job = { ...local.job, finished_at: now() };
    }
    publish(local, 'status', local.job);
    if (FINAL.includes(state.status)) for (const follower of local.followers) follower.end();
  }

  function solverSeconds(local: LocalJob, elapsed: number) {
    return Math.min(Math.ceil(elapsed), local.job.settings.time_limit_seconds);
  }

  function complete(local: LocalJob, termination: Termination, elapsed: number) {
    const best = local.best;
    if (!best)
      return enter(local, {
        status: 'failed',
        solver_seconds: solverSeconds(local, elapsed),
        error: {
          code: 'no_feasible_solution',
          termination,
          message: 'The search ended before it found a feasible solution.',
          param: null,
          doc_url: null,
        },
      });
    enter(
      local,
      {
        status: 'completed',
        termination,
        fulfillment: 'complete',
        solver_seconds: solverSeconds(local, elapsed),
      },
      {
        solution: best.solution,
        stats: best.stats,
        unplaced: [],
        diagnostics: local.job.diagnostics ?? [],
        replay: local.replay,
      },
    );
  }

  function start(local: LocalJob, input: Input) {
    const startedAt = performance.now();
    const elapsed = () => (performance.now() - startedAt) / 1000;
    let sequence = 0;
    // Assigned before any message arrives: the engine reports from its workers.
    let running: { stop(): void } | undefined;
    running = engine.run(input, local.job.settings, (message) => {
      if (FINAL.includes(local.job.state.status)) return;
      switch (message.type) {
        case 'ready': {
          const diagnostics: Diagnostic[] =
            message.threads < THREADS
              ? [
                  {
                    kind: 'threads_reduced',
                    requested: THREADS,
                    used: message.threads,
                    reason: message.fallbackReason ?? '',
                  } as Diagnostic,
                ]
              : [];
          local.job = { ...local.job, started_at: now(), diagnostics };
          local.document = {
            ...local.document,
            run: { engine: message.engine, threads: message.threads },
          };
          return enter(local, { status: 'running' });
        }
        case 'started': {
          local.job = {
            ...local.job,
            diagnostics: [...(local.job.diagnostics ?? []), ...message.diagnostics],
          };
          if (message.diagnostics.length && local.job.settings.on_input_error === 'fail') {
            running?.stop();
            return enter(local, {
              status: 'failed',
              solver_seconds: solverSeconds(local, elapsed()),
              error: {
                code: 'invalid_job_input',
                message: 'The input needs a fallback, and the job asked to fail instead.',
                param: null,
                doc_url: null,
                field_errors: [
                  {
                    param: '/input/minimum_separation_distance/boundary',
                    message: 'The boundary separation would be raised.',
                  },
                ],
              },
            });
          }
          return publish(local, 'status', local.job);
        }
        case 'snapshot': {
          local.replay = message.replay;
          const cut = (stats: Stats) => stats.layouts[0]?.cut_x ?? Infinity;
          if (local.best && cut(message.stats) >= cut(local.best.stats)) return;
          local.best = { ...message, sequence: ++sequence };
          const { stats: _, replay: __, ...snapshot } = local.best;
          return publish(local, 'snapshot', snapshot, local.best.sequence);
        }
        case 'search': {
          const { type: _, ...search } = message;
          return publish(local, 'search', { ...search, sequence: ++searchSequence });
        }
        case 'finished':
          local.replay = message.replay;
          return complete(local, message.termination, elapsed());
        case 'failed':
          return enter(local, {
            status: 'failed',
            solver_seconds: solverSeconds(local, elapsed()),
            error:
              message.code === 'no_feasible_solution'
                ? {
                    code: 'no_feasible_solution',
                    termination: 'auto_terminated',
                    message: message.message,
                    param: null,
                    doc_url: null,
                  }
                : message.code === 'invalid_job_input'
                  ? {
                      code: 'invalid_job_input',
                      field_errors: [{ param: '/input', message: message.message }],
                      message: message.message,
                      param: '/input',
                      doc_url: null,
                    }
                  : {
                      code: 'internal_error',
                      message: message.message,
                      param: null,
                      doc_url: null,
                    },
          });
      }
    });
    local.dispose = () => running?.stop();
    local.stop = () => {
      running?.stop();
      complete(local, 'stopped', elapsed());
    };
  }

  function stream(local: LocalJob, search: boolean, signal: AbortSignal) {
    const encoder = new TextEncoder();
    let follower: Follower | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => {
          if (!follower) return;
          local.followers.delete(follower);
          follower = undefined;
          controller.close();
        };
        follower = {
          search,
          send: (event, data, sequence) =>
            controller.enqueue(
              encoder.encode(
                `event: ${event}\n${sequence === undefined ? '' : `id: ${sequence}\n`}data: ${JSON.stringify(data)}\n\n`,
              ),
            ),
          end: close,
        };
        local.followers.add(follower);
        follower.send('status', local.job);
        if (local.best) {
          const { stats: _, replay: __, ...snapshot } = local.best;
          follower.send('snapshot', snapshot, local.best.sequence);
        }
        if (FINAL.includes(local.job.state.status)) close();
        signal.addEventListener('abort', close, { once: true });
      },
      cancel() {
        if (follower) local.followers.delete(follower);
        follower = undefined;
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*?\/v1(?=\/)/, '');
    const parts = path.split('/').filter(Boolean);
    const json = async () => {
      try {
        return await request.json();
      } catch {
        throw new Refusal(400, {
          code: 'malformed_request',
          message: 'The body is not valid JSON.',
        });
      }
    };
    const job = (jobId: string) => {
      const local = jobs.get(jobId);
      if (!local) throw notFound(`job ${jobId}`);
      return local;
    };

    if (request.method === 'GET' && path === '/limits') return respond(200, LIMITS);
    if (request.method === 'POST' && path === '/jobs/validate') {
      await check(readRequest(await json()));
      return respond(204);
    }
    if (request.method === 'POST' && path === '/jobs') {
      const text = await request.text();
      const key = request.headers.get('Idempotency-Key');
      const earlier = key ? submissions.get(key) : undefined;
      if (earlier) {
        if (earlier.body !== text)
          throw new Refusal(409, {
            code: 'idempotency_conflict',
            message: 'This key was used for a different submission.',
          });
        return respond(200, job(earlier.jobId).job);
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Refusal(400, {
          code: 'malformed_request',
          message: 'The body is not valid JSON.',
        });
      }
      const request_ = readRequest(body);
      const input = await check(request_);
      if ([...jobs.values()].some((other) => !FINAL.includes(other.job.state.status)))
        throw new Refusal(429, {
          code: 'rate_limited',
          message: 'One job runs at a time in the browser; stop it first.',
        });
      const jobId = id('job');
      const local: LocalJob = {
        job: {
          id: jobId,
          state: { status: 'queued' },
          created_at: now(),
          started_at: null,
          finished_at: null,
          document_expires_at: null,
          settings: request_.settings,
          diagnostics: [],
          credits: { held: 0, charged: 0 },
        },
        document: {
          schema_version: 1,
          input,
          settings: request_.settings,
          state: { status: 'queued' },
        },
        replay: { exploration_attempts: 0, compression_attempts: 0 },
        followers: new Set(),
      };
      jobs.set(jobId, local);
      if (key) submissions.set(key, { body: text, jobId });
      start(local, input);
      return respond(201, local.job);
    }
    if (parts[0] === 'jobs' && parts.length >= 2) {
      const local = job(parts[1]);
      if (request.method === 'GET' && parts.length === 2) return respond(200, local.job);
      if (request.method === 'GET' && parts[2] === 'full') return respond(200, local.document);
      if (request.method === 'GET' && parts[2] === 'events')
        return stream(local, url.searchParams.get('search') === 'true', request.signal);
      if (request.method === 'POST' && parts[2] === 'stop') {
        if (local.job.state.status === 'queued') {
          local.dispose?.();
          enter(local, { status: 'cancelled' });
        } else local.stop?.();
        return respond(202, local.job);
      }
    }
    throw notFound(`route ${request.method} ${path}`);
  }

  return async (request) => {
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof Refusal) return refuse(error);
      return refuse(new Refusal(500, { code: 'internal_error', message: String(error) }));
    }
  };
}
