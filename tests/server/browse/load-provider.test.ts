import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createProvider } from "@/server/db/providers";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-load-provider-"));
  const db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  db.close();
  vi.stubEnv("DATABASE_PATH", join(tmp, "test.db"));
  vi.resetModules();
});

afterEach(async () => {
  const { __resetDatabase } = await import("@/server/db");
  __resetDatabase();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe("loadProvider", () => {
  it("returns null for an unknown slug", async () => {
    const { loadProvider } = await import("@/server/browse/load-provider");
    expect(loadProvider("nope")).toBeNull();
  });

  it("returns a LocalStorageProvider for a local DB row", async () => {
    const { getDatabase } = await import("@/server/db");
    createProvider(getDatabase(), {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/files" },
    });
    const { loadProvider } = await import("@/server/browse/load-provider");
    const { LocalStorageProvider } = await import("@/server/storage/local");
    const p = loadProvider("nas");
    expect(p).toBeInstanceOf(LocalStorageProvider);
    expect(p?.slug).toBe("nas");
  });

  it("is case-insensitive on the slug", async () => {
    const { getDatabase } = await import("@/server/db");
    createProvider(getDatabase(), {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/files" },
    });
    const { loadProvider } = await import("@/server/browse/load-provider");
    expect(loadProvider("NAS")).not.toBeNull();
  });
});
