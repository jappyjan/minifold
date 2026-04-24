import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type Role = "admin" | "user";

export type UserRow = {
  id: string;
  name: string;
  username: string;
  password: string;
  role: Role;
  must_change_password: 0 | 1;
  deactivated: 0 | 1;
  created_at: number;
  last_login: number | null;
};

export type NewUser = {
  name: string;
  username: string;
  passwordHash: string;
  role: Role;
  mustChangePassword: boolean;
};

export function hasAnyAdmin(db: Database): boolean {
  return (
    db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get() !== undefined
  );
}

export function createUser(db: Database, input: NewUser): UserRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, name, username, password, role, must_change_password, deactivated, created_at, last_login)
     VALUES (@id, @name, @username, @password, @role, @mcp, 0, @now, NULL)`,
  ).run({
    id,
    name: input.name,
    username: input.username.toLowerCase(),
    password: input.passwordHash,
    role: input.role,
    mcp: input.mustChangePassword ? 1 : 0,
    now,
  });
  const row = findUserById(db, id);
  if (!row) throw new Error("createUser: inserted row not found");
  return row;
}

export function findUserByUsername(db: Database, username: string): UserRow | null {
  return (
    (db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username.toLowerCase()) as UserRow | undefined) ?? null
  );
}

export function findUserById(db: Database, id: string): UserRow | null {
  return (
    (db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined) ??
    null
  );
}

export function setLastLogin(db: Database, id: string): void {
  db.prepare("UPDATE users SET last_login = ? WHERE id = ?").run(Date.now(), id);
}

export function updateUserPassword(
  db: Database,
  id: string,
  passwordHash: string,
  opts: { mustChangePassword: boolean },
): void {
  db.prepare(
    "UPDATE users SET password = ?, must_change_password = ? WHERE id = ?",
  ).run(passwordHash, opts.mustChangePassword ? 1 : 0, id);
}

export function updateUserRole(db: Database, id: string, role: Role): void {
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
}

export function deleteUser(db: Database, id: string): void {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

export function listUsers(db: Database): UserRow[] {
  return db
    .prepare("SELECT * FROM users ORDER BY created_at ASC")
    .all() as UserRow[];
}
