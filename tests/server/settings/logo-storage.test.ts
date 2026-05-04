import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  writeLogo,
  clearLogo,
  resolveLogoPath,
  sniffImageType,
  regenerateMaskable,
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

async function realPng(width = 32, height = 32): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer();
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
    const buf = await realPng();
    await writeLogo(tmp, buf, "#3b82f6");
    expect(existsSync(join(tmp, "logo.png"))).toBe(true);
  });

  it("returns the extension that was sniffed", async () => {
    const buf = await realPng();
    const result = await writeLogo(tmp, buf, "#3b82f6");
    expect(result).toBe("png");
  });

  it("rejects unrecognised content", async () => {
    await expect(writeLogo(tmp, Buffer.from("not an image"), "#3b82f6")).rejects.toThrow(/unsupported/i);
  });

  it("removes any sibling logo with a different extension", async () => {
    writeFileSync(join(tmp, "logo.svg"), "<svg></svg>");
    const buf = await realPng();
    await writeLogo(tmp, buf, "#3b82f6");
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

describe("writeLogo (variant generation)", () => {
  it("writes logo-180.png, logo-192.png, logo-512.png, logo-maskable-512.png on upload", async () => {
    const buf = await realPng();
    await writeLogo(tmp, buf, "#3b82f6");
    expect(existsSync(join(tmp, "logo.png"))).toBe(true);
    expect(existsSync(join(tmp, "logo-180.png"))).toBe(true);
    expect(existsSync(join(tmp, "logo-192.png"))).toBe(true);
    expect(existsSync(join(tmp, "logo-512.png"))).toBe(true);
    expect(existsSync(join(tmp, "logo-maskable-512.png"))).toBe(true);
  });

  it("variants have the expected dimensions", async () => {
    const buf = await realPng();
    await writeLogo(tmp, buf, "#3b82f6");
    expect((await sharp(join(tmp, "logo-180.png")).metadata()).width).toBe(180);
    expect((await sharp(join(tmp, "logo-192.png")).metadata()).width).toBe(192);
    expect((await sharp(join(tmp, "logo-512.png")).metadata()).width).toBe(512);
    expect((await sharp(join(tmp, "logo-maskable-512.png")).metadata()).width).toBe(512);
  });

  it("maskable variant uses the supplied accent for the corner pixel", async () => {
    const buf = await realPng();
    await writeLogo(tmp, buf, "#000000");
    const corner = await sharp(join(tmp, "logo-maskable-512.png"))
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect([corner[0], corner[1], corner[2]]).toEqual([0, 0, 0]);
  });
});

describe("clearLogo (variant deletion)", () => {
  it("removes all variant files alongside the original", async () => {
    const buf = await realPng();
    await writeLogo(tmp, buf, "#3b82f6");
    clearLogo(tmp);
    expect(existsSync(join(tmp, "logo.png"))).toBe(false);
    expect(existsSync(join(tmp, "logo-180.png"))).toBe(false);
    expect(existsSync(join(tmp, "logo-192.png"))).toBe(false);
    expect(existsSync(join(tmp, "logo-512.png"))).toBe(false);
    expect(existsSync(join(tmp, "logo-maskable-512.png"))).toBe(false);
  });
});

describe("regenerateMaskable", () => {
  it("rewrites only logo-maskable-512.png, leaving other variants untouched", async () => {
    const buf = await realPng();
    await writeLogo(tmp, buf, "#3b82f6");
    const before180 = await sharp(join(tmp, "logo-180.png")).raw().toBuffer();

    await regenerateMaskable(tmp, buf, "#ff00ff");
    const corner = await sharp(join(tmp, "logo-maskable-512.png"))
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect([corner[0], corner[1], corner[2]]).toEqual([0xff, 0x00, 0xff]);

    const after180 = await sharp(join(tmp, "logo-180.png")).raw().toBuffer();
    expect(after180.equals(before180)).toBe(true);
  });
});
