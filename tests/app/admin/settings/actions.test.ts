import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
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
    const blob = new Blob([PNG_MAGIC], { type: "image/png" });
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
    const blob = new Blob([PNG_MAGIC], { type: "image/png" });
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
