import type { Database } from "better-sqlite3";

export type SessionRow = {
  id: string;
  token_hash: string;
  user_id: string;
  expires_at: number;
  created_at: number;
  last_seen_at: number;
};

export type NewSession = {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: number;
};

export function insertSession(db: Database, input: NewSession): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id, token_hash, user_id, expires_at, created_at, last_seen_at)
     VALUES (@id, @tokenHash, @userId, @expiresAt, @now, @now)`,
  ).run({ ...input, now });
}

export function findSessionByTokenHash(
  db: Database,
  tokenHash: string,
): SessionRow | null {
  return (
    (db
      .prepare("SELECT * FROM sessions WHERE token_hash = ?")
      .get(tokenHash) as SessionRow | undefined) ?? null
  );
}

export function touchSession(
  db: Database,
  tokenHash: string,
  expiresAt: number,
): void {
  db.prepare(
    "UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?",
  ).run(expiresAt, Date.now(), tokenHash);
}

export function deleteSessionByTokenHash(db: Database, tokenHash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function deleteSessionsForUser(db: Database, userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
