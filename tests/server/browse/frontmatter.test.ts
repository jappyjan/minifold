import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "@/server/browse/frontmatter";

describe("parseFrontmatter", () => {
  it("returns the body unchanged when there is no frontmatter", () => {
    const src = "# Hello\n\nworld\n";
    expect(parseFrontmatter(src)).toEqual({ tags: [], body: src });
  });

  it("extracts tags from a YAML list", () => {
    const src = "---\ntags:\n  - one\n  - two\n  - three\n---\n# Body\n";
    expect(parseFrontmatter(src)).toEqual({
      tags: ["one", "two", "three"],
      body: "# Body\n",
    });
  });

  it("extracts tags from a flow-style list", () => {
    const src = "---\ntags: [a, b, c]\n---\nBody";
    expect(parseFrontmatter(src)).toEqual({
      tags: ["a", "b", "c"],
      body: "Body",
    });
  });

  it("extracts tags from a comma-separated string", () => {
    const src = "---\ntags: foo, bar,baz \n---\nBody";
    expect(parseFrontmatter(src)).toEqual({
      tags: ["foo", "bar", "baz"],
      body: "Body",
    });
  });

  it("strips the frontmatter even when no tags are declared", () => {
    const src = "---\ntitle: hi\n---\nBody";
    expect(parseFrontmatter(src)).toEqual({ tags: [], body: "Body" });
  });

  it("ignores frontmatter not at the very start", () => {
    const src = "# Heading\n---\ntags: [a]\n---\n";
    expect(parseFrontmatter(src)).toEqual({ tags: [], body: src });
  });
});
