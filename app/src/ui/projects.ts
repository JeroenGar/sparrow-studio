import { ApiError, withCode, type Client, type Schemas } from '../api/client';
import { InvalidProject, parseProject } from '../project/file';
import type { ProjectDocument } from '../project/model';

/** A project as studio holds it: its document, the version a save must start from, and when it last changed. */
export type StoredProject = {
  id: string;
  version: string;
  updatedAt: string;
  document: ProjectDocument;
};
export type ProjectSummary = Schemas['ProjectSummary'];

/** Every project, most recently changed first. */
export async function listProjects(
  client: Client,
  /** Makes each request: the client's own, or with retries. */
  request: <T>(call: () => Promise<T>) => Promise<T> = (call) => call(),
): Promise<ProjectSummary[]> {
  const all: ProjectSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await request(() => client.listProjects(cursor));
    all.push(...page.data);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return all;
}

export async function openProject(client: Client, id: string): Promise<StoredProject> {
  const { project, version } = await client.getProject(id);
  return { id, version, updatedAt: project.updated_at, document: parseProject(project.document) };
}

/** The API stores a project's name beside its document; studio names it from the document. */
const request = (document: ProjectDocument) => ({ name: document.name, document });

export async function createProject(
  client: Client,
  document: ProjectDocument,
): Promise<StoredProject> {
  const { project, version } = await client.createProject(request(document), crypto.randomUUID());
  return { id: project.id, version, updatedAt: project.updated_at, document };
}

/** Saves over `version`, and returns the new version and when the project changed. */
export async function saveProject(
  client: Client,
  id: string,
  document: ProjectDocument,
  version: string,
) {
  const saved = await client.saveProject(id, request(document), version);
  return { version: saved.version, updatedAt: saved.project.updated_at };
}

/** Deletes a project at `version`; one already gone counts as deleted. */
export async function deleteProject(client: Client, id: string, version: string) {
  await client.deleteProject(id, version).catch((reason) => {
    if (!isMissing(reason)) throw reason;
  });
}

/** Whether the API has no such project, such as one deleted in another tab. */
export const isMissing = (reason: unknown) => reason instanceof ApiError && reason.status === 404;

/** Whether a project cannot be opened for what it is, rather than for a failing request. */
export const isUnreadable = (reason: unknown) =>
  reason instanceof InvalidProject || (reason instanceof ApiError && reason.status === 404);

/** Whether a save failed because the project changed since, such as in another tab. */
export const isConflict = (reason: unknown) =>
  reason instanceof ApiError && !!withCode(reason.error, 'version_conflict');

/** Whether a new project was refused because the account holds as many as its plan allows. */
export const isProjectLimit = (reason: unknown) =>
  reason instanceof ApiError &&
  withCode(reason.error, 'limit_exceeded')?.limit.name === 'max_projects';
