import { describe, it, expect, afterAll } from "vitest";

// This test exercises the real Puppeteer + Three.js render pipeline. It
// requires a Chromium with working WebGL — typically only available locally.
// Opt in by exporting THUMB_WORKER_LIVE_TEST=1 along with PUPPETEER_EXECUTABLE_PATH.
// We don't gate on `existsSync("/usr/bin/chromium")` because GitHub Actions
// runners ship a Chromium that exists but can't create a WebGL context.
const has = process.env.THUMB_WORKER_LIVE_TEST === "1";

afterAll(async () => {
  if (has) {
    const { shutdownBrowser } = await import("../src/render.js");
    await shutdownBrowser();
  }
});

describe.runIf(has)("renderThumbnail (live Chromium)", () => {
  it(
    "returns a non-empty WebP buffer for a tiny binary STL",
    async () => {
      const { renderThumbnail } = await import("../src/render.js");

      // Build a minimal valid binary STL:
      // 80-byte header + 4-byte uint32 triCount + 50 bytes per triangle.
      const header = Buffer.alloc(80);
      const triCount = Buffer.alloc(4);
      triCount.writeUInt32LE(1, 0);
      const tri = Buffer.alloc(50);
      // normal vector (12 bytes)
      tri.writeFloatLE(0, 0); // nx
      tri.writeFloatLE(0, 4); // ny
      tri.writeFloatLE(1, 8); // nz
      // vertex 1 (12 bytes)
      tri.writeFloatLE(0, 12);
      tri.writeFloatLE(0, 16);
      tri.writeFloatLE(0, 20);
      // vertex 2 (12 bytes)
      tri.writeFloatLE(1, 24);
      tri.writeFloatLE(0, 28);
      tri.writeFloatLE(0, 32);
      // vertex 3 (12 bytes)
      tri.writeFloatLE(0, 36);
      tri.writeFloatLE(1, 40);
      tri.writeFloatLE(0, 44);
      // attribute byte count (2 bytes) — already zero from Buffer.alloc

      const buf = Buffer.concat([header, triCount, tri]);
      const out = await renderThumbnail(buf, "stl");

      expect(out.length).toBeGreaterThan(50);
      // WebP RIFF header: bytes 0-3 = "RIFF", bytes 8-11 = "WEBP"
      expect(out.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(out.subarray(8, 12).toString("ascii")).toBe("WEBP");
    },
    60_000,
  );
});
