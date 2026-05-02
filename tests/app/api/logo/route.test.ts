import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { setSetting } from "@/server/db/settings";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-logo-route-"));
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

describe("GET /api/logo", () => {
  it("404 when logo_url is empty", async () => {
    const { GET } = await import("@/app/api/logo/route");
    const r = await GET();
    expect(r.status).toBe(404);
  });

  it("404 when logo_url is internal but file is missing", async () => {
    const { getDatabase } = await import("@/server/db");
    setSetting(getDatabase(), "logo_url", "internal:png");
    const { GET } = await import("@/app/api/logo/route");
    const r = await GET();
    expect(r.status).toBe(404);
  });

  it("404 when logo_url is an external URL (route is internal-only)", async () => {
    const { getDatabase } = await import("@/server/db");
    setSetting(getDatabase(), "logo_url", "https://cdn.example.com/x.png");
    const { GET } = await import("@/app/api/logo/route");
    const r = await GET();
    expect(r.status).toBe(404);
  });

  it("streams the file with the correct Content-Type when present", async () => {
    writeFileSync(join(dirname(dbPath), "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { getDatabase } = await import("@/server/db");
    setSetting(getDatabase(), "logo_url", "internal:png");
    const { GET } = await import("@/app/api/logo/route");
    const r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    const buf = Buffer.from(await r.arrayBuffer());
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});
