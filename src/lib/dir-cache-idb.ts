import type { Entry } from "@/server/storage/types";

export const IDB_DB_NAME = "minifold";
export const IDB_STORE = "dir-cache";
const IDB_VERSION = 1;

export type CachedDir = {
  hash: string;
  entries: Entry[];
  cachedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, mode);
        const store = tx.objectStore(IDB_STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

export async function getCachedDir(key: string): Promise<CachedDir | null> {
  const value = await withStore(
    "readonly",
    (s) => s.get(key) as IDBRequest<CachedDir | undefined>,
  );
  return value ? rehydrate(value) : null;
}

export async function setCachedDir(
  key: string,
  value: CachedDir,
): Promise<void> {
  await withStore("readwrite", (s) => s.put(value, key));
}

export async function clearCachedDir(key: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(key));
}

// IndexedDB serializes Date objects to strings on some platforms — coerce
// modifiedAt back to Date to keep the Entry shape contract.
function rehydrate(v: CachedDir): CachedDir {
  return {
    hash: v.hash,
    cachedAt: v.cachedAt,
    entries: v.entries.map((e) => ({
      ...e,
      modifiedAt:
        e.modifiedAt instanceof Date ? e.modifiedAt : new Date(e.modifiedAt),
    })),
  };
}
