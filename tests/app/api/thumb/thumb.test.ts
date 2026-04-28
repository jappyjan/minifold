import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { NextRequest } from "next/server";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createProvider } from "@/server/db/providers";

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/server/thumb/client", () => ({
  ThumbnailServiceError: class ThumbnailServiceError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ThumbnailServiceError";
    }
  },
  fetchThumbnail: vi.fn(),
}));

let tmp: string;
let filesRoot: string;

const FAKE_WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
const FAKE_STL = Buffer.from([0x00, 0x01, 0x02, 0x03]);

async function ctx(provider: string, path: string[]) {
  return { params: Promise.resolve({ provider, path }) };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-thumb-route-"));
  filesRoot = join(tmp, "files");
  mkdirSync(filesRoot, { recursive: true });
  mkdirSync(join(filesRoot, "prints"));

  // Write a real STL file
  writeFileSync(join(filesRoot, "prints", "anchor.stl"), FAKE_STL);
  // Write a text file for the wrong-extension test
  writeFileSync(join(filesRoot, "notes.txt"), "hello");

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
  vi.stubEnv("MINIFOLD_THUMB_SERVICE_URL", "http://localhost:7070");
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

async function stubFetchThumbnailOk() {
  const mod = await import("@/server/thumb/client");
  vi.mocked(mod.fetchThumbnail).mockResolvedValue(FAKE_WEBP);
}

async function stubFetchThumbnailError() {
  const mod = await import("@/server/thumb/client");
  const { ThumbnailServiceError } = mod;
  vi.mocked(mod.fetchThumbnail).mockRejectedValue(
    new ThumbnailServiceError("render failed: 500"),
  );
}

describe("GET /api/thumb/[provider]/[...path]", () => {
  it("7. 404 when unauthenticated on a signed-in path (no info leak)", async () => {
    // Default global is 'signed-in' (seeded by migration 005). Anonymous → 404.
    const mod = await import("@/server/auth/current-user");
    vi.mocked(mod.getCurrentUser).mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/prints/anchor.stl") as unknown as NextRequest,
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(404);
  });

  it("1. 404 when thumbnail service env var is unset", async () => {
    await authedAsUser();
    vi.stubEnv("MINIFOLD_THUMB_SERVICE_URL", "");
    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/prints/anchor.stl") as unknown as NextRequest,
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(404);
  });

  it("5. 404 on unknown provider", async () => {
    await authedAsUser();
    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/ghost/prints/anchor.stl") as unknown as NextRequest,
      await ctx("ghost", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(404);
  });

  it("6. 400 on unsupported file extension", async () => {
    await authedAsUser();
    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/notes.txt") as unknown as NextRequest,
      await ctx("nas", ["notes.txt"]),
    );
    expect(res.status).toBe(400);
  });

  it("2. returns cached sidecar when it exists", async () => {
    await authedAsUser();

    // Pre-write a sidecar file so provider.exists returns true
    writeFileSync(
      join(filesRoot, "prints", ".minifold_thumb_anchor.stl.webp"),
      FAKE_WEBP,
    );

    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/prints/anchor.stl") as unknown as NextRequest,
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body).toEqual(FAKE_WEBP);
  });

  it("3. calls fetch, writes sidecar, returns bytes when sidecar missing", async () => {
    await authedAsUser();
    await stubFetchThumbnailOk();

    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/prints/anchor.stl") as unknown as NextRequest,
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body).toEqual(FAKE_WEBP);

    // Verify fetchThumbnail was called
    const clientMod = await import("@/server/thumb/client");
    expect(clientMod.fetchThumbnail).toHaveBeenCalledOnce();

    // Give the fire-and-forget write a tick to complete
    await new Promise((r) => setTimeout(r, 50));

    // Verify sidecar was written
    const { existsSync } = await import("node:fs");
    const sidecarPath = join(
      filesRoot,
      "prints",
      ".minifold_thumb_anchor.stl.webp",
    );
    expect(existsSync(sidecarPath)).toBe(true);
  });

  it("4. returns 502 when fetchThumbnail throws ThumbnailServiceError", async () => {
    await authedAsUser();
    await stubFetchThumbnailError();

    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/prints/anchor.stl") as unknown as NextRequest,
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(502);
  });

  it("8. 404 when an authed user is not on the user-list", async () => {
    writeFileSync(
      join(filesRoot, "prints", ".minifold_access.yaml"),
      "overrides:\n  anchor.stl: [bob]\n",
    );
    await authedAsUser(); // username 'user', not on list
    await stubFetchThumbnailOk(); // would succeed if we got past the resolver
    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/prints/anchor.stl") as unknown as NextRequest,
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(404);
  });

  it("9. admin gets the thumbnail even for an access-denied file", async () => {
    writeFileSync(
      join(filesRoot, "prints", ".minifold_access.yaml"),
      "overrides:\n  anchor.stl: [bob]\n",
    );
    const mod = await import("@/server/auth/current-user");
    vi.mocked(mod.getCurrentUser).mockResolvedValue({
      id: "u-ad",
      name: "Admin",
      username: "ad",
      role: "admin",
      must_change_password: 0,
      deactivated: 0,
      created_at: 0,
      last_login: null,
      password: "x",
    });
    await stubFetchThumbnailOk();
    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/prints/anchor.stl") as unknown as NextRequest,
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
  });

  it("10. anonymous gets thumbnail for a public file", async () => {
    writeFileSync(
      join(filesRoot, "prints", ".minifold_access.yaml"),
      "overrides:\n  anchor.stl: public\n",
    );
    const mod = await import("@/server/auth/current-user");
    vi.mocked(mod.getCurrentUser).mockResolvedValue(null);
    await stubFetchThumbnailOk();
    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/prints/anchor.stl") as unknown as NextRequest,
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(200);
  });
});
