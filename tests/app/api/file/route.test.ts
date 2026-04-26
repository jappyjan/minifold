import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createProvider } from "@/server/db/providers";

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

let tmp: string;
let filesRoot: string;

async function ctx(provider: string, path: string[]) {
  return { params: Promise.resolve({ provider, path }) };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-file-route-"));
  filesRoot = join(tmp, "files");
  mkdirSync(filesRoot, { recursive: true });
  mkdirSync(join(filesRoot, "prints"));
  writeFileSync(
    join(filesRoot, "prints", "anchor.stl"),
    Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
  );
  writeFileSync(join(filesRoot, "notes.md"), "# Hello\n");

  const db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  createProvider(db, {
    slug: "nas",
    name: "NAS",
    type: "local",
    config: { rootPath: filesRoot },
  });
  db.close();

  vi.stubEnv("DATABASE_PATH", join(tmp, "test.db"));
  vi.resetModules();
});

afterEach(async () => {
  const { __resetDatabase } = await import("@/server/db");
  __resetDatabase();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

async function authedAsUser() {
  const mod = await import("@/server/auth/current-user");
  vi.mocked(mod.getCurrentUser).mockResolvedValue({
    id: "u1",
    name: "User",
    username: "user",
    role: "user",
    must_change_password: 0,
    deactivated: 0,
    created_at: 0,
    last_login: null,
    password: "x",
  });
}

describe("GET /api/file/[provider]/[...path]", () => {
  it("401s when not signed in", async () => {
    const { getCurrentUser } = await import("@/server/auth/current-user");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/notes.md"),
      await ctx("nas", ["notes.md"]),
    );
    expect(res.status).toBe(401);
  });

  it("404s on unknown provider", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/missing/notes.md"),
      await ctx("missing", ["notes.md"]),
    );
    expect(res.status).toBe(404);
  });

  it("404s on missing file", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/nope.md"),
      await ctx("nas", ["nope.md"]),
    );
    expect(res.status).toBe(404);
  });

  it("400s on a directory path", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/prints"),
      await ctx("nas", ["prints"]),
    );
    expect(res.status).toBe(400);
  });

  it("streams the file with the right content-type and bytes", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/prints/anchor.stl"),
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("model/stl");
    expect(res.headers.get("content-length")).toBe("8");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf).toEqual(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  });

  it("uses inline disposition when ?inline=1", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/notes.md?inline=1"),
      await ctx("nas", ["notes.md"]),
    );
    expect(res.headers.get("content-disposition")).toMatch(/^inline/);
  });

  it("uses attachment disposition by default", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/notes.md"),
      await ctx("nas", ["notes.md"]),
    );
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(res.headers.get("content-disposition")).toContain('filename="notes.md"');
  });

  it("returns 400 on path traversal", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/..%2Fetc%2Fpasswd"),
      await ctx("nas", ["..", "etc", "passwd"]),
    );
    expect(res.status).toBe(400);
  });
});
