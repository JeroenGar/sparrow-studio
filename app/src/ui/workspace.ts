import { useSyncExternalStore } from 'react';
import type { Client } from '../api/client';
import type { ProjectDocument } from '../project/model';
import { readSummary, summarize, type Summary } from '../project/summary';
import { explain } from './explain';
import {
  historyReducer,
  initialHistory,
  type History,
  type HistoryAction,
  type Results,
} from './history';
import {
  createProject,
  deleteProject,
  isConflict,
  isMissing,
  listProjects,
  openProject,
  saveProject,
  type StoredProject,
} from './projects';

/** Whether a project's edits are saved: a failed save says why. */
export type SaveState =
  | { state: 'saved' | 'saving' }
  | { state: 'error' | 'conflict'; message: string };

/**
 * A project in the workspace: listed, with the summary Home shows of it; loading its document,
 * or failed to; or open, with its undo history and the document last saved. One that fails to
 * load stands alone: the others open as usual.
 */
export type ProjectEntry = { id: string; updatedAt: string } & (
  | { status: 'listed'; name: string; summary: Summary }
  | { status: 'loading'; name: string; summary?: Summary }
  | { status: 'failed'; name: string; summary?: Summary; error: string }
  | {
      status: 'open';
      version: string;
      history: History;
      saved: ProjectDocument;
      save: SaveState;
    }
);
export type OpenEntry = Extract<ProjectEntry, { status: 'open' }>;

export type WorkspaceState =
  | { status: 'loading' }
  | { status: 'failed'; error: string }
  | { status: 'ready'; projects: ProjectEntry[] };

/** A project's name: its document's once open, the list's before. */
export const entryName = (entry: ProjectEntry) =>
  entry.status === 'open' ? entry.history.present.name : entry.name;

/** What Home shows of a project: of its document as it is now once open, the list's before. */
export const entrySummary = (entry: ProjectEntry): Summary | undefined =>
  entry.status === 'open' ? summarize(entry.history.present) : entry.summary;

/** How many documents load at the same time: the API reads two at a time for an account. */
const LOADING = 2;

const opened = (stored: StoredProject): OpenEntry => ({
  id: stored.id,
  updatedAt: stored.updatedAt,
  status: 'open',
  version: stored.version,
  history: initialHistory(stored.document),
  saved: stored.document,
  save: { state: 'saved' },
});

/**
 * Every project of the account, each with its document, as one store: the pages read it, edits
 * and results go through it, and it saves each project shortly after it changes, one save at a
 * time. A project's results, such as a job that ends, reach it whether or not it is shown.
 */
