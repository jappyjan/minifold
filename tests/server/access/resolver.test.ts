import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageProvider } from "@/server/storage/local";
import { createAccessResolver } from "@/server/access/resolver";
import type { UserRow } from "@/server/db/users";

let tmp: string;
let storage: LocalStorageProvider;

const userAlice: UserRow = {
  id: "u-a",
  name: "Alice",
  username: "alice",
  password: "x",
  role: "user",
  must_change_password: 0,
  deactivated: 0,
  created_at: 0,
  last_login: null,
};

const userBob: UserRow = { ...userAlice, id: "u-b", username: "bob" };

const admin: UserRow = { ...userAlice, id: "u-ad", username: "ad", role: "admin" };

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-resolver-"));
  storage = new LocalStorageProvider({ slug: "nas", rootPath: tmp });
  mkdirSync(join(tmp, "a"));
  mkdirSync(join(tmp, "a", "b"));
  writeFileSync(join(tmp, "a", "b", "c.stl"), Buffer.from([0]));
  writeFileSync(join(tmp, "a", "b", "extra.stl"), Buffer.from([0]));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("createAccessResolver", () => {
  it("admins always resolve to allow", async () => {
    const r = createAccessResolver({
      user: admin,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
    expect(await r.resolve("a/b", "directory")).toBe("allow");
  });

  it("falls through to global default when no access files exist", async () => {
    const rPub = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "public",
    });
    expect(await rPub.resolve("a/b/c.stl", "file")).toBe("allow");

    const rSigned = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rSigned.resolve("a/b/c.stl", "file")).toBe("deny-anonymous");

    const rSignedOk = createAccessResolver({
      user: userAlice,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rSignedOk.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("provider default overrides global default", async () => {
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: "public",
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("a `default` in the file's parent directory takes priority over provider default", async () => {
    writeFileSync(join(tmp, "a", "b", ".minifold_access.yaml"), "default: signed-in\n");
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: "public",
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("deny-anonymous");
  });

  it("an `overrides[basename]` for a file beats `default` in the same dir", async () => {
    writeFileSync(
      join(tmp, "a", "b", ".minifold_access.yaml"),
      "default: signed-in\noverrides:\n  c.stl: public\n",
    );
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
    // sibling file unaffected
    expect(await r.resolve("a/b/extra.stl", "file")).toBe("deny-anonymous");
  });

  it("walks up to parent directory's `default` when current dir's access file has neither overrides[name] nor default", async () => {
    writeFileSync(join(tmp, "a", ".minifold_access.yaml"), "default: public\n");
    writeFileSync(join(tmp, "a", "b", ".minifold_access.yaml"), "overrides: {}\n");
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("walks all the way to provider root", async () => {
    writeFileSync(join(tmp, ".minifold_access.yaml"), "default: public\n");
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("user-list allows listed user, denies non-listed authed user, redirects anonymous", async () => {
    writeFileSync(
      join(tmp, "a", "b", ".minifold_access.yaml"),
      "default: [alice]\n",
    );
    const rAlice = createAccessResolver({
      user: userAlice,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rAlice.resolve("a/b/c.stl", "file")).toBe("allow");

    const rBob = createAccessResolver({
      user: userBob,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rBob.resolve("a/b/c.stl", "file")).toBe("deny-authed");

    const rAnon = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rAnon.resolve("a/b/c.stl", "file")).toBe("deny-anonymous");
  });

  it("user-list comparison is case-insensitive", async () => {
    writeFileSync(
      join(tmp, "a", "b", ".minifold_access.yaml"),
      "default: [Alice]\n",
    );
    const r = createAccessResolver({
      user: userAlice, // username 'alice'
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("empty user-list denies everyone except admins", async () => {
    writeFileSync(join(tmp, "a", "b", ".minifold_access.yaml"), "default: []\n");
    const rUser = createAccessResolver({
      user: userAlice,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rUser.resolve("a/b/c.stl", "file")).toBe("deny-authed");

    const rAdmin = createAccessResolver({
      user: admin,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rAdmin.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("directories never consult overrides — only `default` of their own access file", async () => {
    writeFileSync(
      join(tmp, "a", ".minifold_access.yaml"),
      "default: signed-in\noverrides:\n  b: public\n", // 'b' override is ignored for dir-kind lookups
    );
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    // The directory 'a/b' has no own access file, so we walk up to 'a' and use its `default: signed-in`.
    // The `overrides: { b: public }` in 'a' must NOT apply to directory 'b'.
    expect(await r.resolve("a/b", "directory")).toBe("deny-anonymous");
  });

  it("a directory's own `default` is used before walking up", async () => {
    writeFileSync(
      join(tmp, "a", "b", ".minifold_access.yaml"),
      "default: public\n",
    );
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b", "directory")).toBe("allow");
  });

  it("malformed access file at one level is skipped — walk-up continues", async () => {
    writeFileSync(join(tmp, "a", ".minifold_access.yaml"), "default: public\n");
    writeFileSync(
      join(tmp, "a", "b", ".minifold_access.yaml"),
      ":not-yaml::\n", // malformed
    );
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("memoizes file reads — listing N files in the same dir reads the access file once", async () => {
    writeFileSync(
      join(tmp, "a", "b", ".minifold_access.yaml"),
      "default: public\n",
    );
    let reads = 0;
    const wrapped = new Proxy(storage, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop === "read") {
          return async (p: string) => {
            reads++;
            return v.call(target, p);
          };
        }
        return v;
      },
    });
    const r = createAccessResolver({
      user: null,
      storage: wrapped as typeof storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    await r.resolve("a/b/c.stl", "file");
    await r.resolve("a/b/extra.stl", "file");
    expect(reads).toBe(1);
  });

  it("memoizes negative results — missing access file is checked once even across many resolves", async () => {
    // No .minifold_access.yaml anywhere — all resolves fall through to globalDefault.
    let existsCalls = 0;
    const wrapped = new Proxy(storage, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop === "exists") {
          return async (p: string) => {
            existsCalls++;
            return v.call(target, p);
          };
        }
        return v;
      },
    });
    const r = createAccessResolver({
      user: userAlice,
      storage: wrapped as typeof storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    // Two file resolves in same dir → one exists() per directory level walked.
    // Path 'a/b/c.stl' walks dirs ['a/b', 'a', '']  → 3 exists() calls.
    // Then 'a/b/extra.stl' should hit cache for all three → 0 more exists() calls.
    await r.resolve("a/b/c.stl", "file");
    const after1 = existsCalls;
    await r.resolve("a/b/extra.stl", "file");
    expect(existsCalls).toBe(after1);
  });
});
