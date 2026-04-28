import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { setSetting } from "@/server/db/settings";
import { getGlobalDefaultAccess } from "@/server/access/global-default";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-global-default-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("getGlobalDefaultAccess", () => {
  it("reads the seeded default ('signed-in') after fresh migrations", () => {
    expect(getGlobalDefaultAccess(db)).toBe("signed-in");
  });

  it("reads 'public' when configured", () => {
    setSetting(db, "global_default_access", "public");
    expect(getGlobalDefaultAccess(db)).toBe("public");
  });

  it("falls back to 'signed-in' when the row is missing", () => {
    db.prepare("DELETE FROM settings WHERE key = 'global_default_access'").run();
    expect(getGlobalDefaultAccess(db)).toBe("signed-in");
  });

  it("falls back to 'signed-in' when the value is invalid", () => {
    setSetting(db, "global_default_access", "garbage");
    expect(getGlobalDefaultAccess(db)).toBe("signed-in");
  });
});
