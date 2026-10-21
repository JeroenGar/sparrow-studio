import { ApiError, withCode, type Client, type Project, type ProjectParts } from '../api/client';
import { parseProject } from '../project/file';
import type { ProjectDocument } from '../project/model';
import { summarize } from '../project/summary';
import { patiently } from './patiently';

/** A project as studio holds it: its document, the version a save must start from, and when it last changed. */
export type StoredProject = {
  id: string;
  version: string;
  updatedAt: string;
  document: ProjectDocument;
};

/** Every project, most recently changed first, with its summary but without its document. */
export async function listProjects(client: Client): Promise<Project[]> {
  const all: Project[] = [];
  let cursor: string | undefined;
  do {
    const page = await patiently(() => client.listProjects(cursor));
    all.push(...page.data);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return all;
}

/** A project's document, with the version it was saved at. */
export async function openProject(client: Client, id: string) {
  const { document, version } = await patiently(() => client.getProjectDocument(id));
  return { version, document: parseProject(await decode(document)) };
}

/**
 * What a project is saved as: its name, which the API lists beside it, its summary for Home, and
 * the document as gzipped JSON.
 */
async function parts(document: ProjectDocument): Promise<ProjectParts> {
  return { name: document.name, summary: summarize(document), document: await encode(document) };
}

export async function createProject(
  client: Client,
  document: ProjectDocument,
): Promise<StoredProject> {
  // Asked again with the same key and the same bytes, a busy API still creates one project.
  const [body, key] = [await parts(document), crypto.randomUUID()];
  const { project, version } = await patiently(() => client.createProject(body, key));
  return { id: project.id, version, updatedAt: project.updated_at, document };
}

/** Saves over `version`, and returns the new version and when the project changed. */
export async function saveProject(
  client: Client,
  id: string,
  document: ProjectDocument,
  version: string,
) {
  const body = await parts(document);
  const saved = await patiently(() => client.saveProject(id, body, version));
  return { version: saved.version, updatedAt: saved.project.updated_at };
}

/** Deletes a project at `version`; one already gone counts as deleted. */
export async function deleteProject(client: Client, id: string, version: string) {
  await patiently(() => client.deleteProject(id, version)).catch((reason) => {
    if (!isMissing(reason)) throw reason;
  });
}

/** A document as studio saves it: its JSON, gzipped in the browser. */
async function encode(document: ProjectDocument): Promise<Blob> {
  const json = new Blob([JSON.stringify(document)]).stream();
  return new Response(json.pipeThrough(new CompressionStream('gzip'))).blob();
}

/**
 * A saved document's JSON, gzipped as studio saves it, or plain as this browser kept projects
 * before; its first bytes tell.
 */
async function decode(document: Blob): Promise<unknown> {
  const start = new Uint8Array(await document.slice(0, 2).arrayBuffer());
  const gzipped = start[0] === 0x1f && start[1] === 0x8b;
  const text = gzipped
    ? await new Response(document.stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : await document.text();
  return JSON.parse(text);
}

/** Whether the API has no such project, such as one deleted in another tab. */
export const isMissing = (reason: unknown) => reason instanceof ApiError && reason.status === 404;

/** Whether a save failed because the project changed since, such as in another tab. */
export const isConflict = (reason: unknown) =>
  reason instanceof ApiError && !!withCode(reason.error, 'version_conflict');

/** Whether a new project was refused because the account holds as many as its plan allows. */
export const isProjectLimit = (reason: unknown) =>
  reason instanceof ApiError &&
  withCode(reason.error, 'limit_exceeded')?.limit.name === 'max_projects';
