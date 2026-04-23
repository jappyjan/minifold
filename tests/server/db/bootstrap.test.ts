import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("getDatabase (singleton)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "minifold-boot-"));
    vi.stubEnv("DATABASE_PATH", join(tmp, "minifold.db"));
    vi.resetModules();
  });

  afterEach(async () => {
    const mod = await import("@/server/db");
    mod.__resetDatabase();
    rmSync(tmp, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("returns the same instance across calls", async () => {
    const { getDatabase } = await import("@/server/db");
    const a = getDatabase();
    const b = getDatabase();
    expect(a).toBe(b);
  });

  it("applies bundled migrations on first call", async () => {
    const { getDatabase } = await import("@/server/db");
    const db = getDatabase();
    const cols = db
      .prepare("PRAGMA table_info(settings)")
      .all() as Array<{ name: string }>;
    expect(cols.length).toBeGreaterThan(0);
  });

  it("respects DATABASE_PATH env var", async () => {
    const { getDatabase } = await import("@/server/db");
    const db = getDatabase();
    expect(db.name).toBe(join(tmp, "minifold.db"));
  });
});
