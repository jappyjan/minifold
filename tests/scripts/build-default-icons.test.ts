import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { buildDefaultIcons } from "../../scripts/build-default-icons";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-build-icons-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function realSourcePng(): Promise<Buffer> {
  return sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer();
}

describe("buildDefaultIcons", () => {
  it("writes icon-180.png, icon-192.png, icon-512.png, icon-maskable-512.png to outDir", async () => {
    const src = join(tmp, "icon-source.png");
    writeFileSync(src, await realSourcePng());
    const outDir = join(tmp, "out"); // does NOT exist — script must create it.
    await buildDefaultIcons(src, outDir, "#3b82f6");
    expect(existsSync(join(outDir, "icon-180.png"))).toBe(true);
    expect(existsSync(join(outDir, "icon-192.png"))).toBe(true);
    expect(existsSync(join(outDir, "icon-512.png"))).toBe(true);
    expect(existsSync(join(outDir, "icon-maskable-512.png"))).toBe(true);
    expect((await sharp(join(outDir, "icon-180.png")).metadata()).width).toBe(180);
    expect((await sharp(join(outDir, "icon-512.png")).metadata()).width).toBe(512);
  });

  it("throws if the source file is missing", async () => {
    await expect(
      buildDefaultIcons(join(tmp, "nope.png"), tmp, "#3b82f6"),
    ).rejects.toThrow();
  });
});
