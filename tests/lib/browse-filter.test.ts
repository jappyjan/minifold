import { describe, it, expect, beforeEach } from "vitest";
import {
  CATEGORIES,
  DEFAULT_VISIBLE,
  STORAGE_KEY,
  categoryOfKind,
  parseShowParam,
  readPersistedVisible,
  writePersistedVisible,
} from "@/lib/browse-filter";
import type { FileKind } from "@/server/browse/file-kind";

beforeEach(() => {
  localStorage.clear();
});

describe("categoryOfKind", () => {
  it("maps 3D formats to '3d'", () => {
    const kinds: FileKind[] = ["stl", "3mf", "step", "obj", "gcode", "bgcode", "f3d"];
    for (const kind of kinds) {
      expect(categoryOfKind(kind), `kind: ${kind}`).toBe("3d");
    }
  });

  it("maps document formats to 'doc'", () => {
    const kinds: FileKind[] = ["md", "pdf"];
    for (const kind of kinds) {
      expect(categoryOfKind(kind), `kind: ${kind}`).toBe("doc");
    }
  });

  it("maps image to 'image'", () => {
    expect(categoryOfKind("image")).toBe("image");
  });

  it("maps other to 'other'", () => {
    expect(categoryOfKind("other")).toBe("other");
  });
});

describe("DEFAULT_VISIBLE", () => {
  it("defaults to 3d, doc, image", () => {
    expect([...DEFAULT_VISIBLE].sort()).toEqual(["3d", "doc", "image"].sort());
  });

  it("does not include 'other'", () => {
    expect(DEFAULT_VISIBLE).not.toContain("other");
  });
});

describe("parseShowParam", () => {
  it("returns null for null/undefined/empty", () => {
    expect(parseShowParam(null)).toBeNull();
    expect(parseShowParam(undefined)).toBeNull();
    expect(parseShowParam("")).toBeNull();
    expect(parseShowParam("   ")).toBeNull();
  });

  it("returns all categories for 'all'", () => {
    expect(parseShowParam("all")).toEqual([...CATEGORIES]);
  });

  it("returns all categories for 'ALL' (case insensitive)", () => {
    expect(parseShowParam("ALL")).toEqual([...CATEGORIES]);
  });

  it("parses comma-separated categories", () => {
    const result = parseShowParam("3d,doc");
    expect(result).toContain("3d");
    expect(result).toContain("doc");
    expect(result).toHaveLength(2);
  });

  it("normalises case and whitespace", () => {
    const result = parseShowParam("3D, OTHER");
    expect(result).toContain("3d");
    expect(result).toContain("other");
    expect(result).toHaveLength(2);
  });

  it("ignores unknown tokens, keeps valid ones", () => {
    const result = parseShowParam("3d,unknown,doc");
    expect(result).toContain("3d");
    expect(result).toContain("doc");
    expect(result).not.toContain("unknown");
    expect(result).toHaveLength(2);
  });

  it("returns null if all tokens are invalid", () => {
    expect(parseShowParam("foo,bar")).toBeNull();
  });

  it("handles all four categories", () => {
    const result = parseShowParam("3d,doc,image,other");
    expect(result).toHaveLength(4);
    expect(result).toContain("3d");
    expect(result).toContain("doc");
    expect(result).toContain("image");
    expect(result).toContain("other");
  });
});

describe("readPersistedVisible / writePersistedVisible", () => {
  it("returns null when nothing is stored", () => {
    expect(readPersistedVisible()).toBeNull();
  });

  it("round-trips a valid set", () => {
    writePersistedVisible(["3d", "doc"]);
    const result = readPersistedVisible();
    expect(result).not.toBeNull();
    expect(result).toContain("3d");
    expect(result).toContain("doc");
    expect(result).toHaveLength(2);
  });

  it("round-trips an empty array", () => {
    writePersistedVisible([]);
    const result = readPersistedVisible();
    expect(result).toEqual([]);
  });

  it("filters out invalid category values from localStorage", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ visible: ["3d", "bogus", "doc"] }),
    );
    const result = readPersistedVisible();
    expect(result).toContain("3d");
    expect(result).toContain("doc");
    expect(result).not.toContain("bogus");
    expect(result).toHaveLength(2);
  });

  it("returns null for malformed JSON in localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    expect(readPersistedVisible()).toBeNull();
  });

  it("returns null for valid JSON but wrong shape", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ wrong: "shape" }));
    expect(readPersistedVisible()).toBeNull();
  });

  it("uses the correct storage key", () => {
    writePersistedVisible(["image"]);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});
