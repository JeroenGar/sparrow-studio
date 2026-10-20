import { useSyncExternalStore } from 'react';
import { ApiError, type Client } from '../api/client';
import type { ProjectDocument } from '../project/model';
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
 * A project in the workspace: still loading, failed to load, or open, with its undo history and
 * the document last saved. One that fails to load stands alone: the others open as usual.
 */
export type ProjectEntry = { id: string; updatedAt: string } & (
  | { status: 'loading'; name: string }
  | { status: 'failed'; name: string; error: string }
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

/** How many projects load at the same time. */
const LOADING = 4;

/**
 * Makes a request, again after the time the API asks for when it is busy or limits the rate, a
 * few times at most.
 */
async function patiently<T>(request: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await request();
    } catch (reason) {
      const busy = reason instanceof ApiError && (reason.status === 429 || reason.status === 503);
      if (!busy || attempt >= attempts) throw reason;
      const seconds = Number(reason.headers.get('Retry-After') ?? 1);
      await new Promise((resolve) =>
        setTimeout(resolve, (Number.isFinite(seconds) && seconds >= 0 ? seconds : 1) * 1000),
      );
    }
  }
}

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

  /** Opens a project, or opens it again, such as after it changed in another tab. */
  async function reload(id: string) {
    const entry = find(id);
    if (!entry) return;
    clearTimeout(timers.get(id));
    timers.delete(id);
    const name = entryName(entry);
    replace(id, () => ({ id, updatedAt: entry.updatedAt, status: 'loading', name }));
    try {
      const stored = await patiently(() => openProject(client, id));
      replace(id, () => opened(stored));
    } catch (reason) {
      replace(id, (current) => ({
        id,
        updatedAt: current.updatedAt,
        status: 'failed',
        name,
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

    /** Lists the account's projects, then opens each of them side by side. */
    async load() {
      emit({ status: 'loading' });
      let summaries;
      try {
        summaries = await listProjects(client, patiently);
      } catch (reason) {
        emit({ status: 'failed', error: explain(reason) });
        throw reason;
      }
      emit({
        status: 'ready',
        projects: summaries.map((summary) => ({
          id: summary.id,
          updatedAt: summary.updated_at,
          status: 'loading',
          name: summary.name,
        })),
      });
      // A few at a time, so a busy API is not asked for all of them at once.
      const queue = summaries.map((summary) => summary.id);
      await Promise.all(
        Array.from({ length: LOADING }, async () => {
          for (let id = queue.shift(); id !== undefined; id = queue.shift()) await reload(id);
        }),
      );
    },
    reload,

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
     * Deletes a project, after any save in progress, at the version last saved or read. One that
     * changed elsewhere since stays, to be reloaded; one already gone is gone here too.
     */
    async remove(id: string) {
      // Saving first gives the version to delete at, and a save cannot land after the deletion.
      await flush(id);
      const entry = find(id);
      if (!entry) return;
      try {
        const version =
          entry.status === 'open' ? entry.version : (await client.getProject(id)).version;
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
      clearTimeout(timers.get(id));
      timers.delete(id);
      replace(id, () => undefined);
      saves.delete(id);
    },

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
