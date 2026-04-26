import { describe, it, expect } from "vitest";
import { sortEntries } from "@/server/browse/sort";
import type { Entry } from "@/server/storage/types";

const e = (
  name: string,
  type: Entry["type"] = "file",
  modifiedAt = new Date(0),
): Entry => ({ name, type, size: 0, modifiedAt });

describe("sortEntries", () => {
  it("places directories before files", () => {
    const sorted = sortEntries([e("a.stl"), e("zfolder", "directory"), e("b.md")]);
    expect(sorted.map((x) => x.name)).toEqual(["zfolder", "a.stl", "b.md"]);
  });

  it("sorts both directories and files alphabetically (case-insensitive)", () => {
    const sorted = sortEntries([
      e("Beta.md"),
      e("alpha.md"),
      e("Z", "directory"),
      e("a", "directory"),
    ]);
    expect(sorted.map((x) => x.name)).toEqual(["a", "Z", "alpha.md", "Beta.md"]);
  });

  it("does not mutate the input array", () => {
    const input = [e("b"), e("a")];
    const out = sortEntries(input);
    expect(input.map((x) => x.name)).toEqual(["b", "a"]);
    expect(out.map((x) => x.name)).toEqual(["a", "b"]);
  });
});
