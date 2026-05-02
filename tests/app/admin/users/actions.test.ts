import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createUser, findUserById, findUserByUsername } from "@/server/db/users";
import { hashPassword } from "@/server/auth/password";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-users-actions-"));
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

async function seedAdmin(username: string) {
  const { getDatabase } = await import("@/server/db");
  return createUser(getDatabase(), {
    name: username,
    username,
    passwordHash: await hashPassword("seed"),
    role: "admin",
    mustChangePassword: false,
  });
}

async function seedUser(username: string) {
  const { getDatabase } = await import("@/server/db");
  return createUser(getDatabase(), {
    name: username,
    username,
    passwordHash: await hashPassword("seed"),
    role: "user",
    mustChangePassword: false,
  });
}

describe("addUser action", () => {
  it("returns fieldErrors when name is empty", async () => {
    const { addUser } = await import("@/app/admin/users/actions");
    const state = await addUser({}, makeFormData({ name: "", username: "alice", mode: "generate" }));
    expect(state.fieldErrors?.name).toBeTruthy();
  });

  it("returns fieldErrors for a username with bad characters", async () => {
    const { addUser } = await import("@/app/admin/users/actions");
    const state = await addUser({}, makeFormData({ name: "Alice", username: "Bad Name!", mode: "generate" }));
    expect(state.fieldErrors?.username).toBeTruthy();
  });

  it("returns fieldErrors when manual password is too short", async () => {
    const { addUser } = await import("@/app/admin/users/actions");
    const state = await addUser({}, makeFormData({ name: "Alice", username: "alice", mode: "manual", password: "short" }));
    expect(state.fieldErrors?.password).toBeTruthy();
  });

  it("creates a user (generate) and returns generatedPassword on success", async () => {
    const { addUser } = await import("@/app/admin/users/actions");
    const state = await addUser({}, makeFormData({ name: "Alice", username: "alice", mode: "generate" }));
    expect(state.success).toBe(true);
    expect(state.generatedPassword).toHaveLength(16);
    const { getDatabase } = await import("@/server/db");
    expect(findUserByUsername(getDatabase(), "alice")).not.toBeNull();
  });

  it("creates a user (manual) without returning a password", async () => {
    const { addUser } = await import("@/app/admin/users/actions");
    const state = await addUser({}, makeFormData({ name: "Alice", username: "alice", mode: "manual", password: "supersecret" }));
    expect(state.success).toBe(true);
    expect(state.generatedPassword).toBeUndefined();
  });

  it("returns fieldErrors when username is already taken", async () => {
    await seedUser("alice");
    vi.resetModules();
    const { addUser } = await import("@/app/admin/users/actions");
    const state = await addUser({}, makeFormData({ name: "Alice", username: "alice", mode: "generate" }));
    expect(state.fieldErrors?.username).toBeTruthy();
  });
});

describe("deactivateUser / activateUser actions", () => {
  it("deactivate sets deactivated=1", async () => {
    const u = await seedUser("alice");
    vi.resetModules();
    const { deactivateUser } = await import("@/app/admin/users/actions");
    const state = await deactivateUser({}, makeFormData({ id: u.id }));
    expect(state.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(findUserById(getDatabase(), u.id)?.deactivated).toBe(1);
  });

  it("deactivate of last admin returns {error}", async () => {
    const u = await seedAdmin("admin");
    vi.resetModules();
    const { deactivateUser } = await import("@/app/admin/users/actions");
    const state = await deactivateUser({}, makeFormData({ id: u.id }));
    expect(state.error).toMatch(/last/i);
  });

  it("activate clears deactivated", async () => {
    const u = await seedUser("alice");
    vi.resetModules();
    const { deactivateUser, activateUser } = await import("@/app/admin/users/actions");
    await deactivateUser({}, makeFormData({ id: u.id }));
    await activateUser({}, makeFormData({ id: u.id }));
    const { getDatabase } = await import("@/server/db");
    expect(findUserById(getDatabase(), u.id)?.deactivated).toBe(0);
  });
});

describe("deleteUser action", () => {
  it("removes a non-admin", async () => {
    const u = await seedUser("alice");
    vi.resetModules();
    const { deleteUser } = await import("@/app/admin/users/actions");
    const state = await deleteUser({}, makeFormData({ id: u.id }));
    expect(state.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(findUserById(getDatabase(), u.id)).toBeNull();
  });

  it("refuses to delete the last admin", async () => {
    const u = await seedAdmin("admin");
    vi.resetModules();
    const { deleteUser } = await import("@/app/admin/users/actions");
    const state = await deleteUser({}, makeFormData({ id: u.id }));
    expect(state.error).toMatch(/last/i);
  });
});

describe("promoteUser / demoteUser actions", () => {
  it("promotes a user", async () => {
    const u = await seedUser("alice");
    vi.resetModules();
    const { promoteUser } = await import("@/app/admin/users/actions");
    const state = await promoteUser({}, makeFormData({ id: u.id }));
    expect(state.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(findUserById(getDatabase(), u.id)?.role).toBe("admin");
  });

  it("demote refuses last admin", async () => {
    const u = await seedAdmin("admin");
    vi.resetModules();
    const { demoteUser } = await import("@/app/admin/users/actions");
    const state = await demoteUser({}, makeFormData({ id: u.id }));
    expect(state.error).toMatch(/last/i);
  });
});

describe("resetUserPassword action", () => {
  it("returns generatedPassword and updates the user", async () => {
    const u = await seedUser("alice");
    vi.resetModules();
    const { resetUserPassword } = await import("@/app/admin/users/actions");
    const state = await resetUserPassword({}, makeFormData({ id: u.id }));
    expect(state.success).toBe(true);
    expect(state.generatedPassword).toHaveLength(16);
    const { getDatabase } = await import("@/server/db");
    expect(findUserById(getDatabase(), u.id)?.must_change_password).toBe(1);
  });
});
