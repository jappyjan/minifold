// tests/app/setup/actions.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { findProviderBySlug } from "@/server/db/providers";
import { createUser } from "@/server/db/users";
import { hashPassword } from "@/server/auth/password";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/auth/cookies", () => ({ writeSessionCookie: vi.fn() }));

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-setup-actions-"));
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

async function seedAdmin() {
  const { getDatabase } = await import("@/server/db");
  const db = getDatabase();
  const hash = await hashPassword("password123456");
  createUser(db, {
    name: "Admin",
    username: "admin",
    passwordHash: hash,
    role: "admin",
    mustChangePassword: false,
  });
}

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("createFirstProvider — S3", () => {
  it("creates an S3 provider on valid input", async () => {
    await seedAdmin();
    const { createFirstProvider } = await import("@/app/setup/actions");
    const { getDatabase } = await import("@/server/db");
    await createFirstProvider(
      {},
      makeFormData({
        type: "s3",
        name: "My Bucket",
        bucket: "my-bucket",
        region: "eu-central-1",
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
      }),
    );
    // redirect is mocked so state comes back (no throw)
    const row = findProviderBySlug(getDatabase(), "my-bucket");
    expect(row?.type).toBe("s3");
    const cfg = row?.config as { bucket: string; region: string };
    expect(cfg.bucket).toBe("my-bucket");
    expect(cfg.region).toBe("eu-central-1");
  });

  it("returns fieldErrors when bucket is missing", async () => {
    await seedAdmin();
    const { createFirstProvider } = await import("@/app/setup/actions");
    const state = await createFirstProvider(
      {},
      makeFormData({
        type: "s3",
        name: "My Bucket",
        bucket: "",
        region: "eu-central-1",
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
      }),
    );
    expect(state.fieldErrors?.bucket).toBeTruthy();
  });
});

describe("createFirstProvider — local (regression)", () => {
  it("still creates a local provider on valid input", async () => {
    await seedAdmin();
    const { createFirstProvider } = await import("@/app/setup/actions");
    const { getDatabase } = await import("@/server/db");
    await createFirstProvider(
      {},
      makeFormData({ type: "local", name: "Files", rootPath: "/files" }),
    );
    const row = findProviderBySlug(getDatabase(), "files");
    expect(row?.type).toBe("local");
  });
});
