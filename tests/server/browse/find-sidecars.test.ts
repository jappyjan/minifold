import { describe, it, expect } from "vitest";
import { findSidecarMarkdowns } from "@/server/browse/find-sidecars";
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

describe("findSidecarMarkdowns", () => {
  it("flags an .md whose basename matches a non-md sibling", () => {
    const sidecars = findSidecarMarkdowns([file("anchor.stl"), file("anchor.md")]);
    expect(sidecars).toEqual(new Set(["anchor.md"]));
  });

  it("does not flag a standalone .md with no sibling", () => {
    expect(findSidecarMarkdowns([file("notes.md"), file("a.stl")])).toEqual(
      new Set(),
    );
  });

  it("flags .markdown the same way as .md", () => {
    const sidecars = findSidecarMarkdowns([
      file("anchor.stl"),
      file("anchor.markdown"),
    ]);
    expect(sidecars).toEqual(new Set(["anchor.markdown"]));
  });

  it("ignores siblings that are also markdown", () => {
    expect(
      findSidecarMarkdowns([file("anchor.md"), file("anchor.markdown")]),
    ).toEqual(new Set());
  });

  it("is case-insensitive on the basename", () => {
    const sidecars = findSidecarMarkdowns([file("Anchor.STL"), file("anchor.MD")]);
    expect(sidecars).toEqual(new Set(["anchor.MD"]));
  });

  it("flags the .md when several non-md siblings share the basename", () => {
    const sidecars = findSidecarMarkdowns([
      file("anchor.stl"),
      file("anchor.3mf"),
      file("anchor.md"),
    ]);
    expect(sidecars).toEqual(new Set(["anchor.md"]));
  });

  it("ignores directories", () => {
    expect(findSidecarMarkdowns([dir("anchor"), file("anchor.md")])).toEqual(
      new Set(),
    );
  });

  it("ignores files without an extension", () => {
    expect(findSidecarMarkdowns([file("Makefile"), file("Makefile.md")])).toEqual(
      new Set(),
    );
  });
});
