import Database, { type Database as DB } from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

export function createDatabase(path: string): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  return db;
}
