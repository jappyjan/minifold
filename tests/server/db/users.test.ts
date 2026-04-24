import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import {
  createUser,
  deleteUser,
  findUserByUsername,
  findUserById,
  hasAnyAdmin,
  listUsers,
  setLastLogin,
  updateUserPassword,
  updateUserRole,
  type UserRow,
} from "@/server/db/users";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-users-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("users repository", () => {
  it("hasAnyAdmin false on empty DB", () => {
    expect(hasAnyAdmin(db)).toBe(false);
  });

  it("createUser inserts and findUserByUsername retrieves (case-insensitive)", () => {
    const created = createUser(db, {
      name: "Jane",
      username: "Jane",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.username).toBe("jane");

    const found: UserRow | null = findUserByUsername(db, "JANE");
    expect(found?.id).toBe(created.id);
    expect(found?.role).toBe("admin");
    expect(found?.must_change_password).toBe(0);
  });

  it("hasAnyAdmin true once an admin exists, false for 'user' role only", () => {
    createUser(db, {
      name: "Bob",
      username: "bob",
      passwordHash: "$2a$12$xyz",
      role: "user",
      mustChangePassword: false,
    });
    expect(hasAnyAdmin(db)).toBe(false);

    createUser(db, {
      name: "Jane",
      username: "jane",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    expect(hasAnyAdmin(db)).toBe(true);
  });

  it("findUserById returns the user or null", () => {
    const created = createUser(db, {
      name: "Jane",
      username: "jane",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    expect(findUserById(db, created.id)?.username).toBe("jane");
    expect(findUserById(db, "nonexistent")).toBeNull();
  });

  it("setLastLogin updates the timestamp", () => {
    const created = createUser(db, {
      name: "Jane",
      username: "jane",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    setLastLogin(db, created.id);
    const found = findUserById(db, created.id);
    expect(found?.last_login).not.toBeNull();
    expect(found?.last_login).toBeGreaterThan(0);
  });

  it("updateUserPassword replaces the hash, sets mustChangePassword", () => {
    const created = createUser(db, {
      name: "Jane",
      username: "jane",
      passwordHash: "$2a$12$old",
      role: "user",
      mustChangePassword: true,
    });
    updateUserPassword(db, created.id, "$2a$12$new", { mustChangePassword: false });
    const found = findUserById(db, created.id);
    expect(found?.password).toBe("$2a$12$new");
    expect(found?.must_change_password).toBe(0);

    updateUserPassword(db, created.id, "$2a$12$newer", { mustChangePassword: true });
    const again = findUserById(db, created.id);
    expect(again?.must_change_password).toBe(1);
  });

  it("updateUserRole swaps role", () => {
    const created = createUser(db, {
      name: "Bob",
      username: "bob",
      passwordHash: "$2a$12$xyz",
      role: "user",
      mustChangePassword: false,
    });
    updateUserRole(db, created.id, "admin");
    expect(findUserById(db, created.id)?.role).toBe("admin");
  });

  it("deleteUser removes the user", () => {
    const created = createUser(db, {
      name: "Bob",
      username: "bob",
      passwordHash: "$2a$12$xyz",
      role: "user",
      mustChangePassword: false,
    });
    deleteUser(db, created.id);
    expect(findUserById(db, created.id)).toBeNull();
  });

  it("listUsers returns all users sorted by created_at", () => {
    createUser(db, {
      name: "A",
      username: "alice",
      passwordHash: "$2a$12$x",
      role: "admin",
      mustChangePassword: false,
    });
    createUser(db, {
      name: "B",
      username: "charlie",
      passwordHash: "$2a$12$x",
      role: "user",
      mustChangePassword: false,
    });
    const rows = listUsers(db);
    expect(rows.map((r) => r.username)).toEqual(["alice", "charlie"]);
  });

  it("createUser rejects duplicate username", () => {
    createUser(db, {
      name: "Jane",
      username: "jane",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    expect(() =>
      createUser(db, {
        name: "Other",
        username: "jane",
        passwordHash: "$2a$12$abc",
        role: "user",
        mustChangePassword: true,
      }),
    ).toThrow();
  });
});
