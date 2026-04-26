import { describe, it, expect } from "vitest";
import {
  MAX_PREVIEW_BYTES,
  isTooLargeForPreview,
  loaderKindFor,
} from "@/server/browse/model-preview";

describe("MAX_PREVIEW_BYTES", () => {
  it("is 200 MB", () => {
    expect(MAX_PREVIEW_BYTES).toBe(200 * 1024 * 1024);
  });
});

describe("isTooLargeForPreview", () => {
  it("returns false for sizes at or below the cap", () => {
    expect(isTooLargeForPreview(0)).toBe(false);
    expect(isTooLargeForPreview(1024)).toBe(false);
    expect(isTooLargeForPreview(MAX_PREVIEW_BYTES)).toBe(false);
  });

  it("returns true for sizes above the cap", () => {
    expect(isTooLargeForPreview(MAX_PREVIEW_BYTES + 1)).toBe(true);
    expect(isTooLargeForPreview(1024 * 1024 * 1024)).toBe(true);
  });

  it("returns false for non-finite or negative sizes (assume unknown → allow)", () => {
    // Defensive: a bogus size shouldn't block preview attempts.
    expect(isTooLargeForPreview(NaN)).toBe(false);
    expect(isTooLargeForPreview(-1)).toBe(false);
  });
});

describe("loaderKindFor", () => {
  it("recognises stl/3mf case-insensitively", () => {
    expect(loaderKindFor("anchor.stl")).toBe("stl");
    expect(loaderKindFor("ANCHOR.STL")).toBe("stl");
    expect(loaderKindFor("benchy.3mf")).toBe("3mf");
    expect(loaderKindFor("Benchy.3MF")).toBe("3mf");
  });

  it("returns null for non-3D extensions", () => {
    expect(loaderKindFor("notes.md")).toBeNull();
    expect(loaderKindFor("photo.jpg")).toBeNull();
    expect(loaderKindFor("data.bin")).toBeNull();
    expect(loaderKindFor("noext")).toBeNull();
  });
});
