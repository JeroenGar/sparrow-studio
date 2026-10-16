/**
 * The local backend's project storage: the API's project resources, kept in this browser. The
 * document is opaque here, as it is to the API. Each record counts its versions; a change names
 * the version it starts from, checked in the same transaction, so two tabs never overwrite each
 * other's work.
 */
export type ProjectRecord = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  version: number;
  document: unknown;
};

/** What a change found: the record it wrote, or why it wrote nothing. */
export type Change = ProjectRecord | 'missing' | 'conflict';

export interface ProjectRecords {
  all(): Promise<ProjectRecord[]>;
  get(id: string): Promise<ProjectRecord | undefined>;
  create(record: ProjectRecord): Promise<void>;
  replace(
    id: string,
    version: number,
    change: Pick<ProjectRecord, 'name' | 'document'>,
  ): Promise<Change>;
  remove(id: string, version: number): Promise<Change>;
}

/** Records in memory, for tests. */
export function memoryRecords(): ProjectRecords {
  const records = new Map<string, ProjectRecord>();
  const changed = (id: string, version: number, next?: ProjectRecord): Change => {
    const current = records.get(id);
    if (!current) return 'missing';
    if (current.version !== version) return 'conflict';
    if (next) records.set(id, next);
    else records.delete(id);
    return next ?? current;
  };
  return {
    all: async () => [...records.values()],
    get: async (id) => records.get(id),
    create: async (record) => void records.set(record.id, record),
    replace: async (id, version, change) => {
      const current = records.get(id);
      return changed(
        id,
        version,
        current && {
          ...current,
          ...change,
          version: version + 1,
          updated_at: new Date().toISOString(),
        },
      );
    },
    remove: async (id, version) => changed(id, version),
  };
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
  action: (store: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let value: T;
      action(tx.objectStore(STORE), (result) => (value = result));
      tx.oncomplete = () => resolve(value);
      tx.onabort = () =>
        reject(
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

/**
 * Records stored before the local backend kept the API's fields, as `{ id, updatedAt, version,
 * document }` and sometimes a `name`, take what they lack from what they have.
 */
export function read(raw: Record<string, unknown> | undefined): ProjectRecord | undefined {
  if (!raw) return undefined;
  if (typeof raw.updated_at === 'string') return raw as ProjectRecord;
  const document = raw.document as { name?: unknown } | undefined;
  const updated = String(raw.updatedAt ?? new Date(0).toISOString());
  const name = typeof raw.name === 'string' ? raw.name : document?.name;
  return {
    id: String(raw.id),
    name: typeof name === 'string' ? name : 'Untitled project',
    created_at: updated,
    updated_at: updated,
    version: Number(raw.version) || 1,
    document,
  };
}

/** Changes the record `id` at `version` in one transaction: `next` replaces it, or none deletes it. */
function change(id: string, version: number, next?: (current: ProjectRecord) => ProjectRecord) {
  return transaction<Change>('readwrite', (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => {
      const current = read(request.result);
      if (!current) return done('missing');
      if (current.version !== version) return done('conflict');
      if (!next) {
        store.delete(id).onsuccess = () => done(current);
        return;
      }
      const record = next(current);
      store.put(record).onsuccess = () => done(record);
    };
  });
}

export const browserRecords: ProjectRecords = {
  all: () =>
    transaction<ProjectRecord[]>('readonly', (store, done) => {
      const request = store.getAll();
      request.onsuccess = () => done(request.result.map((raw) => read(raw)!));
    }),
  get: (id) =>
    transaction<ProjectRecord | undefined>('readonly', (store, done) => {
      const request = store.get(id);
      request.onsuccess = () => done(read(request.result));
    }),
  create: (record) =>
    transaction<void>('readwrite', (store, done) => {
      store.add(record).onsuccess = () => done();
    }),
  replace: (id, version, { name, document }) =>
    change(id, version, (current) => ({
      ...current,
      name,
      document,
      version: version + 1,
      updated_at: new Date().toISOString(),
    })),
  remove: (id, version) => change(id, version),
};
