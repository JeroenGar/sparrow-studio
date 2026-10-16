import { ApiError, withCode, type Schemas } from '../api/client';
import { parseProject } from '../project/file';
import type { ProjectDocument } from '../project/model';
import { client } from './client';

/** A project as studio holds it: its document, and the version a save must start from. */
export type StoredProject = { id: string; version: string; document: ProjectDocument };
export type ProjectSummary = Schemas['ProjectSummary'];

/** Every project, most recently changed first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const all: ProjectSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listProjects(cursor);
    all.push(...page.data);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return all;
}

export async function openProject(id: string): Promise<StoredProject> {
  const { project, version } = await client.getProject(id);
  return { id, version, document: parseProject(project.document) };
}

/** The API stores a project's name beside its document; studio names it from the document. */
const request = (document: ProjectDocument) => ({ name: document.name, document });

export async function createProject(document: ProjectDocument): Promise<StoredProject> {
  const { project, version } = await client.createProject(request(document), crypto.randomUUID());
  return { id: project.id, version, document };
}

/** Saves over `version`, and returns the new one. */
export async function saveProject(id: string, document: ProjectDocument, version: string) {
  return (await client.saveProject(id, request(document), version)).version;
}

/** Deletes a project as it is now. */
export async function deleteProject(id: string) {
  const { version } = await client.getProject(id);
  await client.deleteProject(id, version);
}

/** Whether a save failed because the project changed since, such as in another tab. */
export const isConflict = (reason: unknown) =>
  reason instanceof ApiError && !!withCode(reason.error, 'version_conflict');
