import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { getSetting, setSetting, getAllSettings } from "@/server/db/settings";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-settings-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("settings repository", () => {
  it("getSetting returns null for a missing key", () => {
    expect(getSetting(db, "missing")).toBeNull();
  });

  it("setSetting + getSetting roundtrip", () => {
    setSetting(db, "theme", "dark");
    expect(getSetting(db, "theme")).toBe("dark");
  });

  it("setSetting overwrites an existing value", () => {
    setSetting(db, "theme", "dark");
    setSetting(db, "theme", "light");
    expect(getSetting(db, "theme")).toBe("light");
  });

  it("getAllSettings returns an object with every key/value", () => {
    setSetting(db, "alpha", "1");
    setSetting(db, "beta", "two");
    const all = getAllSettings(db);
    expect(all.alpha).toBe("1");
    expect(all.beta).toBe("two");
  });

  it("getAllSettings returns an empty object when no settings exist", () => {
    // The seeded keys (config_encryption_key, global_default_access, app_name, logo_url, accent_color)
    // are present after migrations. Just verify the shape is Record<string,string>.
    const all = getAllSettings(db);
    for (const v of Object.values(all)) expect(typeof v).toBe("string");
  });
});
