import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createUser } from "@/server/db/users";
import { deleteSessionsForUser } from "@/server/db/sessions";
import {
  SESSION_TTL_MS,
  TOUCH_AFTER_MS,
  createSession,
  destroySession,
  destroySessionsForUser,
  validateSession,
} from "@/server/auth/session";

let tmp: string;
let db: Database;
let userId: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-session-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  userId = createUser(db, {
    name: "Jane",
    username: "jane",
    passwordHash: "$2a$12$xyz",
    role: "admin",
    mustChangePassword: false,
  }).id;
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("session manager", () => {
  it("createSession returns a base64url token and stores a hashed record", () => {
    const result = createSession(db, userId);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + SESSION_TTL_MS + 1000);
  });

  it("validateSession returns the user for a valid token", () => {
    const { token } = createSession(db, userId);
    const result = validateSession(db, token);
    expect(result?.user.id).toBe(userId);
    expect(result?.user.username).toBe("jane");
  });

  it("validateSession returns null for garbage tokens", () => {
    expect(validateSession(db, "not-a-real-token")).toBeNull();
  });

  it("validateSession returns null for an expired session", () => {
    const { token } = createSession(db, userId);
    db.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ?").run(
      Date.now() - 1000,
      userId,
    );
    expect(validateSession(db, token)).toBeNull();
  });

  it("validateSession extends expires_at when last_seen_at is older than TOUCH_AFTER_MS", () => {
    const { token } = createSession(db, userId);
    const old = Date.now() - TOUCH_AFTER_MS - 1000;
    db.prepare(
      "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE user_id = ?",
    ).run(old, Date.now() + 1000, userId);

    const beforeTouch = (
      db
        .prepare("SELECT expires_at FROM sessions WHERE user_id = ?")
        .get(userId) as { expires_at: number }
    ).expires_at;

    validateSession(db, token);

    const afterTouch = (
      db
        .prepare("SELECT expires_at FROM sessions WHERE user_id = ?")
        .get(userId) as { expires_at: number }
    ).expires_at;

    expect(afterTouch).toBeGreaterThan(beforeTouch);
  });

  it("destroySession removes the row", () => {
    const { token } = createSession(db, userId);
    destroySession(db, token);
    expect(validateSession(db, token)).toBeNull();
  });

  it("destroySession on an unknown token is a no-op", () => {
    expect(() => destroySession(db, "bogus")).not.toThrow();
  });

  it("destroySessionsForUser clears every session for the user", () => {
    createSession(db, userId);
    createSession(db, userId);
    destroySessionsForUser(db, userId);
    const sessionsLeft = db
      .prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?")
      .get(userId) as { n: number };
    expect(sessionsLeft.n).toBe(0);
    deleteSessionsForUser(db, userId); // idempotent
  });

  it("validateSession for a deactivated user returns null and deletes the session", () => {
    const { token } = createSession(db, userId);
    db.prepare("UPDATE users SET deactivated = 1 WHERE id = ?").run(userId);
    expect(validateSession(db, token)).toBeNull();
    expect(
      (db
        .prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?")
        .get(userId) as { n: number }).n,
    ).toBe(0);
  });
});
