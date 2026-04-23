import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "@/server/db/client";

describe("createDatabase", () => {
  let tmp: string | null = null;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it("opens a SQLite file and enables WAL mode", () => {
    tmp = mkdtempSync(join(tmpdir(), "minifold-db-"));
    const db = createDatabase(join(tmp, "test.db"));
    const row = db.pragma("journal_mode", { simple: false }) as Array<{
      journal_mode: string;
    }>;
    expect(row[0]!.journal_mode).toBe("wal");
    db.close();
  });

  it("enables foreign keys", () => {
    tmp = mkdtempSync(join(tmpdir(), "minifold-db-"));
    const db = createDatabase(join(tmp, "test.db"));
    const fk = db.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);
    db.close();
  });

  it("creates parent directories as needed", () => {
    tmp = mkdtempSync(join(tmpdir(), "minifold-db-"));
    const db = createDatabase(join(tmp, "nested", "deep", "test.db"));
    expect(db.open).toBe(true);
    db.close();
  });
});
