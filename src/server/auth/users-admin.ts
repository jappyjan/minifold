import type { Database } from "better-sqlite3";
import {
  createUser as dbCreateUser,
  deleteUser as dbDeleteUser,
  findUserById,
  updateUserPassword,
  updateUserRole,
  type UserRow,
} from "@/server/db/users";
import { destroySessionsForUser } from "@/server/auth/session";
import { hashPassword } from "@/server/auth/password";
import { generatePassword } from "@/server/auth/random-password";

export class LastAdminError extends Error {
  constructor(action: string) {
    super(`Refusing to ${action}: would orphan the last active admin`);
    this.name = "LastAdminError";
  }
}

function countActiveAdmins(db: Database): number {
  const row = db
    .prepare("SELECT COUNT(*) as n FROM users WHERE role = 'admin' AND deactivated = 0")
    .get() as { n: number };
  return row.n;
}

function setDeactivated(db: Database, id: string, value: 0 | 1): void {
  db.prepare("UPDATE users SET deactivated = ? WHERE id = ?").run(value, id);
}

export type AddUserInput =
  | { name: string; username: string; mode: "manual"; password: string }
  | { name: string; username: string; mode: "generate" };

export async function addUser(
  db: Database,
  input: AddUserInput,
): Promise<{ user: UserRow; generatedPassword?: string }> {
  let plain: string;
  let generated: string | undefined;
  if (input.mode === "manual") {
    plain = input.password;
  } else {
    generated = generatePassword();
    plain = generated;
  }
  const passwordHash = await hashPassword(plain);
  const user = dbCreateUser(db, {
    name: input.name,
    username: input.username,
    passwordHash,
    role: "user",
    mustChangePassword: true,
  });
  return { user, generatedPassword: generated };
}

export function deactivateUserAdmin(db: Database, id: string): void {
  const user = findUserById(db, id);
  if (!user) return;
  if (user.role === "admin" && user.deactivated === 0 && countActiveAdmins(db) <= 1) {
    throw new LastAdminError("deactivate");
  }
  setDeactivated(db, id, 1);
  destroySessionsForUser(db, id);
}

export function activateUserAdmin(db: Database, id: string): void {
  setDeactivated(db, id, 0);
}

export function deleteUserAdmin(db: Database, id: string): void {
  const user = findUserById(db, id);
  if (!user) return;
  if (user.role === "admin" && user.deactivated === 0 && countActiveAdmins(db) <= 1) {
    throw new LastAdminError("delete");
  }
  dbDeleteUser(db, id);
}

export function promoteUserAdmin(db: Database, id: string): void {
  updateUserRole(db, id, "admin");
}

export function demoteUserAdmin(db: Database, id: string): void {
  const user = findUserById(db, id);
  if (!user) return;
  if (user.role === "admin" && user.deactivated === 0 && countActiveAdmins(db) <= 1) {
    throw new LastAdminError("demote");
  }
  updateUserRole(db, id, "user");
}

export async function resetUserPasswordAdmin(
  db: Database,
  id: string,
): Promise<{ generatedPassword: string }> {
  const generated = generatePassword();
  const passwordHash = await hashPassword(generated);
  updateUserPassword(db, id, passwordHash, { mustChangePassword: true });
  destroySessionsForUser(db, id);
  return { generatedPassword: generated };
}
