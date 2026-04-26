import { describe, it, expect } from "vitest";
import { findFolderDescription, findFileDescription } from "@/server/browse/description-file";
import type { Entry } from "@/server/storage/types";

const file = (name: string): Entry => ({
  name,
  type: "file",
  size: 0,
  modifiedAt: new Date(0),
});
const dir = (name: string): Entry => ({
  name,
  type: "directory",
  size: 0,
  modifiedAt: new Date(0),
});

describe("findFolderDescription", () => {
  it("prefers index.md over the others", () => {
    expect(
      findFolderDescription([file("readme.md"), file("index.md"), file("anchor.stl")])
        ?.name,
    ).toBe("index.md");
  });

  it("falls back through readme.md → model.md → collection.md", () => {
    expect(findFolderDescription([file("readme.md"), file("a.stl")])?.name).toBe(
      "readme.md",
    );
    expect(findFolderDescription([file("model.md")])?.name).toBe("model.md");
    expect(findFolderDescription([file("collection.md")])?.name).toBe(
      "collection.md",
    );
  });

  it("is case-insensitive", () => {
    expect(findFolderDescription([file("README.md")])?.name).toBe("README.md");
    expect(findFolderDescription([file("Index.MD")])?.name).toBe("Index.MD");
  });

  it("ignores directories with matching names", () => {
    expect(findFolderDescription([dir("readme.md")])).toBeNull();
  });

  it("returns null when no description file is present", () => {
    expect(findFolderDescription([file("a.stl"), file("notes.txt")])).toBeNull();
  });
});

describe("findFileDescription", () => {
  it("finds anchor.md alongside anchor.stl", () => {
    const siblings = [file("anchor.stl"), file("anchor.md"), file("other.stl")];
    expect(findFileDescription(siblings, "anchor.stl")?.name).toBe("anchor.md");
  });

  it("is case-insensitive on the basename", () => {
    const siblings = [file("Anchor.STL"), file("anchor.MD")];
    expect(findFileDescription(siblings, "Anchor.STL")?.name).toBe("anchor.MD");
  });

  it("returns null if no sibling .md exists", () => {
    expect(
      findFileDescription([file("anchor.stl")], "anchor.stl"),
    ).toBeNull();
  });

  it("does not match the file itself when it is already a .md", () => {
    expect(findFileDescription([file("notes.md")], "notes.md")).toBeNull();
  });
});
