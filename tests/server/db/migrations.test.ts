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
});
