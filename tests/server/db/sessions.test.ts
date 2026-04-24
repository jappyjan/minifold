import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createUser } from "@/server/db/users";
import {
  deleteSessionByTokenHash,
  deleteSessionsForUser,
  findSessionByTokenHash,
  insertSession,
  touchSession,
  type SessionRow,
} from "@/server/db/sessions";

let tmp: string;
let db: Database;
let userId: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-sess-"));
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

describe("sessions repository", () => {
  it("insertSession + findSessionByTokenHash", () => {
    const expiresAt = Date.now() + 1000;
    insertSession(db, {
      id: "s1",
      tokenHash: "hash-1",
      userId,
      expiresAt,
    });
    const found: SessionRow | null = findSessionByTokenHash(db, "hash-1");
    expect(found?.id).toBe("s1");
    expect(found?.user_id).toBe(userId);
    expect(found?.expires_at).toBe(expiresAt);
  });

  it("findSessionByTokenHash returns null for unknown hash", () => {
    expect(findSessionByTokenHash(db, "nope")).toBeNull();
  });

  it("touchSession updates last_seen_at and expires_at", () => {
    const oldExpiry = Date.now() + 1000;
    insertSession(db, {
      id: "s1",
      tokenHash: "hash-1",
      userId,
      expiresAt: oldExpiry,
    });
    const newExpiry = Date.now() + 999_999;
    touchSession(db, "hash-1", newExpiry);
    const found = findSessionByTokenHash(db, "hash-1");
    expect(found?.expires_at).toBe(newExpiry);
    expect(found?.last_seen_at).toBeGreaterThanOrEqual(found!.created_at);
  });

  it("deleteSessionByTokenHash removes the row", () => {
    insertSession(db, {
      id: "s1",
      tokenHash: "hash-1",
      userId,
      expiresAt: Date.now() + 1000,
    });
    deleteSessionByTokenHash(db, "hash-1");
    expect(findSessionByTokenHash(db, "hash-1")).toBeNull();
  });

  it("deleteSessionsForUser removes all of that user's sessions", () => {
    insertSession(db, {
      id: "s1",
      tokenHash: "hash-1",
      userId,
      expiresAt: Date.now() + 1000,
    });
    insertSession(db, {
      id: "s2",
      tokenHash: "hash-2",
      userId,
      expiresAt: Date.now() + 1000,
    });
    deleteSessionsForUser(db, userId);
    expect(findSessionByTokenHash(db, "hash-1")).toBeNull();
    expect(findSessionByTokenHash(db, "hash-2")).toBeNull();
  });
});
