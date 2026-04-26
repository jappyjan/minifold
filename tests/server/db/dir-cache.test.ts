import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { getDirCache, upsertDirCache } from "@/server/db/dir-cache";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-dir-cache-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("dir-cache repository", () => {
  it("getDirCache returns null when no row exists", () => {
    expect(getDirCache(db, "nas/prints")).toBeNull();
  });

  it("upsertDirCache inserts a new row and getDirCache returns it", () => {
    upsertDirCache(db, "nas/prints", "abc123", 1700000000000);
    expect(getDirCache(db, "nas/prints")).toEqual({
      path: "nas/prints",
      hash: "abc123",
      computed_at: 1700000000000,
    });
  });

  it("upsertDirCache replaces existing rows for the same path", () => {
    upsertDirCache(db, "nas/prints", "old", 1);
    upsertDirCache(db, "nas/prints", "new", 2);
    expect(getDirCache(db, "nas/prints")).toEqual({
      path: "nas/prints",
      hash: "new",
      computed_at: 2,
    });
  });

  it("paths are independent rows", () => {
    upsertDirCache(db, "nas/a", "h1", 1);
    upsertDirCache(db, "nas/b", "h2", 2);
    expect(getDirCache(db, "nas/a")?.hash).toBe("h1");
    expect(getDirCache(db, "nas/b")?.hash).toBe("h2");
  });
});
