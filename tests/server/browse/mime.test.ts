import { describe, it, expect } from "vitest";
import { mimeFor } from "@/server/browse/mime";

describe("mimeFor", () => {
  it("returns the right type for known extensions", () => {
    expect(mimeFor("anchor.stl")).toBe("model/stl");
    expect(mimeFor("benchy.3mf")).toBe("model/3mf");
    expect(mimeFor("doc.pdf")).toBe("application/pdf");
    expect(mimeFor("note.md")).toBe("text/markdown; charset=utf-8");
    expect(mimeFor("note.markdown")).toBe("text/markdown; charset=utf-8");
    expect(mimeFor("page.html")).toBe("text/html; charset=utf-8");
    expect(mimeFor("photo.jpg")).toBe("image/jpeg");
    expect(mimeFor("photo.jpeg")).toBe("image/jpeg");
    expect(mimeFor("photo.png")).toBe("image/png");
    expect(mimeFor("photo.webp")).toBe("image/webp");
    expect(mimeFor("photo.gif")).toBe("image/gif");
    expect(mimeFor("data.json")).toBe("application/json");
    expect(mimeFor("data.txt")).toBe("text/plain; charset=utf-8");
  });

  it("falls back to application/octet-stream", () => {
    expect(mimeFor("data.bin")).toBe("application/octet-stream");
    expect(mimeFor("noext")).toBe("application/octet-stream");
  });

  it("is case-insensitive on extension", () => {
    expect(mimeFor("DOC.PDF")).toBe("application/pdf");
  });
});
