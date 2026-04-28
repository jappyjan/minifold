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
  it("does not throw UNAUTHORIZED for anonymous callers — directory access decides", async () => {
    // With access enforcement, browse.list is public. Whether the call succeeds
    // depends on whether the caller can see the directory itself.
    // Default global is 'signed-in' (seeded by migration 005), so anonymous on the
    // root directory resolves to deny-anonymous → NOT_FOUND (no UNAUTHORIZED).
    const caller = appRouter.createCaller({ currentUser: null });
    await expect(
      caller.browse.list({ providerSlug: "nas", path: "" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
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
    writeFileSync(join(storageRoot, ".minifold_access.yaml"), "default: signed-in\n");
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

  it("filters out files the resolver denies for the current user", async () => {
    // Make the dir public, but mark a.stl as user-list [bob] — alice can't see a.stl.
    writeFileSync(
      join(storageRoot, ".minifold_access.yaml"),
      "default: public\noverrides:\n  a.stl: [bob]\n",
    );
    const caller = appRouter.createCaller({ currentUser: user }); // alice
    const result = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!result.changed) throw new Error("expected changed:true");
    expect(result.entries.map((e) => e.name)).toEqual(["b.stl"]);
  });

  it("anonymous caller sees only public entries when the directory itself is public", async () => {
    // Directory default public (so anonymous can list); per-file overrides gate b.stl.
    writeFileSync(
      join(storageRoot, ".minifold_access.yaml"),
      "default: public\noverrides:\n  b.stl: signed-in\n",
    );
    const caller = appRouter.createCaller({ currentUser: null });
    const result = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!result.changed) throw new Error("expected changed:true");
    expect(result.entries.map((e) => e.name)).toEqual(["a.stl"]);
  });

  it("admin sees everything, including entries denied to regular users", async () => {
    writeFileSync(
      join(storageRoot, ".minifold_access.yaml"),
      "default: [bob]\n",
    );
    const db = getDatabase();
    const admin = createUser(db, {
      name: "Root",
      username: "root",
      passwordHash: "x",
      role: "admin",
      mustChangePassword: false,
    });
    const caller = appRouter.createCaller({ currentUser: admin });
    const result = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!result.changed) throw new Error("expected changed:true");
    expect(result.entries.map((e) => e.name)).toEqual(["a.stl", "b.stl"]);
  });

  it("returns NOT_FOUND when the directory itself is denied to the user", async () => {
    // Create a subdirectory that's user-list only.
    mkdirSync(join(storageRoot, "secret"));
    writeFileSync(join(storageRoot, "secret", "x.stl"), Buffer.from([0]));
    writeFileSync(
      join(storageRoot, "secret", ".minifold_access.yaml"),
      "default: [bob]\n",
    );
    const caller = appRouter.createCaller({ currentUser: user }); // alice
    await expect(
      caller.browse.list({ providerSlug: "nas", path: "secret" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
