import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetDatabase, getDatabase } from "@/server/db";
import { createProvider } from "@/server/db/providers";
import { setSetting } from "@/server/db/settings";
import { createUser, type UserRow } from "@/server/db/users";
import { buildResolverForRequest } from "@/server/access/build-resolver";

let tmp: string;
let storageRoot: string;
let user: UserRow;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-build-resolver-"));
  storageRoot = join(tmp, "files");
  mkdirSync(storageRoot, { recursive: true });

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

describe("buildResolverForRequest", () => {
  it("returns null for an unknown provider", () => {
    expect(
      buildResolverForRequest({ user, providerSlug: "missing" }),
    ).toBeNull();
  });

  it("returns a resolver bound to the right user + globals + providerDefault", async () => {
    // Provider has no defaultAccess, global is the seeded 'signed-in'.
    const r1 = buildResolverForRequest({ user: null, providerSlug: "nas" });
    expect(await r1!.resolve("anything.stl", "file")).toBe("deny-anonymous");
    const r2 = buildResolverForRequest({ user, providerSlug: "nas" });
    expect(await r2!.resolve("anything.stl", "file")).toBe("allow");

    // Flip global default to public.
    setSetting(getDatabase(), "global_default_access", "public");
    const r3 = buildResolverForRequest({ user: null, providerSlug: "nas" });
    expect(await r3!.resolve("anything.stl", "file")).toBe("allow");
  });

  it("uses the provider's defaultAccess when configured", async () => {
    // Add a second provider with defaultAccess=public, with global stuck at signed-in.
    const db = getDatabase();
    const otherRoot = join(tmp, "other");
    mkdirSync(otherRoot, { recursive: true });
    createProvider(db, {
      slug: "pub",
      name: "Public",
      type: "local",
      config: { rootPath: otherRoot, defaultAccess: "public" },
    });
    const r = buildResolverForRequest({ user: null, providerSlug: "pub" });
    writeFileSync(join(otherRoot, "x.md"), "x");
    expect(await r!.resolve("x.md", "file")).toBe("allow");
  });
});
