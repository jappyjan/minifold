import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import sharp from "sharp";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { getSetting } from "@/server/db/settings";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-settings-actions-"));
  dbPath = join(tmp, "test.db");
  const db = createDatabase(dbPath);
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  db.close();
  vi.stubEnv("DATABASE_PATH", dbPath);
  vi.resetModules();
});

afterEach(async () => {
  const { __resetDatabase } = await import("@/server/db");
  __resetDatabase();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

function fd(fields: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function realPng(): Promise<ArrayBuffer> {
  const buf = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
  }).png().toBuffer();
  // Convert Node.js Buffer to a plain ArrayBuffer (valid BlobPart in DOM types).
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

describe("saveAppName", () => {
  it("rejects empty name", async () => {
    const { saveAppName } = await import("@/app/admin/settings/actions");
    const s = await saveAppName({}, fd({ value: "" }));
    expect(s.fieldErrors?.value).toBeTruthy();
  });

  it("rejects names over 60 chars", async () => {
    const { saveAppName } = await import("@/app/admin/settings/actions");
    const s = await saveAppName({}, fd({ value: "x".repeat(61) }));
    expect(s.fieldErrors?.value).toBeTruthy();
  });

  it("saves a valid name", async () => {
    const { saveAppName } = await import("@/app/admin/settings/actions");
    const s = await saveAppName({}, fd({ value: "MyFiles" }));
    expect(s.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(getSetting(getDatabase(), "app_name")).toBe("MyFiles");
  });
});

describe("saveLogo (URL mode)", () => {
  it("rejects malformed URL", async () => {
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const s = await saveLogo({}, fd({ source: "url", url: "not a url" }));
    expect(s.fieldErrors?.url).toBeTruthy();
  });

  it("accepts an http URL", async () => {
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const s = await saveLogo({}, fd({ source: "url", url: "https://cdn.example.com/x.png" }));
    expect(s.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(getSetting(getDatabase(), "logo_url")).toBe("https://cdn.example.com/x.png");
  });

  it("accepts a relative URL", async () => {
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const s = await saveLogo({}, fd({ source: "url", url: "/static/logo.png" }));
    expect(s.success).toBe(true);
  });
});

describe("saveLogo (Upload mode)", () => {
  it("rejects oversized files", async () => {
    const big = Buffer.concat([PNG_MAGIC, Buffer.alloc(300_000)]);
    const blob = new Blob([big], { type: "image/png" });
    const file = new File([blob], "logo.png", { type: "image/png" });
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const s = await saveLogo({}, fd({ source: "upload", file }));
    expect(s.fieldErrors?.file).toMatch(/256|size/i);
  });

  it("rejects content with the wrong magic bytes", async () => {
    const blob = new Blob([Buffer.from("not an image at all")], { type: "image/png" });
    const file = new File([blob], "fake.png", { type: "image/png" });
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const s = await saveLogo({}, fd({ source: "upload", file }));
    expect(s.fieldErrors?.file).toMatch(/unsupported|type/i);
  });

  it("writes a valid PNG and stores internal:png", async () => {
    const buf = await realPng();
    const blob = new Blob([buf], { type: "image/png" });
    const file = new File([blob], "logo.png", { type: "image/png" });
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const s = await saveLogo({}, fd({ source: "upload", file }));
    expect(s.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(getSetting(getDatabase(), "logo_url")).toBe("internal:png");
    expect(existsSync(join(dirname(dbPath), "logo.png"))).toBe(true);
  });
});

describe("clearLogo", () => {
  it("clears the setting and removes the file", async () => {
    const buf = await realPng();
    const blob = new Blob([buf], { type: "image/png" });
    const file = new File([blob], "logo.png", { type: "image/png" });
    const { saveLogo, clearLogo } = await import("@/app/admin/settings/actions");
    await saveLogo({}, fd({ source: "upload", file }));
    await clearLogo();
    const { getDatabase } = await import("@/server/db");
    expect(getSetting(getDatabase(), "logo_url")).toBe("");
    expect(existsSync(join(dirname(dbPath), "logo.png"))).toBe(false);
  });
});

describe("saveAccentColor", () => {
  it("rejects a colour that fails 3:1 against either background", async () => {
    // #aaaaaa: ~2.3:1 on white (fails), ~8.5:1 on #0a0a0a (passes).
    const { saveAccentColor } = await import("@/app/admin/settings/actions");
    const s = await saveAccentColor({}, fd({ value: "#aaaaaa" }));
    expect(s.fieldErrors?.value).toBeTruthy();
  });

  it("rejects malformed hex", async () => {
    const { saveAccentColor } = await import("@/app/admin/settings/actions");
    const s = await saveAccentColor({}, fd({ value: "not-a-colour" }));
    expect(s.fieldErrors?.value).toBeTruthy();
  });

  it("saves a passing colour", async () => {
    const { saveAccentColor } = await import("@/app/admin/settings/actions");
    const s = await saveAccentColor({}, fd({ value: "#3b82f6" }));
    expect(s.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(getSetting(getDatabase(), "accent_color")).toBe("#3b82f6");
  });
});

describe("saveLogo (upload mode generates variants)", () => {
  it("writes logo-180/192/512/maskable-512 alongside logo.png", async () => {
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const buf = await realPng();
    const blob = new Blob([buf], { type: "image/png" });
    const s = await saveLogo({}, fd({ source: "upload", file: blob }));
    expect(s.success).toBe(true);
    const dir = dirname(dbPath);
    expect(existsSync(join(dir, "logo.png"))).toBe(true);
    expect(existsSync(join(dir, "logo-180.png"))).toBe(true);
    expect(existsSync(join(dir, "logo-192.png"))).toBe(true);
    expect(existsSync(join(dir, "logo-512.png"))).toBe(true);
    expect(existsSync(join(dir, "logo-maskable-512.png"))).toBe(true);
  });
});

describe("clearLogo (delete variants)", () => {
  it("removes all variant files", async () => {
    const { saveLogo, clearLogo } = await import("@/app/admin/settings/actions");
    const buf = await realPng();
    const blob = new Blob([buf], { type: "image/png" });
    await saveLogo({}, fd({ source: "upload", file: blob }));
    await clearLogo();
    const dir = dirname(dbPath);
    expect(existsSync(join(dir, "logo-180.png"))).toBe(false);
    expect(existsSync(join(dir, "logo-maskable-512.png"))).toBe(false);
  });
});

describe("saveAccentColor (regenerates maskable when logo exists)", () => {
  it("rewrites logo-maskable-512.png with the new accent backdrop", async () => {
    const { saveLogo, saveAccentColor } = await import("@/app/admin/settings/actions");
    const buf = await realPng();
    const blob = new Blob([buf], { type: "image/png" });
    await saveLogo({}, fd({ source: "upload", file: blob }));
    // Now change accent. The seeded migration sets accent to #3b82f6 with WCAG-passing contrast;
    // pick another WCAG-passing colour. #2563eb passes against both light and dark backgrounds.
    const s = await saveAccentColor({}, fd({ value: "#2563eb" }));
    expect(s.success).toBe(true);
    const dir = dirname(dbPath);
    const corner = await sharp(
      join(dir, "logo-maskable-512.png"),
    ).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect([corner[0], corner[1], corner[2]]).toEqual([0x25, 0x63, 0xeb]);
  });

  it("is a no-op for variant files when no logo is uploaded", async () => {
    const { saveAccentColor } = await import("@/app/admin/settings/actions");
    const s = await saveAccentColor({}, fd({ value: "#2563eb" }));
    expect(s.success).toBe(true);
    const dir = dirname(dbPath);
    expect(existsSync(join(dir, "logo-maskable-512.png"))).toBe(false);
  });
});
