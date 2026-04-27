import { describe, it, expect } from "vitest";
import { thumbSidecarPath } from "@/server/thumb/sidecar-name";

describe("thumbSidecarPath", () => {
  it("places the sidecar next to the source with .minifold_thumb_ prefix and .webp suffix", () => {
    expect(thumbSidecarPath("prints/anchor.stl")).toBe("prints/.minifold_thumb_anchor.stl.webp");
  });

  it("works at the root", () => {
    expect(thumbSidecarPath("anchor.stl")).toBe(".minifold_thumb_anchor.stl.webp");
  });

  it("preserves nested paths", () => {
    expect(thumbSidecarPath("a/b/c/model.3mf")).toBe("a/b/c/.minifold_thumb_model.3mf.webp");
  });
});
