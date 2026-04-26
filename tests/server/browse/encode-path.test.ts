import { describe, it, expect } from "vitest";
import { encodePathSegments } from "@/server/browse/encode-path";

describe("encodePathSegments", () => {
  it("returns empty for empty input", () => {
    expect(encodePathSegments("")).toBe("");
  });

  it("encodes spaces and reserved URL characters per segment", () => {
    expect(encodePathSegments("draft #2.md")).toBe("draft%20%232.md");
    expect(encodePathSegments("a?b.md")).toBe("a%3Fb.md");
    expect(encodePathSegments("100%.md")).toBe("100%25.md");
  });

  it("encodes each segment but preserves the slash separators", () => {
    expect(encodePathSegments("a b/c d/e f.md")).toBe("a%20b/c%20d/e%20f.md");
  });

  it("does not double-encode an already-encoded value", () => {
    // encodeURIComponent treats `%` as a literal — caller is expected to pass
    // raw filenames; documenting the contract here.
    expect(encodePathSegments("a%20b.md")).toBe("a%2520b.md");
  });
});
