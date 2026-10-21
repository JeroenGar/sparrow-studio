import { describe, expect, it, vi } from 'vitest';
import { createClient, type Input } from '../src/api/client';
import { createLocalBackend, type Engine, type EngineMessage } from '../src/backend/local';
import { memoryRecords } from '../src/backend/projects';
import { polygonShape } from '../src/engine/geometry/contour';
import { newPart } from '../src/engine/model';
import { addJob, addParts, newProject } from '../src/project/model';
import { projectRequest } from '../src/project/solution';
import { createProject } from '../src/ui/projects';
import { createRunner } from '../src/ui/runs';
import { createWorkspace, type OpenEntry } from '../src/ui/workspace';
import { onStrip } from './fixtures/strip';

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

  it('records a job in every project that has it, and lets go of one no project has', async () => {
    const { workspace, runner, project } = page();
    await workspace.load();
    const first = await workspace.create(addParts(onStrip(newProject('Job')), [square()]));
    await runner.start(first);
    // The same project opened from its file holds the same running job.
    const second = await workspace.create(project(first));
    await until(() => project(first).jobs[0].stage === 'ended');
    await until(() => project(second).jobs[0].stage === 'ended');

    // With the first project deleted, the job stays followed for the second, also while it reloads.
    await runner.start(first);
    const shared = project(first).jobs[1].id!;
    const third = await workspace.create(project(first));
    await workspace.remove(first);
    expect(runner.get(shared)?.projectId).toBe(third);
    await workspace.reload(third);
    await until(() => project(third).jobs[1].stage === 'ended');

    // Deleted while the other holder reloads: the job is still held.
    await runner.start(third);
    const fourth = await workspace.create(project(third));
    const reloading = workspace.reload(fourth);
    await workspace.remove(third);
    await reloading;
    await until(() => project(fourth).jobs[2].stage === 'ended');
    const id = await workspace.create(addParts(onStrip(newProject('Again')), [square()]));

    await runner.start(id);
    const jobId = project(id).jobs[0].id!;
    expect(runner.get(jobId)).toBeDefined();
    await workspace.remove(id);
    expect(runner.get(jobId)).toBeUndefined();
  });

  it('finds a job in this browser gone after the page closed, and records it as lost', async () => {
    const records = memoryRecords();
    // Saved with its job running, as when the page closes during the run.
    const project = addParts(newProject('Job'), [square()]);
    const running = addJob(project, 'job_from_before', projectRequest(project), {});
    const { id } = await createProject(page(records).client, running);
    const next = page(records);
    await next.workspace.load();
    // Its summary says a job runs, so the project opens at once to follow it.
    await until(() => next.project(id).jobs[0].stage === 'lost');
  });
});
