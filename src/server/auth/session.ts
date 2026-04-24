import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { findUserById, type UserRow } from "@/server/db/users";
import {
  deleteSessionByTokenHash,
  deleteSessionsForUser,
  findSessionByTokenHash,
  insertSession,
  touchSession,
} from "@/server/db/sessions";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const TOUCH_AFTER_MS = 60 * 60 * 1000; // 1 hour

export type ValidSession = {
  user: UserRow;
  expiresAt: number;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(
  db: Database,
  userId: string,
): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  insertSession(db, {
    id: randomUUID(),
    tokenHash,
    userId,
    expiresAt,
  });
  return { token, expiresAt };
}

export function validateSession(db: Database, token: string): ValidSession | null {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = findSessionByTokenHash(db, tokenHash);
  if (!session) return null;

  const now = Date.now();
  if (session.expires_at <= now) {
    deleteSessionByTokenHash(db, tokenHash);
    return null;
  }

  const user = findUserById(db, session.user_id);
  if (!user || user.deactivated === 1) {
    deleteSessionsForUser(db, session.user_id);
    return null;
  }

  if (now - session.last_seen_at > TOUCH_AFTER_MS) {
    const newExpiresAt = now + SESSION_TTL_MS;
    touchSession(db, tokenHash, newExpiresAt);
    return { user, expiresAt: newExpiresAt };
  }

  return { user, expiresAt: session.expires_at };
}

export function destroySession(db: Database, token: string): void {
  if (!token) return;
  deleteSessionByTokenHash(db, hashToken(token));
}

export function destroySessionsForUser(db: Database, userId: string): void {
  deleteSessionsForUser(db, userId);
}
