import createFetchClient from 'openapi-fetch';
import type { components, paths } from './schema';
import { readEvents } from './sse';

/** The API's types, generated from `vendor/openapi.json`. */
export type Schemas = components['schemas'];
export type Input = Schemas['Input'];
export type Job = Schemas['Job'];
export type JobDocument = Schemas['JobDocument'];
export type JobRequest = Schemas['JobRequest'];
export type Project = Schemas['Project'];
/**
 * What a project is saved as: its name, the client's summary for its lists, and the document's
 * bytes, in whatever format the client chose. A save without a summary clears it.
 */
export type ProjectParts = { name: string; summary?: unknown; document: Blob };

/** What the client sends requests with: the browser's `fetch`, or a backend that answers in the browser. */
export type Fetch = (request: Request) => Promise<Response>;

/** A project with its version: the `ETag` it was read or written with, which a save or delete must name. */
export type Versioned = { project: Project; version: string };

/** A project's parts as a multipart body; the browser sets its type, with the boundary. */
function multipart({ name, summary, document }: ProjectParts): FormData {
  const form = new FormData();
  form.append('name', name);
  if (summary !== undefined)
    form.append('summary', new Blob([JSON.stringify(summary)], { type: 'application/json' }));
  form.append('document', document);
  return form;
}

/**
 * One event of a job's live stream. The specification types the stream as text and names its
 * events in prose, so this pairs each event name with its generated type.
 */
export type JobEvent =
  | { type: 'status'; data: Job }
  | { type: 'snapshot'; data: Schemas['Snapshot'] }
  | { type: 'search'; data: Schemas['Search'] };
const EVENT_TYPES: readonly string[] = [
  'status',
  'snapshot',
  'search',
] satisfies JobEvent['type'][];

/** A response other than success. Keeps the status and headers whatever the body is. */
export class ApiError extends Error {
  readonly status: number;
  readonly headers: Headers;
  /** The parsed body: the API's error body, or text such as a proxy's error page, or nothing. */
  readonly body: unknown;

  constructor(response: Response, body: unknown) {
    const error = errorOf(body);
    super(error?.message ?? `The API answered ${response.status} ${response.statusText}`.trim());
    this.name = 'ApiError';
    this.status = response.status;
    this.headers = response.headers;
    this.body = body;
  }

  /** The API's error, when the body is one. */
  get error(): Schemas['ApiError'] | undefined {
    return errorOf(this.body);
  }
}

function errorOf(body: unknown): Schemas['ApiError'] | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const { error } = body;
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
    ? (error as Schemas['ApiError'])
    : undefined;
}

// The error unions end in `{ code: string }`, so unknown codes are kept; comparing `code` then
// narrows nothing, and neither does a type predicate. `withCode` returns the narrowed error instead.
type KnownCodes<E> = E extends { code: infer C } ? (string extends C ? never : C) : never;

/** An API error or a failed job's error, as its variant for `code`; undefined for any other code. */
export function withCode<E extends { code: string }, const C extends KnownCodes<E>>(
  error: E | undefined,
  code: C,
): Extract<E, { code: C }> | undefined {
  return error?.code === code ? (error as Extract<E, { code: C }>) : undefined;
}

type KnownKinds<D> = D extends { kind: infer K } ? (string extends K ? never : K) : never;

/** A diagnostic as its variant for `kind`, as `withCode` does for errors; undefined for any other. */
export function withKind<D extends { kind: string }, const K extends KnownKinds<D>>(
  diagnostic: D | undefined,
  kind: K,
): Extract<D, { kind: K }> | undefined {
  return diagnostic?.kind === kind ? (diagnostic as Extract<D, { kind: K }>) : undefined;
}

type Result<D> = { data?: D; error?: unknown; response: Response };

async function ok<D>(request: Promise<Result<D>>): Promise<D> {
  const { data, error, response } = await request;
  if (!response.ok) throw new ApiError(response, error);
  return data as D;
}

/** The version a response names in its `ETag`. */
function versionOf(response: Response, what: string): string {
  const version = response.headers.get('ETag');
  if (!version) throw new Error(`The API returned ${what} without its version.`);
  return version;
}

