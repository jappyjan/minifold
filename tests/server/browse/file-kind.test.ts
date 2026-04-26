import { describe, it, expect } from "vitest";
import { fileKindOf } from "@/server/browse/file-kind";

describe("fileKindOf", () => {
  it("recognises markdown", () => {
    expect(fileKindOf("README.md")).toBe("md");
    expect(fileKindOf("notes.markdown")).toBe("md");
    expect(fileKindOf("UPPER.MD")).toBe("md");
  });

  it("recognises PDFs", () => {
    expect(fileKindOf("manual.pdf")).toBe("pdf");
    expect(fileKindOf("manual.PDF")).toBe("pdf");
  });

  it("recognises 3D files", () => {
    expect(fileKindOf("anchor.stl")).toBe("stl");
    expect(fileKindOf("benchy.3mf")).toBe("3mf");
  });

  it("recognises images", () => {
    expect(fileKindOf("photo.jpg")).toBe("image");
    expect(fileKindOf("photo.jpeg")).toBe("image");
    expect(fileKindOf("photo.png")).toBe("image");
    expect(fileKindOf("photo.webp")).toBe("image");
    expect(fileKindOf("photo.gif")).toBe("image");
  });

  it("falls back to other for unknown extensions", () => {
    expect(fileKindOf("data.bin")).toBe("other");
    expect(fileKindOf("noext")).toBe("other");
  });
});
