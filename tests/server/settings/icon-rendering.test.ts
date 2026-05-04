import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import { resizeAny, composeMaskable } from "@/server/settings/icon-rendering";

let sourcePng: Buffer;

beforeAll(async () => {
  // 1024×1024 PNG: red square on transparent — content doesn't matter, we only check geometry.
  sourcePng = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer();
});

describe("resizeAny", () => {
  for (const size of [180, 192, 512] as const) {
    it(`returns a ${size}×${size} PNG`, async () => {
      const out = await resizeAny(sourcePng, size);
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe("png");
      expect(meta.width).toBe(size);
      expect(meta.height).toBe(size);
    });
  }

  it("preserves transparency for non-square inputs (letterboxed via fit:contain)", async () => {
    const wide = await sharp({
      create: { width: 1024, height: 256, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
    }).png().toBuffer();
    const out = await resizeAny(wide, 192);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(192);
    expect(meta.height).toBe(192);
    // Top-left pixel (well above the green stripe) should be fully transparent (alpha=0).
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    // PNG channels: RGBA. data[3] = alpha at (0,0).
    expect(data[3]).toBe(0);
  });
});

describe("composeMaskable", () => {
  it("returns a 512×512 PNG", async () => {
    const out = await composeMaskable(sourcePng, "#3b82f6");
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });

  it("paints all four corners with the accent colour (outside the safe zone)", async () => {
    const out = await composeMaskable(sourcePng, "#3b82f6");
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    // info.channels = 4 (RGBA). Pixel (x,y) → offset (y * info.width + x) * 4.
    const px = (x: number, y: number) => {
      const off = (y * info.width + x) * info.channels;
      return [data[off], data[off + 1], data[off + 2]];
    };
    const expected = [0x3b, 0x82, 0xf6];
    expect(px(0, 0)).toEqual(expected);
    expect(px(511, 0)).toEqual(expected);
    expect(px(0, 511)).toEqual(expected);
    expect(px(511, 511)).toEqual(expected);
  });

  it("accepts hex without the # prefix and CSS named colours via sharp", async () => {
    // sharp itself accepts "#rrggbb", "rrggbb", and CSS names — we just hand it through.
    const out = await composeMaskable(sourcePng, "#000000");
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([0, 0, 0]);
  });
});
