import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import {
  createProvider,
  deleteProvider,
  findProviderBySlug,
  generateUniqueSlug,
  hasAnyProvider,
  listProviders,
  slugify,
  updateProviderPosition,
  type ProviderRow,
} from "@/server/db/providers";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-providers-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("providers repository", () => {
  it("hasAnyProvider false on empty DB", () => {
    expect(hasAnyProvider(db)).toBe(false);
  });

  it("createProvider inserts and findProviderBySlug retrieves (config decrypted)", () => {
    const row: ProviderRow = createProvider(db, {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/files" },
    });
    expect(row.slug).toBe("nas");
    expect(row.name).toBe("NAS");
    expect(row.type).toBe("local");
    expect(row.config).toEqual({ rootPath: "/files" });
    expect(row.position).toBe(0);

    const found = findProviderBySlug(db, "nas");
    expect(found?.config).toEqual({ rootPath: "/files" });
  });

  it("findProviderBySlug returns null for unknown slug", () => {
    expect(findProviderBySlug(db, "missing")).toBeNull();
  });

  it("config is stored encrypted (raw DB bytes do not contain plaintext)", () => {
    createProvider(db, {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: {
        rootPath: "/files",
        secretFlag: "plaintext-marker-xyz",
      } as unknown as { rootPath: string },
    });
    const raw = db
      .prepare("SELECT config FROM providers WHERE slug = ?")
      .get("nas") as { config: string };
    expect(raw.config).not.toContain("plaintext-marker-xyz");
    expect(raw.config).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("listProviders returns providers sorted by position", () => {
    createProvider(db, { slug: "a", name: "A", type: "local", config: { rootPath: "/a" } });
    createProvider(db, { slug: "b", name: "B", type: "local", config: { rootPath: "/b" } });
    createProvider(db, { slug: "c", name: "C", type: "local", config: { rootPath: "/c" } });
    updateProviderPosition(db, "b", 0);
    updateProviderPosition(db, "a", 1);
    updateProviderPosition(db, "c", 2);
    const list = listProviders(db);
    expect(list.map((p) => p.slug)).toEqual(["b", "a", "c"]);
  });

  it("hasAnyProvider returns true once one exists", () => {
    expect(hasAnyProvider(db)).toBe(false);
    createProvider(db, {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/files" },
    });
    expect(hasAnyProvider(db)).toBe(true);
  });

  it("deleteProvider removes it", () => {
    createProvider(db, {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/files" },
    });
    deleteProvider(db, "nas");
    expect(findProviderBySlug(db, "nas")).toBeNull();
    expect(hasAnyProvider(db)).toBe(false);
  });

  it("createProvider rejects duplicate slug", () => {
    createProvider(db, { slug: "a", name: "A", type: "local", config: { rootPath: "/a" } });
    expect(() =>
      createProvider(db, { slug: "a", name: "A2", type: "local", config: { rootPath: "/b" } }),
    ).toThrow();
  });
});

describe("slugify", () => {
  it("converts a name to lowercase hyphenated", () => {
    expect(slugify("NAS Files")).toBe("nas-files");
    expect(slugify("My 3D Prints!")).toBe("my-3d-prints");
  });

  it("collapses repeated non-alphanumerics into a single hyphen", () => {
    expect(slugify("a___b   c")).toBe("a-b-c");
  });

  it("drops leading and trailing hyphens", () => {
    expect(slugify("  hello  ")).toBe("hello");
    expect(slugify("!!!hi!!!")).toBe("hi");
  });

  it("strips diacritics", () => {
    expect(slugify("café")).toBe("cafe");
  });

  it("returns empty string for all-non-ASCII input", () => {
    expect(slugify("日本語")).toBe("");
  });

  it("truncates to 32 chars", () => {
    expect(slugify("a".repeat(50))).toHaveLength(32);
  });
});

describe("generateUniqueSlug", () => {
  it("returns the slugified name when there is no collision", () => {
    expect(generateUniqueSlug(db, "NAS Files")).toBe("nas-files");
  });

  it("suffixes -2, -3, ... when colliding with existing slugs", () => {
    createProvider(db, {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/a" },
    });
    expect(generateUniqueSlug(db, "nas")).toBe("nas-2");

    createProvider(db, {
      slug: "nas-2",
      name: "NAS2",
      type: "local",
      config: { rootPath: "/b" },
    });
    expect(generateUniqueSlug(db, "nas")).toBe("nas-3");
  });

  it("falls back to 'provider' when slugify yields empty", () => {
    expect(generateUniqueSlug(db, "日本語")).toBe("provider");
  });

  it("trims the base so suffixed slug stays within 32 chars", () => {
    const long = "a".repeat(40);
    createProvider(db, {
      slug: slugify(long),
      name: "long",
      type: "local",
      config: { rootPath: "/a" },
    });
    const next = generateUniqueSlug(db, long);
    expect(next.length).toBeLessThanOrEqual(32);
    expect(next.endsWith("-2")).toBe(true);
  });
});
