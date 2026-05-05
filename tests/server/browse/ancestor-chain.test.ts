import { describe, it, expect } from "vitest";
import { columnAncestorChain } from "@/server/browse/ancestor-chain";

describe("columnAncestorChain", () => {
  it("returns one root column for empty segments", () => {
    expect(columnAncestorChain([], "directory")).toEqual([""]);
  });

  it("returns root + dir for single-segment directory leaf", () => {
    expect(columnAncestorChain(["foo"], "directory")).toEqual(["", "foo"]);
  });

  it("returns each ancestor for a deep directory leaf", () => {
    expect(columnAncestorChain(["foo", "bar", "baz"], "directory")).toEqual([
      "",
      "foo",
      "foo/bar",
      "foo/bar/baz",
    ]);
  });

  it("uses parent dir as deepest column for a file leaf", () => {
    expect(columnAncestorChain(["foo", "bar.stl"], "file")).toEqual(["", "foo"]);
  });

  it("returns only root column for a file at provider root", () => {
    expect(columnAncestorChain(["baz.stl"], "file")).toEqual([""]);
  });

  it("returns each ancestor up to the file's parent", () => {
    expect(columnAncestorChain(["a", "b", "c", "x.pdf"], "file")).toEqual([
      "",
      "a",
      "a/b",
      "a/b/c",
    ]);
  });
});
