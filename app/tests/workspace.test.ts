import { describe, expect, it, vi } from 'vitest';
import { createClient, type Fetch } from '../src/api/client';
import { createLocalBackend, type Engine } from '../src/backend/local';
import { memoryRecords } from '../src/backend/projects';
import { addJob, newProject } from '../src/project/model';
import { projectRequest } from '../src/project/solution';
import { createWorkspace, type OpenEntry } from '../src/ui/workspace';

vi.mock('../src/ui/client', () => ({ usesSparrowPro: false }));

/** An engine that is never asked to run: these tests only store projects. */
const idle: Engine = { check: async () => null, run: () => ({ stop() {} }) };

function setup(wrap: (fetch: Fetch) => Fetch = (fetch) => fetch) {
  const records = memoryRecords();
  const client = () =>
    createClient({
      baseUrl: 'https://studio.local/v1',
      fetch: wrap(createLocalBackend(idle, records)),
    });
  const api = client();
  const workspace = createWorkspace(client(), { saveDelay: 0 });
  const open = (id: string) => workspace.find(id) as OpenEntry;
  return { api, workspace, open };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('the workspace', () => {
  it('opens every project, and one that does not read stands alone', async () => {
    const { api, workspace, open } = setup();
    const good = await api.createProject({ name: 'Good', document: newProject('Good') }, 'a');
    const bad = await api.createProject({ name: 'Bad', document: { format: 'other' } }, 'b');
    await workspace.load();
    expect(open(good.project.id)).toMatchObject({ status: 'open' });
    expect(workspace.find(bad.project.id)).toMatchObject({
      status: 'failed',
      name: 'Bad',
      error: expect.stringContaining('unknown format'),
    });
  });

  it('asks a busy API again after the time it names', async () => {
    let refused = 0;
    const { api, workspace, open } = setup((fetch) => async (request) => {
      if (request.method === 'GET' && request.url.includes('/projects/') && refused++ < 2)
        return Response.json(
          { error: { code: 'unavailable', message: 'Busy.' } },
          { status: 503, headers: { 'Retry-After': '0' } },
        );
      return fetch(request);
    });
    const { project } = await api.createProject({ name: 'Job', document: newProject('Job') }, 'a');
    await workspace.load();
    expect(open(project.id).status).toBe('open');
    expect(refused).toBe(3);
  });

  it('saves edits, keeps results out of undo, and stops at a change made elsewhere', async () => {
    const { api, workspace, open } = setup();
    const { project } = await api.createProject({ name: 'Job', document: newProject('Job') }, 'a');
    await workspace.load();
    const id = project.id;
    workspace.edit(id, (current) => ({ ...current, name: 'Renamed' }));
    expect(open(id).save.state).toBe('saving');
    await settled();
    expect(open(id).save.state).toBe('saved');
    expect((await api.getProject(id)).project.name).toBe('Renamed');

    // A job is no edit: undo keeps it, and it is saved too.
    const request = projectRequest(open(id).history.present);
    workspace.results(id, (present) => ({ jobs: addJob(present, 'job_1', request, {}).jobs }));
    workspace.undo(id);
    expect(open(id).history.present).toMatchObject({ name: 'Job', jobs: [{ id: 'job_1' }] });
    await settled();
    expect((await api.getProject(id)).project.document).toMatchObject({ jobs: [{ id: 'job_1' }] });

    // Another tab saves; this one's next save finds the project changed, and keeps it as it is.
    const { version } = await api.getProject(id);
    await api.saveProject(id, { name: 'Elsewhere', document: newProject('Elsewhere') }, version);
    workspace.edit(id, (current) => ({ ...current, name: 'Here' }));
    await settled();
    expect(open(id).save.state).toBe('conflict');
    expect((await api.getProject(id)).project.name).toBe('Elsewhere');
    await workspace.reload(id);
    expect(open(id).history.present.name).toBe('Elsewhere');
  });

  it('creates and deletes projects, after any save on its way', async () => {
    const { api, workspace, open } = setup();
    await workspace.load();
    const id = await workspace.create(newProject('New'));
    expect(open(id).status).toBe('open');
    workspace.edit(id, (current) => ({ ...current, name: 'Changed' }));
    await workspace.remove(id);
    expect(workspace.find(id)).toBeUndefined();
    await expect(api.getProject(id)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps a project changed elsewhere when deleting it, and lets go of one already gone', async () => {
    const { api, workspace, open } = setup();
    const kept = await api.createProject({ name: 'Kept', document: newProject('Kept') }, 'a');
    const gone = await api.createProject({ name: 'Gone', document: { format: 'other' } }, 'b');
    await workspace.load();
    await api.saveProject(
      kept.project.id,
      { name: 'Elsewhere', document: newProject('Elsewhere') },
      kept.version,
    );
    await expect(workspace.remove(kept.project.id)).rejects.toThrow('changed since');
    expect(open(kept.project.id).save.state).toBe('conflict');
    // Deleted in another tab after the list: its card goes without a fuss.
    await api.deleteProject(gone.project.id, gone.version);
    await workspace.remove(gone.project.id);
    expect(workspace.find(gone.project.id)).toBeUndefined();
  });
});
