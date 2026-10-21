import { describe, expect, it, vi } from 'vitest';
import { createClient, type Fetch } from '../src/api/client';
import { createLocalBackend, type Engine } from '../src/backend/local';
import { memoryRecords } from '../src/backend/projects';
import { addJob, newProject, type ProjectDocument } from '../src/project/model';
import { projectRequest } from '../src/project/solution';
import { readSummary } from '../src/project/summary';
import { createProject, openProject } from '../src/ui/projects';
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
  /** Saves a project as studio does, with its summary. */
  const save = async (document: ProjectDocument) => (await createProject(api, document)).id;
  /** Saves a document as plain JSON without a summary, as this browser kept projects before. */
  const saveBare = async (name: string, document: unknown) =>
    (await api.createProject({ name, document: new Blob([JSON.stringify(document)]) }, name))
      .project.id;
  const stored = async (id: string) => (await openProject(api, id)).document;
  const listed = async (id: string) =>
    readSummary((await api.listProjects()).data.find((project) => project.id === id)?.summary);
  return { api, workspace, open, save, saveBare, stored, listed };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('the workspace', () => {
  it('lists projects with summaries, and opens those that need their document', async () => {
    const { workspace, open, save, saveBare } = setup();
    const listedOnly = await save(newProject('Listed'));
    const running = await save(
      addJob(newProject('Running'), 'job_1', projectRequest(newProject('Running')), {}),
    );
    const older = await saveBare('Older', newProject('Older'));
    const bad = await saveBare('Bad', { format: 'other' });
    await workspace.load();
    expect(workspace.find(listedOnly)).toMatchObject({
      status: 'listed',
      name: 'Listed',
      summary: { jobs: 0 },
    });
    // Its job is followed from its document, and a project without a summary shows from its own.
    expect(open(running).status).toBe('open');
    expect(open(older).status).toBe('open');
    expect(workspace.find(bad)).toMatchObject({
      status: 'failed',
      name: 'Bad',
      error: expect.stringContaining('unknown format'),
    });
    workspace.open(listedOnly);
    await settled();
    expect(open(listedOnly)).toMatchObject({
      status: 'open',
      history: { present: { name: 'Listed' } },
    });
  });

  it('asks a busy API again after the time it names', async () => {
    let refused = 0;
    const { workspace, open, saveBare } = setup((fetch) => async (request) => {
      if (request.url.endsWith('/document') && refused++ < 2)
        return Response.json(
          { error: { code: 'unavailable', message: 'Busy.' } },
          { status: 503, headers: { 'Retry-After': '0' } },
        );
      return fetch(request);
    });
    const id = await saveBare('Job', newProject('Job'));
    await workspace.load();
    expect(open(id).status).toBe('open');
    expect(refused).toBe(3);
  });

  it('saves edits, keeps results out of undo, and stops at a change made elsewhere', async () => {
    const { api, workspace, open, save, stored, listed } = setup();
    const id = await save(newProject('Job'));
    await workspace.load();
    workspace.open(id);
    await settled();
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
    expect(await stored(id)).toMatchObject({ jobs: [{ id: 'job_1' }] });
    // Each save writes the summary Home shows.
    expect(await listed(id)).toMatchObject({ jobs: 1, running: ['job_1'] });

    // Another tab saves; this one's next save finds the project changed, and keeps it as it is.
    const { version } = await api.getProject(id);
    const elsewhere = new Blob([JSON.stringify(newProject('Elsewhere'))]);
    await api.saveProject(id, { name: 'Elsewhere', document: elsewhere }, version);
    workspace.edit(id, (current) => ({ ...current, name: 'Here' }));
    await settled();
    expect(open(id).save.state).toBe('conflict');
    expect((await api.getProject(id)).project.name).toBe('Elsewhere');
    const before = open(id).updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await api.saveProject(
      id,
      { name: 'Later', document: elsewhere },
      (await api.getProject(id)).version,
    );
    await workspace.reload(id);
    // Reloaded as it is now, with when it last changed.
    expect(open(id).history.present.name).toBe('Elsewhere');
    expect(open(id).updatedAt > before).toBe(true);
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
    const { api, workspace, open, saveBare } = setup();
    const kept = await saveBare('Kept', newProject('Kept'));
    const gone = await saveBare('Gone', { format: 'other' });
    await workspace.load();
    const elsewhere = new Blob([JSON.stringify(newProject('Elsewhere'))]);
    await api.saveProject(kept, { name: 'Elsewhere', document: elsewhere }, '"1"');
    await expect(workspace.remove(kept)).rejects.toThrow('changed since');
    expect(open(kept).save.state).toBe('conflict');
    // One that does not open is deleted at the version it was shown at, and only then.
    await expect(workspace.remove(gone)).rejects.toThrow('Open the project');
    // Deleted in another tab after the list: its card goes without a fuss.
    await api.deleteProject(gone, '"1"');
    await workspace.remove(gone, '"1"');
    expect(workspace.find(gone)).toBeUndefined();
  });

  it('deletes a listed project only once opened', async () => {
    const { workspace, save } = setup();
    const id = await save(newProject('Listed'));
    await workspace.load();
    await expect(workspace.remove(id)).rejects.toThrow('Open the project');
    workspace.open(id);
    await settled();
    await workspace.remove(id);
    expect(workspace.find(id)).toBeUndefined();
  });
});
