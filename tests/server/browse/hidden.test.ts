import { describe, it, expect } from "vitest";
import { isHiddenEntry } from "@/server/browse/hidden";

describe("isHiddenEntry", () => {
  it("hides the .minifold_access.json control file", () => {
    expect(isHiddenEntry(".minifold_access.json")).toBe(true);
  });

  it("hides any .minifold_* dotfile", () => {
    expect(isHiddenEntry(".minifold_thumb_anchor.stl.webp")).toBe(true);
    expect(isHiddenEntry(".minifold_anything")).toBe(true);
  });

  it("does NOT hide regular dotfiles", () => {
    expect(isHiddenEntry(".gitkeep")).toBe(false);
    expect(isHiddenEntry(".env")).toBe(false);
  });

  it("does NOT hide normal files", () => {
    expect(isHiddenEntry("anchor.stl")).toBe(false);
    expect(isHiddenEntry("README.md")).toBe(false);
  });
});
