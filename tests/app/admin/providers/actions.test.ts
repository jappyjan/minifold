import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { findProviderBySlug, hasAnyProvider } from "@/server/db/providers";

// Mock Next.js modules before any imports that use them
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-admin-actions-"));
  // Seed a real DB at a temp path; getDatabase() picks this up via env var
  const db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  db.close();
  vi.stubEnv("DATABASE_PATH", join(tmp, "test.db"));
  vi.resetModules();
});

afterEach(async () => {
  const { __resetDatabase } = await import("@/server/db");
  __resetDatabase();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("addProvider — local", () => {
  it("returns fieldErrors when name is empty", async () => {
    const { addProvider } = await import(
      "@/app/admin/providers/actions"
    );
    const state = await addProvider({}, makeFormData({ type: "local", name: "", rootPath: "/files" }));
    expect(state.fieldErrors?.name).toBeTruthy();
  });

  it("returns fieldErrors when rootPath is empty", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    const state = await addProvider({}, makeFormData({ type: "local", name: "NAS", rootPath: "" }));
    expect(state.fieldErrors?.rootPath).toBeTruthy();
  });

  it("returns fieldErrors when slug is invalid", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    const state = await addProvider(
      {},
      makeFormData({ type: "local", name: "NAS", rootPath: "/files", slug: "Bad Slug!" }),
    );
    expect(state.fieldErrors?.slug).toBeTruthy();
  });

  it("creates a local provider and returns success", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    const { getDatabase } = await import("@/server/db");
    const state = await addProvider(
      {},
      makeFormData({ type: "local", name: "NAS", rootPath: "/files" }),
    );
    expect(state.success).toBe(true);
    expect(state.fieldErrors).toBeUndefined();
    const row = findProviderBySlug(getDatabase(), "nas");
    expect(row).not.toBeNull();
    expect(row?.type).toBe("local");
    expect((row?.config as { rootPath: string }).rootPath).toBe("/files");
  });

  it("returns fieldErrors when slug already exists", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    await addProvider({}, makeFormData({ type: "local", name: "NAS", rootPath: "/files", slug: "nas" }));
    vi.resetModules();
    const { addProvider: addProvider2 } = await import("@/app/admin/providers/actions");
    const state = await addProvider2(
      {},
      makeFormData({ type: "local", name: "NAS2", rootPath: "/files2", slug: "nas" }),
    );
    expect(state.fieldErrors?.slug).toBeTruthy();
  });
});

describe("addProvider — S3", () => {
  it("returns fieldErrors when bucket is empty", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    const state = await addProvider(
      {},
      makeFormData({
        type: "s3",
        name: "B2",
        bucket: "",
        region: "us-east-1",
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
      }),
    );
    expect(state.fieldErrors?.bucket).toBeTruthy();
  });

  it("returns fieldErrors when region is empty", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    const state = await addProvider(
      {},
      makeFormData({
        type: "s3",
        name: "B2",
        bucket: "my-bucket",
        region: "",
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
      }),
    );
    expect(state.fieldErrors?.region).toBeTruthy();
  });

  it("creates an S3 provider and returns success", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    const { getDatabase } = await import("@/server/db");
    const state = await addProvider(
      {},
      makeFormData({
        type: "s3",
        name: "Backblaze",
        bucket: "my-bucket",
        region: "us-west-001",
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
        endpoint: "https://s3.us-west-001.backblazeb2.com",
      }),
    );
    expect(state.success).toBe(true);
    const row = findProviderBySlug(getDatabase(), "backblaze");
    expect(row?.type).toBe("s3");
    const cfg = row?.config as {
      bucket: string;
      region: string;
      accessKeyId: string;
      endpoint: string;
    };
    expect(cfg.bucket).toBe("my-bucket");
    expect(cfg.region).toBe("us-west-001");
    expect(cfg.endpoint).toBe("https://s3.us-west-001.backblazeb2.com");
  });
});

describe("deleteProvider", () => {
  it("removes an existing provider", async () => {
    const { addProvider, deleteProvider } = await import(
      "@/app/admin/providers/actions"
    );
    const { getDatabase } = await import("@/server/db");
    await addProvider({}, makeFormData({ type: "local", name: "NAS", rootPath: "/files", slug: "nas" }));
    expect(hasAnyProvider(getDatabase())).toBe(true);

    await deleteProvider(undefined, makeFormData({ slug: "nas" }));
    expect(hasAnyProvider(getDatabase())).toBe(false);
  });

  it("is a no-op for an unknown slug", async () => {
    const { deleteProvider } = await import("@/app/admin/providers/actions");
    // Should not throw
    await expect(
      deleteProvider(undefined, makeFormData({ slug: "nonexistent" })),
    ).resolves.toBeUndefined();
  });
});
