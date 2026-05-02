import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createUser, findUserById, findUserByUsername } from "@/server/db/users";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import {
  addUser,
  deactivateUserAdmin,
  activateUserAdmin,
  deleteUserAdmin,
  promoteUserAdmin,
  demoteUserAdmin,
  resetUserPasswordAdmin,
  LastAdminError,
} from "@/server/auth/users-admin";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-users-admin-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function seedAdmin(username: string) {
  return createUser(db, {
    name: username,
    username,
    passwordHash: await hashPassword("seed"),
    role: "admin",
    mustChangePassword: false,
  });
}

async function seedUser(username: string) {
  return createUser(db, {
    name: username,
    username,
    passwordHash: await hashPassword("seed"),
    role: "user",
    mustChangePassword: false,
  });
}

describe("addUser", () => {
  it("creates a user with the supplied password (manual mode)", async () => {
    const result = await addUser(db, {
      name: "Alice",
      username: "alice",
      mode: "manual",
      password: "supersecret",
    });
    expect(result.user.username).toBe("alice");
    expect(result.user.must_change_password).toBe(1);
    expect(result.generatedPassword).toBeUndefined();
    expect(await verifyPassword("supersecret", result.user.password)).toBe(true);
  });

  it("creates a user with a generated password (generate mode)", async () => {
    const result = await addUser(db, {
      name: "Alice",
      username: "alice",
      mode: "generate",
    });
    expect(result.generatedPassword).toBeDefined();
    expect(result.generatedPassword).toHaveLength(16);
    expect(result.user.must_change_password).toBe(1);
    expect(await verifyPassword(result.generatedPassword!, result.user.password)).toBe(true);
  });

  it("lowercases the username", async () => {
    const result = await addUser(db, {
      name: "Alice",
      username: "Alice",
      mode: "generate",
    });
    expect(result.user.username).toBe("alice");
  });
});

describe("deactivateUserAdmin", () => {
  it("sets deactivated=1 and deletes the user's sessions", async () => {
    const u = await seedUser("alice");
    createSession(db, u.id);
    deactivateUserAdmin(db, u.id);
    const after = findUserById(db, u.id)!;
    expect(after.deactivated).toBe(1);
    const n = db.prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?").get(u.id) as { n: number };
    expect(n.n).toBe(0);
  });

  it("refuses to deactivate the last active admin", async () => {
    const u = await seedAdmin("admin");
    expect(() => deactivateUserAdmin(db, u.id)).toThrow(LastAdminError);
  });

  it("allows deactivating an admin when another active admin exists", async () => {
    const a = await seedAdmin("alice");
    await seedAdmin("bob");
    deactivateUserAdmin(db, a.id);
    expect(findUserById(db, a.id)?.deactivated).toBe(1);
  });
});

describe("activateUserAdmin", () => {
  it("clears deactivated", async () => {
    const u = await seedUser("alice");
    deactivateUserAdmin(db, u.id);
    activateUserAdmin(db, u.id);
    expect(findUserById(db, u.id)?.deactivated).toBe(0);
  });
});

describe("deleteUserAdmin", () => {
  it("removes a non-admin user", async () => {
    const u = await seedUser("alice");
    deleteUserAdmin(db, u.id);
    expect(findUserById(db, u.id)).toBeNull();
  });

  it("refuses to delete the last active admin", async () => {
    const u = await seedAdmin("admin");
    expect(() => deleteUserAdmin(db, u.id)).toThrow(LastAdminError);
  });
});

describe("promoteUserAdmin / demoteUserAdmin", () => {
  it("promotes a user to admin", async () => {
    const u = await seedUser("alice");
    promoteUserAdmin(db, u.id);
    expect(findUserById(db, u.id)?.role).toBe("admin");
  });

  it("refuses to demote the last active admin", async () => {
    const u = await seedAdmin("admin");
    expect(() => demoteUserAdmin(db, u.id)).toThrow(LastAdminError);
  });

  it("demotes an admin when another active admin exists", async () => {
    const a = await seedAdmin("alice");
    await seedAdmin("bob");
    demoteUserAdmin(db, a.id);
    expect(findUserById(db, a.id)?.role).toBe("user");
  });
});

describe("resetUserPasswordAdmin", () => {
  it("generates a new password, deletes the user's sessions, sets must_change_password=1", async () => {
    const u = await seedUser("alice");
    createSession(db, u.id);
    const result = await resetUserPasswordAdmin(db, u.id);
    expect(result.generatedPassword).toHaveLength(16);
    const after = findUserById(db, u.id)!;
    expect(after.must_change_password).toBe(1);
    expect(await verifyPassword(result.generatedPassword, after.password)).toBe(true);
    const n = db.prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?").get(u.id) as { n: number };
    expect(n.n).toBe(0);
  });
});
