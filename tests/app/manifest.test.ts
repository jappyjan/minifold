import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { setSetting } from "@/server/db/settings";

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-manifest-"));
  dbPath = join(tmp, "test.db");
  const db = createDatabase(dbPath);
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  db.close();
  vi.stubEnv("DATABASE_PATH", dbPath);
  vi.resetModules();
});

afterEach(async () => {
  const { __resetDatabase } = await import("@/server/db");
  __resetDatabase();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe("manifest", () => {
  it("returns name/short_name/theme_color from settings", async () => {
    const { getDatabase } = await import("@/server/db");
    setSetting(getDatabase(), "app_name", "TeamFiles");
    setSetting(getDatabase(), "accent_color", "#ff0066");

    const { default: manifest } = await import("@/app/manifest");
    const m = manifest();
    expect(m.name).toBe("TeamFiles");
    expect(m.short_name).toBe("TeamFiles");
    expect(m.theme_color).toBe("#ff0066");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
  });

  it("falls back to defaults when settings are empty strings", async () => {
    const { getDatabase } = await import("@/server/db");
    setSetting(getDatabase(), "app_name", "");
    setSetting(getDatabase(), "accent_color", "");

    const { default: manifest } = await import("@/app/manifest");
    const m = manifest();
    expect(m.name).toBe("Minifold");
    expect(m.theme_color).toBe("#3b82f6");
  });

  it("returns four icons (180, 192, 512, 512-maskable) all pointing at /api/icon/", async () => {
    const { default: manifest } = await import("@/app/manifest");
    const m = manifest();
    expect(m.icons).toHaveLength(4);
    expect(m.icons?.map((i) => i.src)).toEqual([
      "/api/icon/180/any.png",
      "/api/icon/192/any.png",
      "/api/icon/512/any.png",
      "/api/icon/512/maskable.png",
    ]);
    expect(m.icons?.[3]?.purpose).toBe("maskable");
  });

  it("truncates short_name to 12 chars when name is longer", async () => {
    const { getDatabase } = await import("@/server/db");
    setSetting(getDatabase(), "app_name", "VeryLongApplicationName");
    const { default: manifest } = await import("@/app/manifest");
    const m = manifest();
    expect(m.name).toBe("VeryLongApplicationName");
    expect(m.short_name).toBe("VeryLongAppl"); // first 12 chars
  });
});
