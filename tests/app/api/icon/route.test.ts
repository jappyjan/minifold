import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

let tmp: string;
let dataDir: string;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-icon-route-"));
  dataDir = join(tmp, "data");
  mkdirSync(dataDir, { recursive: true });
  vi.stubEnv("DATABASE_PATH", join(dataDir, "minifold.db"));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

async function fakePng(size: number): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  }).png().toBuffer();
}

function req(url: string, init?: RequestInit): Request {
  return new Request(`http://test${url}`, init);
}

describe("/api/icon/[size]/[purpose] route", () => {
  it("serves the uploaded variant from /data when present (size=192, purpose=any)", async () => {
    writeFileSync(join(dataDir, "logo-192.png"), await fakePng(192));
    const { GET } = await import("@/app/api/icon/[size]/[purpose]/route");
    const res = await GET(req("/api/icon/192/any.png"), {
      params: Promise.resolve({ size: "192", purpose: "any" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("ETag")).toBeTruthy();
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
    // Confirm it's a PNG
    expect(body.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  });

  it("falls back to the public default when no /data variant exists", async () => {
    // No /data/logo-*.png written — but the public default exists in the repo at public/icons/icon-192.png (built by Task 4).
    const { GET } = await import("@/app/api/icon/[size]/[purpose]/route");
    const res = await GET(req("/api/icon/192/any.png"), {
      params: Promise.resolve({ size: "192", purpose: "any" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("returns 404 for invalid size", async () => {
    const { GET } = await import("@/app/api/icon/[size]/[purpose]/route");
    const res = await GET(req("/api/icon/256/any.png"), {
      params: Promise.resolve({ size: "256", purpose: "any" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for invalid purpose", async () => {
    const { GET } = await import("@/app/api/icon/[size]/[purpose]/route");
    const res = await GET(req("/api/icon/512/random.png"), {
      params: Promise.resolve({ size: "512", purpose: "random" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for size=180 + purpose=maskable (disallowed combo)", async () => {
    const { GET } = await import("@/app/api/icon/[size]/[purpose]/route");
    const res = await GET(req("/api/icon/180/maskable.png"), {
      params: Promise.resolve({ size: "180", purpose: "maskable" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 304 when If-None-Match matches the ETag", async () => {
    writeFileSync(join(dataDir, "logo-192.png"), await fakePng(192));
    const { GET } = await import("@/app/api/icon/[size]/[purpose]/route");
    const first = await GET(req("/api/icon/192/any.png"), {
      params: Promise.resolve({ size: "192", purpose: "any" }),
    });
    const etag = first.headers.get("ETag");
    expect(etag).toBeTruthy();
    const second = await GET(
      req("/api/icon/192/any.png", { headers: { "If-None-Match": etag! } }),
      { params: Promise.resolve({ size: "192", purpose: "any" }) },
    );
    expect(second.status).toBe(304);
  });
});
