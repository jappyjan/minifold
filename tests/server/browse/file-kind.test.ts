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

  it("recognises additional 3D formats", () => {
    expect(fileKindOf("part.step")).toBe("step");
    expect(fileKindOf("part.stp")).toBe("step");
    expect(fileKindOf("mesh.obj")).toBe("obj");
    expect(fileKindOf("print.gcode")).toBe("gcode");
    expect(fileKindOf("print.bgcode")).toBe("bgcode");
    expect(fileKindOf("design.f3d")).toBe("f3d");
  });

  it("recognises images", () => {
    expect(fileKindOf("photo.jpg")).toBe("image");
    expect(fileKindOf("photo.jpeg")).toBe("image");
    expect(fileKindOf("photo.png")).toBe("image");
    expect(fileKindOf("photo.webp")).toBe("image");
    expect(fileKindOf("photo.gif")).toBe("image");
  });

  it("recognises SVG as image", () => {
    expect(fileKindOf("logo.svg")).toBe("image");
  });

  it("falls back to other for unknown extensions", () => {
    expect(fileKindOf("data.bin")).toBe("other");
    expect(fileKindOf("noext")).toBe("other");
  });
});
