import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

function setup() {
  const tmp = mkdtempSync(join(tmpdir(), "minifold-mig-"));
  const migrationsDir = join(tmp, "migrations");
  mkdirSync(migrationsDir);
  const db = createDatabase(join(tmp, "test.db"));
  return { tmp, migrationsDir, db };
}

describe("runMigrations", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("creates schema_migrations table on first run", () => {
    const { tmp, migrationsDir, db } = setup();
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    runMigrations(db, migrationsDir);

    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
      )
      .get();
    expect(table).toBeDefined();
  });

  it("applies migrations in filename order and records them", () => {
    const { tmp, migrationsDir, db } = setup();
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    writeFileSync(
      join(migrationsDir, "001_a.sql"),
      "CREATE TABLE a (id INTEGER PRIMARY KEY);",
    );
    writeFileSync(
      join(migrationsDir, "002_b.sql"),
      "CREATE TABLE b (id INTEGER PRIMARY KEY);",
    );

    runMigrations(db, migrationsDir);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('a','b') ORDER BY name",
      )
      .all();
    expect(tables).toEqual([{ name: "a" }, { name: "b" }]);

    const applied = db
      .prepare("SELECT name FROM schema_migrations ORDER BY name")
      .all();
    expect(applied).toEqual([{ name: "001_a.sql" }, { name: "002_b.sql" }]);
  });

  it("is idempotent — already-applied migrations are skipped", () => {
    const { tmp, migrationsDir, db } = setup();
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    writeFileSync(
      join(migrationsDir, "001_a.sql"),
      "CREATE TABLE a (id INTEGER PRIMARY KEY);",
    );

    runMigrations(db, migrationsDir);
    // Second run must not re-execute the CREATE TABLE (which would throw).
    expect(() => runMigrations(db, migrationsDir)).not.toThrow();
  });

  it("rolls back a failing migration in a transaction", () => {
    const { tmp, migrationsDir, db } = setup();
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    writeFileSync(
      join(migrationsDir, "001_bad.sql"),
      "CREATE TABLE ok (id INTEGER); CREATE TABLE broken (;",
    );

    expect(() => runMigrations(db, migrationsDir)).toThrow();
    const ok = db
      .prepare("SELECT name FROM sqlite_master WHERE name='ok'")
      .get();
    expect(ok).toBeUndefined();
    const applied = db
      .prepare("SELECT name FROM schema_migrations WHERE name='001_bad.sql'")
      .get();
    expect(applied).toBeUndefined();
  });
});
