import { describe, expect, it } from 'vitest';
import { createClient, withCode, type Input, type JobRequest } from '../src/api/client';
import { createLocalBackend, type Engine, type EngineMessage } from '../src/backend/local';
import { backendContract, follow, refusal } from './backend.contract';
import { stripInput } from './fixtures/api-input';

/** An engine that finds a layout of every copy at once, and keeps improving until stopped. */
function fakeEngine({ threads = 3, diagnostics = [] } = {}): Engine {
  return {
    async check(input) {
      const { parts, problem } = input as Input;
      if (!parts.length)
        return {
          code: 'invalid_job_input',
          field_errors: [{ param: '/input/parts', message: 'No parts.' }],
        };
      if (problem.type !== 'minimize_strip_length')
        return {
          code: 'feature_unavailable',
          field_errors: [{ param: '/input/problem/type', message: 'Sheets need Sparrow Pro.' }],
        };
      return null;
    },
    run(input, settings, report) {
      const placements = input.parts.flatMap((part) =>
        Array.from({ length: part.quantity }, (_, i) => ({
          part_id: part.id,
          transformation: { reflection: 'none' as const, rotation: 0, translation: [i * 50, 0] },
        })),
      );
      const solution = { layouts: [{ sheet_id: 'strip', placements }] };
      const replay = { exploration_attempts: 1, compression_attempts: 0 };
      const layout = (cut_x: number) => ({
        solution,
        replay,
        stats: {
          consumed_area: cut_x,
          placed_area: 1,
          density: 1 / cut_x,
          layouts: [{ cut_x, consumed_area: cut_x, placed_area: 1, density: 1 / cut_x }],
        },
      });
      const messages: EngineMessage[] = [
        {
          type: 'ready',
          threads,
          engine: { version: 'fake', build_id: 'fake' },
          fallbackReason: threads < 3 ? 'No shared memory.' : undefined,
        },
        { type: 'started', diagnostics },
        { type: 'search', elapsed_seconds: 0.1, solution },
        { type: 'snapshot', elapsed_seconds: 0.2, ...layout(300) },
        { type: 'snapshot', elapsed_seconds: 0.3, ...layout(200) },
      ];
      const timers = messages.map((message, i) => setTimeout(() => report(message), 5 * (i + 1)));
      // A time limit of a few seconds ends quickly; a longer one runs until stopped.
      if (settings.time_limit_seconds < 10)
        timers.push(
          setTimeout(() => report({ type: 'finished', termination: 'time_limit', replay }), 50),
        );
      return { stop: () => timers.forEach(clearTimeout) };
    },
  };
}

const local = (engine = fakeEngine()) =>
  createClient({ baseUrl: 'https://studio.local/v1', fetch: createLocalBackend(engine) });

describe('the local backend', () => {
  const client = local();
  backendContract(() => client, { timeout: 10_000 });

  const request: JobRequest = { settings: { time_limit_seconds: 2 }, input: stripInput };

  it('says which features need Sparrow Pro', async () => {
    const sheets: Input = {
      ...stripInput,
      problem: { type: 'minimize_sheets_in_order', sheets: [{ id: 's', geometry_id: 'plate' }] },
    };
    const unavailable = await refusal(local().validateJob({ ...request, input: sheets }));
    expect(unavailable.status).toBe(422);
    expect(withCode(unavailable.error, 'feature_unavailable')?.field_errors[0].param).toBe(
      '/input/problem/type',
    );
  });

  it('reads settings strictly, and fills in their defaults', async () => {
    const client = local();
    const wrong = await refusal(
      client.validateJob({ ...request, settings: { time_limit_seconds: 0, extra: true } as never }),
    );
    expect(withCode(wrong.error, 'invalid_job_input')?.field_errors.map((e) => e.param)).toEqual([
      '/settings/extra',
      '/settings/time_limit_seconds',
    ]);
    const tooLong = await refusal(
      client.validateJob({ ...request, settings: { time_limit_seconds: 601 } }),
    );
    expect(withCode(tooLong.error, 'limit_exceeded')?.limit).toEqual({
      name: 'max_time_limit_seconds',
      value: 600,
    });
    const job = await client.submitJob(request, 'key');
    expect(job.settings).toMatchObject({
      time_limit_seconds: 2,
      auto_termination: false,
      on_input_error: 'fallback',
    });
    expect(Number.isInteger(job.settings.seed)).toBe(true);
    await client.stopJob(job.id);
  });

  it('streams only the better layouts, and search layouts on request', async () => {
    const client = local();
    const job = await client.submitJob(request, 'key');
    const types: string[] = [];
    for await (const event of client.streamJobEvents(job.id)) types.push(event.type);
    expect(types).toEqual(['status', 'status', 'status', 'snapshot', 'snapshot', 'status']);
    // Afterwards, the stream sends the final status and the best layout, then ends.
    const after: string[] = [];
    for await (const event of client.streamJobEvents(job.id, { search: true }))
      after.push(event.type);
    expect(after).toEqual(['status', 'snapshot']);
    const document = await client.getJobDocument(job.id);
    expect(document.outcome?.stats.layouts[0].cut_x).toBe(200);
    expect(document.run).toEqual({ engine: { version: 'fake', build_id: 'fake' }, threads: 3 });
  });

  it('reports fewer threads as a diagnostic', async () => {
    const client = local(fakeEngine({ threads: 1 }));
    const job = await client.submitJob(request, 'key');
    await follow(client, job, AbortSignal.timeout(5000));
    const document = await client.getJobDocument(job.id);
    expect(document.outcome?.diagnostics).toEqual([
      { kind: 'threads_reduced', requested: 3, used: 1, reason: 'No shared memory.' },
    ]);
  });

  it('fails a job that needs a fallback when asked to', async () => {
    const raised = [{ kind: 'boundary_separation_raised' as const, requested: 0.2, used: 0.5 }];
    const client = local(fakeEngine({ diagnostics: raised as never }));
    const job = await client.submitJob(
      { ...request, settings: { time_limit_seconds: 2, on_input_error: 'fail' } },
      'key',
    );
    const statuses = await follow(client, job, AbortSignal.timeout(5000));
    const last = statuses.at(-1)!.state;
    expect(last.status === 'failed' && withCode(last.error, 'invalid_job_input')).toBeTruthy();
  });

  it('runs one job at a time', async () => {
    const client = local();
    const running = await client.submitJob(
      { ...request, settings: { time_limit_seconds: 30 } },
      'a',
    );
    const second = await refusal(client.submitJob(request, 'b'));
    expect(second.status).toBe(429);
    await client.stopJob(running.id);
    await expect(client.submitJob(request, 'b')).resolves.toBeDefined();
  });

  it('fails a job without any feasible layout', async () => {
    const engine = fakeEngine();
    const client = local({
      ...engine,
      run: (_input, _settings, report) => {
        const timer = setTimeout(() => {
          report({ type: 'ready', threads: 3, engine: { version: 'fake', build_id: 'fake' } });
          report({
            type: 'failed',
            code: 'no_feasible_solution',
            message: 'Part plate fits nowhere.',
          });
        }, 5);
        return { stop: () => clearTimeout(timer) };
      },
    });
    const job = await client.submitJob(request, 'key');
    const last = (await follow(client, job, AbortSignal.timeout(5000))).at(-1)!.state;
    expect(last.status === 'failed' && withCode(last.error, 'no_feasible_solution')?.message).toBe(
      'Part plate fits nowhere.',
    );
  });
});
