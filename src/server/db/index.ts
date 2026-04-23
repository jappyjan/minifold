import type { Database } from "better-sqlite3";
import { resolve } from "node:path";
import { createDatabase } from "./client";
import { runMigrations } from "./migrate";

let instance: Database | null = null;

const DEFAULT_DB_PATH = resolve(process.cwd(), "data/minifold.db");
const MIGRATIONS_DIR = resolve(process.cwd(), "src/server/db/migrations");

export function getDatabase(): Database {
  if (instance) return instance;
  const path = process.env.DATABASE_PATH ?? DEFAULT_DB_PATH;
  const db = createDatabase(path);
  runMigrations(db, MIGRATIONS_DIR);
  instance = db;
  return db;
}

// Test-only: allow tests to reset the singleton between runs.
export function __resetDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
