import { describe, expect, it, vi } from 'vitest';
import { createClient, type Input } from '../src/api/client';
import { createLocalBackend, type Engine, type EngineMessage } from '../src/backend/local';
import { memoryRecords } from '../src/backend/projects';
import { polygonShape } from '../src/engine/geometry/contour';
import { newPart } from '../src/engine/model';
import { addParts, newProject } from '../src/project/model';
import { projectRequest } from '../src/project/solution';
import { createRunner } from '../src/ui/runs';
import { createWorkspace, type OpenEntry } from '../src/ui/workspace';

vi.mock('../src/ui/client', () => ({ usesSparrowPro: false }));

/** An engine that places every copy in a row at once, and finishes a moment later. */
const quick: Engine = {
  check: async () => null,
  run(input: Input, _settings, report) {
    const placements = input.parts.flatMap((part) =>
      Array.from({ length: part.quantity }, (_, i) => ({
        part_id: part.id,
        transformation: { reflection: 'none' as const, rotation: 0, translation: [i * 20, 0] },
      })),
    );
    const replay = { exploration_attempts: 1, compression_attempts: 0 };
    const stats = {
      consumed_area: 400,
      placed_area: 200,
      density: 0.5,
      layouts: [{ cut_x: 40, consumed_area: 400, placed_area: 200, density: 0.5 }],
    };
    const messages: EngineMessage[] = [
      { type: 'ready', threads: 3, engine: { version: 'quick', build_id: 'quick' } },
      { type: 'started', diagnostics: [] },
      {
        type: 'snapshot',
        elapsed_seconds: 0.1,
        solution: { layouts: [{ sheet_id: 'strip', placements }] },
        stats,
        replay,
      },
      { type: 'finished', termination: 'time_limit', replay },
    ];
    const timers = messages.map((message, i) => setTimeout(() => report(message), 5 * (i + 1)));
    return { stop: () => timers.forEach(clearTimeout) };
  },
};

const square = () =>
  newPart(
    polygonShape([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]),
  );

/** A workspace and runner on the local backend, over records that outlive a page. */
function page(records = memoryRecords()) {
  const client = createClient({
    baseUrl: 'https://studio.local/v1',
    fetch: createLocalBackend(quick, records),
  });
  const workspace = createWorkspace(client, { saveDelay: 0 });
  const runner = createRunner(client, workspace);
  const project = (id: string) => (workspace.find(id) as OpenEntry).history.present;
  return { records, client, workspace, runner, project };
}

const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(done()).toBe(true);
};

describe('the runner', () => {
  it('records a job as the project’s next, follows it, and records how it ended', async () => {
    const { workspace, runner, project } = page();
    await workspace.load();
    const id = await workspace.create(addParts(newProject('Job'), [square()]));
    expect(await runner.start(id)).toBe(1);
    expect(project(id).jobs).toMatchObject([{ number: 1, stage: 'running' }]);
    const jobId = project(id).jobs[0].id!;
    expect(runner.get(jobId)?.projectId).toBe(id);
    await until(() => project(id).jobs[0].stage === 'ended');
    expect(project(id).jobs[0]).toMatchObject({
      stage: 'ended',
      document: { state: { status: 'completed' }, outcome: { stats: { density: 0.5 } } },
    });
    expect(runner.get(jobId)).toBeUndefined();
    expect(await runner.start(id)).toBe(2);
  });

  it('finds a job in this browser gone after the page closed, and records it as lost', async () => {
    const first = page();
    await first.workspace.load();
    const id = await first.workspace.create(addParts(newProject('Job'), [square()]));
    // Saved with its job running, as when the page closes during the run.
    first.workspace.results(id, (present) => ({
      jobs: [
        {
          number: 1,
          submittedAt: 'then',
          names: {},
          stage: 'running',
          id: 'job_from_before',
          request: projectRequest(present),
        },
      ],
      seenTabs: present.seenTabs,
    }));
    await first.workspace.flushAll();
    const next = page(first.records);
    await next.workspace.load();
    await until(() => next.project(id).jobs[0].stage === 'lost');
  });
});