export function createWorkspace(client: Client, { saveDelay = 400 } = {}) {
  let state: WorkspaceState = { status: 'loading' };
  const listeners = new Set<() => void>();
  const saves = new Map<string, Promise<boolean>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const emit = (next: WorkspaceState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const find = (id: string) =>
    state.status === 'ready' ? state.projects.find((entry) => entry.id === id) : undefined;
  /** Replaces a project's entry with what `change` makes of it; nothing removes it. */
  const replace = (id: string, change: (entry: ProjectEntry) => ProjectEntry | undefined) => {
    if (state.status !== 'ready' || !find(id)) return;
    const projects = state.projects.flatMap((entry) =>
      entry.id === id ? (change(entry) ?? []) : [entry],
    );
    emit({ status: 'ready', projects });
  };
  const replaceOpen = (id: string, change: (entry: OpenEntry) => OpenEntry) =>
    replace(id, (entry) => (entry.status === 'open' ? change(entry) : entry));
  // The documents waiting to load, and how many are loading.
  const waiting: (() => void)[] = [];
  let reading = 0;
  /** Reads a document once fewer than `LOADING` are being read. */
  async function read(id: string) {
    if (reading >= LOADING) await new Promise<void>((resolve) => waiting.push(resolve));
    reading++;
    try {
      return await openProject(client, id);
    } finally {
      reading--;
      waiting.shift()?.();
    }
  }

  /** Saves a project's latest document after any save in progress; resolves to whether it is saved. */
  function flush(id: string): Promise<boolean> {
    clearTimeout(timers.get(id));
    timers.delete(id);
    const next = (saves.get(id) ?? Promise.resolve(true)).then(async () => {
      for (;;) {
        const entry = find(id);
        // A project removed, or being reloaded, has nothing to save.
        if (entry?.status !== 'open' || entry.save.state === 'conflict') return false;
        const document = entry.history.present;
        if (document === entry.saved) break;
        try {
          const saved = await saveProject(client, id, document, entry.version);
          replaceOpen(id, (current) => ({ ...current, ...saved, saved: document }));
        } catch (reason) {
          const message = explain(reason);
          replaceOpen(id, (current) => ({
            ...current,
            save: { state: isConflict(reason) ? 'conflict' : 'error', message },
          }));
          return false;
        }
      }
      replaceOpen(id, (current) => ({ ...current, save: { state: 'saved' } }));
      return true;
    });
    saves.set(id, next);
    return next;
  }

  /** Applies an action to a project's history, and saves it soon: at once when its jobs changed. */
  function dispatch(id: string, action: HistoryAction) {
    const before = find(id);
    if (before?.status !== 'open') return;
    const history = historyReducer(before.history, action);
    if (history === before.history) return;
    const save: SaveState =
      before.save.state === 'conflict' || history.present === before.saved
        ? before.save
        : { state: 'saving' };
    replaceOpen(id, (entry) => ({ ...entry, history, save }));
    if (save.state !== 'saving') return;
    clearTimeout(timers.get(id));
    const now = history.present.jobs !== before.saved.jobs;
    timers.set(
      id,
      setTimeout(() => void flush(id), now ? 0 : saveDelay),
    );
  }

  /** Lets go of a project the API no longer has, such as one deleted in another tab. */
  function forget(id: string) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    replace(id, () => undefined);
    saves.delete(id);
  }

  /** Opens a project, or opens it again, such as after it changed in another tab. */
  async function reload(id: string) {
    const entry = find(id);
    if (!entry) return;
    clearTimeout(timers.get(id));
    timers.delete(id);
    const [name, summary] = [entryName(entry), entrySummary(entry)];
    replace(id, () => ({ id, updatedAt: entry.updatedAt, status: 'loading', name, summary }));
    try {
      const stored = await read(id);
      replace(id, () => opened(stored));
    } catch (reason) {
      replace(id, (current) => ({
        id,
        updatedAt: current.updatedAt,
        status: 'failed',
        name,
        summary,
        error: explain(reason),
      }));
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get: () => state,
    find,

    /**
     * Lists the account's projects with their summaries, then opens those whose summary cannot
     * stand in for them: those with jobs running, to follow them, and those without a summary
     * studio reads, such as one saved before summaries.
     */
    async load() {
      emit({ status: 'loading' });
      let listed;
      try {
        listed = await listProjects(client);
      } catch (reason) {
        emit({ status: 'failed', error: explain(reason) });
        throw reason;
      }
      const projects = listed.map((project): ProjectEntry => {
        const summary = readSummary(project.summary);
        const base = { id: project.id, updatedAt: project.updated_at, name: project.name };
        return summary && !summary.running.length
          ? { ...base, status: 'listed', summary }
          : { ...base, status: 'loading', summary };
      });
      emit({ status: 'ready', projects });
      await Promise.all(
        projects.flatMap((entry) => (entry.status === 'loading' ? [reload(entry.id)] : [])),
      );
    },
    reload,
    /** Opens a listed project, such as when it is shown; one loading or open already stays so. */
    open(id: string) {
      if (find(id)?.status === 'listed') void reload(id);
    },

    /** Applies an edit to a project's document; edits with the same key in quick succession form one undo step. */
    edit(id: string, change: (project: ProjectDocument) => ProjectDocument, key?: string) {
      const entry = find(id);
      if (entry?.status !== 'open') return;
      const project = change(entry.history.present);
      dispatch(id, { type: 'edit', project, key, at: performance.now() });
    },
    /** Changes a project's results, such as its jobs: they are no edits to undo. */
    results: (id: string, change: (project: ProjectDocument) => Partial<Results>) =>
      dispatch(id, { type: 'results', change }),
    undo: (id: string) => dispatch(id, { type: 'undo' }),
    redo: (id: string) => dispatch(id, { type: 'redo' }),

    async create(document: ProjectDocument): Promise<string> {
      const stored = await createProject(client, document);
      if (state.status === 'ready')
        emit({ status: 'ready', projects: [opened(stored), ...state.projects] });
      return stored.id;
    },

    /**
     * Deletes a project, after any save in progress, at the version last saved or read: an open
     * project's own, or for one that is not, the version it was shown at. One that changed
     * elsewhere since stays, to be reloaded; one already gone is gone here too.
     */
    async remove(id: string, shown?: string) {
      // Saving first gives the version to delete at, and a save cannot land after the deletion.
      await flush(id);
      const entry = find(id);
      if (!entry) return;
      try {
        const version = entry.status === 'open' ? entry.version : shown;
        if (!version) throw Error('Open the project to delete it.');
        await deleteProject(client, id, version);
      } catch (reason) {
        if (!isMissing(reason)) {
          if (isConflict(reason))
            replaceOpen(id, (current) => ({
              ...current,
              save: { state: 'conflict', message: explain(reason) },
            }));
          throw reason;
        }
      }
      forget(id);
    },
    forget,

    /** Saves every project with changes now, such as when the page is hidden. */
    flushAll: () =>
      Promise.all(
        state.status === 'ready'
          ? state.projects.flatMap((entry) =>
              entry.status === 'open' && entry.history.present !== entry.saved
                ? [flush(entry.id)]
                : [],
            )
          : [],
      ),
    /** Whether any project has changes not saved yet. */
    unsaved: () =>
      state.status === 'ready' &&
      state.projects.some(
        (entry) => entry.status === 'open' && entry.history.present !== entry.saved,
      ),
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;

/** The workspace's state, kept current. */
export function useWorkspace(workspace: Workspace): WorkspaceState {
  return useSyncExternalStore(workspace.subscribe, workspace.get);
}