async function versioned(request: Promise<Result<Project>>): Promise<Versioned> {
  const { response } = await request;
  const project = await ok(request);
  return { project, version: versionOf(response, `project ${project.id}`) };
}

/**
 * The client for the parts of the API studio uses. `baseUrl` includes the version, such as
 * `https://api.sparrownesting.com/v1`. Authentication belongs to `fetch`.
 */
export function createClient({ fetch, baseUrl }: { fetch: Fetch; baseUrl: string }) {
  const api = createFetchClient<paths>({ baseUrl, fetch });
  const job = (jobId: string) => ({ params: { path: { job_id: jobId } } });
  const project = (projectId: string) => ({ project_id: projectId });

  return {
    /** Checks a submission without creating a job. */
    validateJob: (body: JobRequest) => ok(api.POST('/jobs/validate', { body })),
    /** Submits a job. Retrying the same submission must reuse its key, so it never runs twice. */
    submitJob: (body: JobRequest, idempotencyKey: string) =>
      ok(api.POST('/jobs', { body, params: { header: { 'Idempotency-Key': idempotencyKey } } })),
    getJob: (jobId: string) => ok(api.GET('/jobs/{job_id}', job(jobId))),
    getJobDocument: (jobId: string) => ok(api.GET('/jobs/{job_id}/full', job(jobId))),
    stopJob: (jobId: string) => ok(api.POST('/jobs/{job_id}/stop', job(jobId))),

    /**
     * Follows a job live. The stream may end before the job does, such as when the connection
     * drops: whether the job ended is up to the last `status` event, or a fresh `getJob`.
     */
    async *streamJobEvents(
      jobId: string,
      { search = false, signal }: { search?: boolean; signal?: AbortSignal } = {},
    ): AsyncGenerator<JobEvent> {
      const stream = await ok(
        api.GET('/jobs/{job_id}/events', {
          params: { path: { job_id: jobId }, query: { search } },
          parseAs: 'stream',
          signal,
        }),
      );
      if (!stream) throw new Error(`The live stream of job ${jobId} has no body.`);
      for await (const { event, data } of readEvents(stream, signal))
        if (EVENT_TYPES.includes(event)) yield { type: event, data: JSON.parse(data) } as JobEvent;
    },

    /** The account's projects, with their summaries but without their documents. */
    listProjects: (cursor?: string) => ok(api.GET('/projects', { params: { query: { cursor } } })),
    /** Creates a project. Retrying the same creation must reuse its key and its bytes, so it never creates two. */
    createProject: (parts: ProjectParts, idempotencyKey: string) =>
      versioned(
        api.POST('/projects', {
          body: parts as never,
          bodySerializer: () => multipart(parts),
          params: { header: { 'Idempotency-Key': idempotencyKey } },
        }),
      ),
    /** A project, without its document. */
    getProject: (projectId: string) =>
      versioned(api.GET('/projects/{project_id}', { params: { path: project(projectId) } })),
    /**
     * A project's document, its bytes exactly as saved, with the version they belong to. With a
     * version, only at that version: a project changed since fails with `version_conflict`.
     */
    async getProjectDocument(
      projectId: string,
      version?: string,
    ): Promise<{ document: Blob; version: string }> {
      const request = api.GET('/projects/{project_id}/document', {
        params: { path: project(projectId), header: version ? { 'If-Match': version } : {} },
        parseAs: 'blob',
      });
      const { response } = await request;
      const document = await ok(request);
      return { document, version: versionOf(response, `the document of project ${projectId}`) };
    },
    /** Saves a project over `version`; a project changed since fails with `version_conflict`. */
    saveProject: (projectId: string, parts: ProjectParts, version: string) =>
      versioned(
        api.PUT('/projects/{project_id}', {
          body: parts as never,
          bodySerializer: () => multipart(parts),
          params: { path: project(projectId), header: { 'If-Match': version } },
        }),
      ),
    deleteProject: (projectId: string, version: string) =>
      ok(
        api.DELETE('/projects/{project_id}', {
          params: { path: project(projectId), header: { 'If-Match': version } },
        }),
      ),

    getLimits: () => ok(api.GET('/limits')),
  };
}

export type Client = ReturnType<typeof createClient>;
