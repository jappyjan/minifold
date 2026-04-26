import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

describe("bundled migrations", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("applies 001_init and creates the settings table", () => {
    const tmp = mkdtempSync(join(tmpdir(), "minifold-init-"));
    const db = createDatabase(join(tmp, "test.db"));
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    const dir = resolve(process.cwd(), "src/server/db/migrations");
    runMigrations(db, dir);

    const cols = db.prepare("PRAGMA table_info(settings)").all() as Array<{
      name: string;
    }>;
    expect(cols.map((c) => c.name).sort()).toEqual(["key", "value"]);
  });

  it("applies 002_auth and creates users + sessions tables", () => {
    const tmp = mkdtempSync(join(tmpdir(), "minifold-init-"));
    const db = createDatabase(join(tmp, "test.db"));
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    const dir = resolve(process.cwd(), "src/server/db/migrations");
    runMigrations(db, dir);

    const userCols = db.prepare("PRAGMA table_info(users)").all() as Array<{
      name: string;
    }>;
    expect(userCols.map((c) => c.name).sort()).toEqual(
      [
        "created_at",
        "deactivated",
        "username",
        "id",
        "last_login",
        "must_change_password",
        "name",
        "password",
        "role",
      ].sort(),
    );

    const sessionCols = db
      .prepare("PRAGMA table_info(sessions)")
      .all() as Array<{
      name: string;
    }>;
    expect(sessionCols.map((c) => c.name).sort()).toEqual(
      [
        "created_at",
        "expires_at",
        "id",
        "last_seen_at",
        "token_hash",
        "user_id",
      ].sort(),
    );
  });

  it("applies 003_providers and creates providers table", () => {
    const tmp = mkdtempSync(join(tmpdir(), "minifold-init-"));
    const db = createDatabase(join(tmp, "test.db"));
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    const dir = resolve(process.cwd(), "src/server/db/migrations");
    runMigrations(db, dir);

    const cols = db.prepare("PRAGMA table_info(providers)").all() as Array<{
      name: string;
    }>;
    expect(cols.map((c) => c.name).sort()).toEqual(
      ["config", "created_at", "name", "position", "slug", "type"].sort(),
    );
  });

  it("applies 004_dir_cache and creates dir_cache table", () => {
    const tmp = mkdtempSync(join(tmpdir(), "minifold-init-"));
    const db = createDatabase(join(tmp, "test.db"));
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    const dir = resolve(process.cwd(), "src/server/db/migrations");
    runMigrations(db, dir);

    const cols = db.prepare("PRAGMA table_info(dir_cache)").all() as Array<{
      name: string;
    }>;
    expect(cols.map((c) => c.name).sort()).toEqual(
      ["computed_at", "hash", "path"].sort(),
    );
  });
});
