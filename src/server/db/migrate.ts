import type { Database } from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function runMigrations(db: Database, migrationsDir: string): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const isApplied = db.prepare(
    "SELECT 1 FROM schema_migrations WHERE name = ?",
  );
  const record = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );

  for (const file of files) {
    if (isApplied.get(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      record.run(file, Date.now());
    });
    tx();
  }
}
