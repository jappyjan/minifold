import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createUser, findUserById } from "@/server/db/users";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => redirectMock(...args) }));

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-cp-actions-"));
  dbPath = join(tmp, "test.db");
  const db = createDatabase(dbPath);
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  db.close();
  vi.stubEnv("DATABASE_PATH", dbPath);
  vi.resetModules();
  redirectMock.mockReset();
});

afterEach(async () => {
  const { __resetDatabase } = await import("@/server/db");
  __resetDatabase();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

async function seedUserAndSession(username: string, password: string) {
  const { getDatabase } = await import("@/server/db");
  const db = getDatabase();
  const user = createUser(db, {
    name: username,
    username,
    passwordHash: await hashPassword(password),
    role: "user",
    mustChangePassword: true,
  });
  const { token } = createSession(db, user.id);
  return { user, token };
}

// Mock the cookie helper to return our seeded token.
function stubCookie(token: string) {
  vi.doMock("@/server/auth/cookies", () => ({
    readSessionCookie: () => Promise.resolve(token),
  }));
}

describe("changePassword", () => {
  it("rejects when the current password is wrong", async () => {
    const { token } = await seedUserAndSession("alice", "current-pw");
    stubCookie(token);
    vi.resetModules();
    const { changePassword } = await import("@/app/change-password/actions");
    const s = await changePassword({}, fd({ currentPassword: "wrong", newPassword: "longenough", confirmPassword: "longenough" }));
    expect(s.fieldErrors?.currentPassword).toBeTruthy();
  });

  it("rejects when confirmPassword does not match", async () => {
    const { token } = await seedUserAndSession("alice", "current-pw");
    stubCookie(token);
    vi.resetModules();
    const { changePassword } = await import("@/app/change-password/actions");
    const s = await changePassword({}, fd({ currentPassword: "current-pw", newPassword: "longenough", confirmPassword: "different" }));
    expect(s.fieldErrors?.confirmPassword).toBeTruthy();
  });

  it("rejects when newPassword equals currentPassword", async () => {
    const { token } = await seedUserAndSession("alice", "current-pw-long");
    stubCookie(token);
    vi.resetModules();
    const { changePassword } = await import("@/app/change-password/actions");
    const s = await changePassword({}, fd({ currentPassword: "current-pw-long", newPassword: "current-pw-long", confirmPassword: "current-pw-long" }));
    expect(s.fieldErrors?.newPassword).toBeTruthy();
  });

  it("rejects when newPassword is too short", async () => {
    const { token } = await seedUserAndSession("alice", "current-pw");
    stubCookie(token);
    vi.resetModules();
    const { changePassword } = await import("@/app/change-password/actions");
    const s = await changePassword({}, fd({ currentPassword: "current-pw", newPassword: "short", confirmPassword: "short" }));
    expect(s.fieldErrors?.newPassword).toBeTruthy();
  });

  it("on success: updates hash, clears must_change_password, deletes other sessions, keeps current", async () => {
    const { user, token } = await seedUserAndSession("alice", "current-pw");
    const { getDatabase } = await import("@/server/db");
    const db = getDatabase();
    // Seed a second session for the same user.
    createSession(db, user.id);
    expect(db.prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?").get(user.id) as { n: number }).toEqual({ n: 2 });

    stubCookie(token);
    vi.resetModules();
    const { changePassword } = await import("@/app/change-password/actions");
    await changePassword({}, fd({ currentPassword: "current-pw", newPassword: "longenough!", confirmPassword: "longenough!" }));

    const after = findUserById(db, user.id)!;
    expect(after.must_change_password).toBe(0);
    expect(await verifyPassword("longenough!", after.password)).toBe(true);
    const remaining = db.prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?").get(user.id) as { n: number };
    expect(remaining.n).toBe(1); // current session kept; the other deleted.
  });
});
