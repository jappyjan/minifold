import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeLogo,
  clearLogo,
  resolveLogoPath,
  sniffImageType,
} from "@/server/settings/logo-storage";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-logo-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function webpBuffer(): Buffer {
  // RIFF....WEBP
  const buf = Buffer.alloc(16);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(8, 4);
  buf.write("WEBP", 8, "ascii");
  return buf;
}

describe("sniffImageType", () => {
  it("recognises PNG magic", () => {
    expect(sniffImageType(PNG_MAGIC)).toBe("png");
  });

  it("recognises WebP magic", () => {
    expect(sniffImageType(webpBuffer())).toBe("webp");
  });

  it("recognises SVG (whitespace-tolerant)", () => {
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?><svg></svg>'))).toBe("svg");
    expect(sniffImageType(Buffer.from('   <svg width="1"></svg>'))).toBe("svg");
    expect(sniffImageType(Buffer.from('<SVG></SVG>'))).toBe("svg");
  });

  it("returns null for unrecognised content (e.g. text)", () => {
    expect(sniffImageType(Buffer.from("hello world"))).toBeNull();
  });
});

describe("writeLogo", () => {
  it("writes the file to /<dir>/logo.<ext> based on the sniffed type", async () => {
    await writeLogo(tmp, PNG_MAGIC);
    expect(existsSync(join(tmp, "logo.png"))).toBe(true);
  });

  it("returns the extension that was sniffed", async () => {
    const result = await writeLogo(tmp, webpBuffer());
    expect(result).toBe("webp");
  });

  it("rejects unrecognised content", async () => {
    await expect(writeLogo(tmp, Buffer.from("not an image"))).rejects.toThrow(/unsupported/i);
  });

  it("removes any sibling logo with a different extension", async () => {
    writeFileSync(join(tmp, "logo.svg"), "<svg></svg>");
    await writeLogo(tmp, PNG_MAGIC);
    expect(existsSync(join(tmp, "logo.png"))).toBe(true);
    expect(existsSync(join(tmp, "logo.svg"))).toBe(false);
  });
});

describe("clearLogo", () => {
  it("deletes any logo.<ext> in the directory", async () => {
    writeFileSync(join(tmp, "logo.png"), "x");
    writeFileSync(join(tmp, "logo.svg"), "x");
    clearLogo(tmp);
    expect(existsSync(join(tmp, "logo.png"))).toBe(false);
    expect(existsSync(join(tmp, "logo.svg"))).toBe(false);
  });

  it("is a no-op when no logo exists", () => {
    expect(() => clearLogo(tmp)).not.toThrow();
  });
});

describe("resolveLogoPath", () => {
  it("returns the file path for an existing extension", () => {
    writeFileSync(join(tmp, "logo.png"), "x");
    expect(resolveLogoPath(tmp, "png")).toBe(join(tmp, "logo.png"));
  });

  it("returns null when the file does not exist", () => {
    expect(resolveLogoPath(tmp, "png")).toBeNull();
  });
});
