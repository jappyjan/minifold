import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRouter } from "@/server/trpc/router";
import { __resetDatabase, getDatabase } from "@/server/db";
import { createProvider } from "@/server/db/providers";
import { createUser, type UserRow } from "@/server/db/users";
import { getDirCache } from "@/server/db/dir-cache";
import { __clearListCache } from "@/server/browse/list-cache";

let tmp: string;
let storageRoot: string;
let user: UserRow;

beforeEach(() => {
  __clearListCache();
  tmp = mkdtempSync(join(tmpdir(), "minifold-browse-trpc-"));
  storageRoot = join(tmp, "files");
  mkdirSync(storageRoot, { recursive: true });
  writeFileSync(join(storageRoot, "a.stl"), Buffer.from([0]));
  writeFileSync(join(storageRoot, "b.stl"), Buffer.from([0, 0]));

  process.env.DATABASE_PATH = join(tmp, "test.db");
  __resetDatabase();
  const db = getDatabase();
  user = createUser(db, {
    name: "Alice",
    username: "alice",
    passwordHash: "x",
    role: "user",
    mustChangePassword: false,
  });
  createProvider(db, {
    slug: "nas",
    name: "NAS",
    type: "local",
    config: { rootPath: storageRoot },
  });
});

afterEach(() => {
  __resetDatabase();
  delete process.env.DATABASE_PATH;
  rmSync(tmp, { recursive: true, force: true });
});

describe("browse.list", () => {
  it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller({ currentUser: null });
    await expect(
      caller.browse.list({ providerSlug: "nas", path: "" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns entries + hash on first call (no knownHash)", async () => {
    const caller = appRouter.createCaller({ currentUser: user });
    const result = await caller.browse.list({ providerSlug: "nas", path: "" });
    expect(result.changed).toBe(true);
    if (!result.changed) throw new Error("type narrowing");
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.entries.map((e) => e.name)).toEqual(["a.stl", "b.stl"]);
  });

  it("returns changed:false when knownHash matches", async () => {
    const caller = appRouter.createCaller({ currentUser: user });
    const first = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!first.changed) throw new Error("expected changed:true");
    const second = await caller.browse.list({
      providerSlug: "nas",
      path: "",
      knownHash: first.hash,
    });
    expect(second).toEqual({ changed: false, hash: first.hash });
  });

  it("returns changed:true when knownHash is stale", async () => {
    const caller = appRouter.createCaller({ currentUser: user });
    const first = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!first.changed) throw new Error("expected changed:true");
    const result = await caller.browse.list({
      providerSlug: "nas",
      path: "",
      knownHash: "deadbeef".repeat(8),
    });
    expect(result.changed).toBe(true);
    if (!result.changed) throw new Error("type narrowing");
    expect(result.hash).toBe(first.hash);
    expect(result.entries.map((e) => e.name)).toEqual(["a.stl", "b.stl"]);
  });

  it("filters out hidden .minifold_* entries from returned list (but they affect the hash)", async () => {
    writeFileSync(join(storageRoot, ".minifold_access.json"), "{}");
    const caller = appRouter.createCaller({ currentUser: user });
    const result = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!result.changed) throw new Error("expected changed:true");
    expect(result.entries.map((e) => e.name)).toEqual(["a.stl", "b.stl"]);
  });

  it("returns NOT_FOUND for an unknown provider slug", async () => {
    const caller = appRouter.createCaller({ currentUser: user });
    await expect(
      caller.browse.list({ providerSlug: "missing", path: "" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("upserts dir_cache row for the listed path", async () => {
    const caller = appRouter.createCaller({ currentUser: user });
    const result = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!result.changed) throw new Error("expected changed:true");
    const row = getDirCache(getDatabase(), "nas/");
    expect(row?.hash).toBe(result.hash);
  });
});
