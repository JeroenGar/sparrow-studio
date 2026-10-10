import { newId } from '../engine/model';
import { parseProject } from './file';
import type { ProjectDocument } from './model';

export type ProjectSummary = { id: string; name: string; updatedAt: string; version: number };
export type StoredProject = ProjectSummary & { document: ProjectDocument };

/** Thrown when a save starts from an older version, for example after an edit in another tab. */
export class VersionConflict extends Error {
  constructor() {
    super('This project was changed in another tab. Reload it to continue.');
  }
}

/**
 * Where projects live. The browser implementation below is the only one for now; a sparrow cloud
 * implementation can follow the cloud project endpoints, which use the same version check.
 */
export interface ProjectStore {
  list(): Promise<ProjectSummary[]>;
  get(id: string): Promise<StoredProject | undefined>;
  create(document: ProjectDocument): Promise<StoredProject>;
  save(id: string, document: ProjectDocument, expectedVersion: number): Promise<StoredProject>;
  remove(id: string): Promise<void>;
}

const DATABASE = 'sparrow-studio';
const STORE = 'projects';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onerror = () =>
      reject(Error('Browser storage is unavailable. Export your project to keep a copy.'));
    request.onblocked = () =>
      reject(Error('Close other sparrow studio tabs to open browser storage.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, done: (value: T) => void, abort: (error: Error) => void) => void,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let value: T;
      let failure: Error | undefined;
      action(
        tx.objectStore(STORE),
        (result) => (value = result),
        (error) => {
          failure = error;
          tx.abort();
        },
      );
      tx.oncomplete = () => resolve(value);
      tx.onabort = () =>
        reject(
          failure ??
            Error(
              tx.error?.name === 'QuotaExceededError'
                ? 'Browser storage is full. Export and delete projects you no longer need.'
                : 'Could not access browser storage.',
            ),
        );
    });
  } finally {
    db.close();
  }
}

const summary = ({ id, name, updatedAt, version }: StoredProject): ProjectSummary => ({
  id,
  name,
  updatedAt,
  version,
});

export const browserStore: ProjectStore = {
  async list() {
    const all = await transaction<StoredProject[]>('readonly', (store, done) => {
      const request = store.getAll();
      request.onsuccess = () => done(request.result as StoredProject[]);
    });
    return all.map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async get(id) {
    const stored = await transaction<StoredProject | undefined>('readonly', (store, done) => {
      const request = store.get(id);
      request.onsuccess = () => done(request.result as StoredProject | undefined);
    });
    return stored && { ...stored, document: parseProject(stored.document) };
  },
  async create(document) {
    const stored: StoredProject = {
      id: newId(),
      name: document.name,
      updatedAt: new Date().toISOString(),
      version: 1,
      document,
    };
    await transaction<void>('readwrite', (store, done) => {
      store.add(stored).onsuccess = () => done();
    });
    return stored;
  },
  async save(id, document, expectedVersion) {
    return transaction<StoredProject>('readwrite', (store, done, abort) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const current = request.result as StoredProject | undefined;
        if (!current) return abort(Error('This project no longer exists in this browser.'));
        if (current.version !== expectedVersion) return abort(new VersionConflict());
        const next: StoredProject = {
          id,
          name: document.name,
          updatedAt: new Date().toISOString(),
          version: current.version + 1,
          document,
        };
        store.put(next).onsuccess = () => done(next);
      };
    });
  },
  async remove(id) {
    await transaction<void>('readwrite', (store, done) => {
      store.delete(id).onsuccess = () => done();
    });
  },
};
