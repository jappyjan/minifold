import type { Database } from "better-sqlite3";

export type DirCacheRow = {
  path: string;
  hash: string;
  computed_at: number;
};

export function getDirCache(db: Database, path: string): DirCacheRow | null {
  return (
    (db
      .prepare("SELECT * FROM dir_cache WHERE path = ?")
      .get(path) as DirCacheRow | undefined) ?? null
  );
}

export function upsertDirCache(
  db: Database,
  path: string,
  hash: string,
  computedAt: number,
): void {
  db.prepare(
    `INSERT INTO dir_cache (path, hash, computed_at)
     VALUES (?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, computed_at = excluded.computed_at`,
  ).run(path, hash, computedAt);
}
