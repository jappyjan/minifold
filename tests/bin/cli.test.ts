import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createUser, findUserByUsername } from "@/server/db/users";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";

const CLI = resolve(process.cwd(), "bin/cli.mjs");

let tmp: string;
let dbPath: string;
let db: Database;

async function seedAdmin(username: string, plain: string) {
  const hash = await hashPassword(plain);
  return createUser(db, {
    name: "Seed",
    username,
    passwordHash: hash,
    role: "admin",
    mustChangePassword: false,
  });
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-cli-"));
  dbPath = join(tmp, "test.db");
  db = createDatabase(dbPath);
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function run(args: string[]) {
  return spawnSync("node", [CLI, ...args], {
    env: { ...process.env, DATABASE_PATH: dbPath },
    encoding: "utf8",
  });
}

describe("minifold CLI", () => {
  it("list-users prints an empty notice when the DB is empty", () => {
    const r = run(["list-users"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no users/i);
  });

  it("list-users prints a table of users", async () => {
    await seedAdmin("admin", "original-password");
    const r = run(["list-users"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("admin");
  });

  it("reset-admin updates the password, promotes to admin, and prints the new password", async () => {
    await seedAdmin("admin", "original-password");
    createSession(db, findUserByUsername(db, "admin")!.id);

    const r = run(["reset-admin", "--username", "admin"]);
    expect(r.status).toBe(0);
    const match = r.stdout.match(/New password: (\S+)/);
    expect(match).not.toBeNull();
    const newPassword = match![1]!;

    const user = findUserByUsername(db, "admin")!;
    expect(user.role).toBe("admin");
    expect(user.must_change_password).toBe(1);
    expect(await verifyPassword(newPassword, user.password)).toBe(true);
    expect(await verifyPassword("original-password", user.password)).toBe(false);

    const remaining = db
      .prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?")
      .get(user.id) as { n: number };
    expect(remaining.n).toBe(0);
  });

  it("reset-admin creates the admin if the username does not exist", () => {
    const r = run(["reset-admin", "--username", "newadmin"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/New password:/);
    const user = findUserByUsername(db, "newadmin")!;
    expect(user).toBeDefined();
    expect(user.role).toBe("admin");
  });

  it("promote turns a 'user' into 'admin'", async () => {
    createUser(db, {
      name: "Bob",
      username: "bob",
      passwordHash: await hashPassword("x"),
      role: "user",
      mustChangePassword: false,
    });
    const r = run(["promote", "--username", "bob"]);
    expect(r.status).toBe(0);
    expect(findUserByUsername(db, "bob")?.role).toBe("admin");
  });

  it("demote refuses to remove the last admin", async () => {
    await seedAdmin("admin", "pw");
    const r = run(["demote", "--username", "admin"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("last admin");
    expect(findUserByUsername(db, "admin")?.role).toBe("admin");
  });

  it("demote works when another admin exists", async () => {
    await seedAdmin("alice", "pw");
    await seedAdmin("bob", "pw");
    const r = run(["demote", "--username", "bob"]);
    expect(r.status).toBe(0);
    expect(findUserByUsername(db, "bob")?.role).toBe("user");
  });

  it("delete-user removes the user and cascades sessions", async () => {
    const u = await seedAdmin("alice", "pw");
    await seedAdmin("bob", "pw");
    createSession(db, u.id);
    const r = run(["delete-user", "--username", "alice"]);
    expect(r.status).toBe(0);
    expect(findUserByUsername(db, "alice")).toBeNull();
    const n = db
      .prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?")
      .get(u.id) as { n: number };
    expect(n.n).toBe(0);
  });

  it("delete-user refuses to delete the last admin", async () => {
    await seedAdmin("alice", "pw");
    const r = run(["delete-user", "--username", "alice"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("last admin");
    expect(findUserByUsername(db, "alice")).not.toBeNull();
  });

  it("prints help when invoked with no args", () => {
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/commands:/i);
    expect(r.stdout).toMatch(/reset-admin/);
  });
});

describe("minifold CLI — providers", () => {
  it("list-providers prints an empty notice when none exist", () => {
    const r = run(["list-providers"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no providers/i);
  });

  it("add-provider creates a local provider and list-providers shows it", () => {
    const added = run([
      "add-provider",
      "--slug",
      "nas",
      "--name",
      "NAS",
      "--root-path",
      "/files",
    ]);
    expect(added.status).toBe(0);
    expect(added.stdout).toMatch(/added provider/i);

    const listed = run(["list-providers"]);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain("nas");
    expect(listed.stdout).toContain("NAS");
    expect(listed.stdout).toContain("local");
  });

  it("add-provider auto-generates a slug when --slug is omitted", () => {
    const r = run([
      "add-provider",
      "--name",
      "NAS Files",
      "--root-path",
      "/files",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/nas-files/);

    const listed = run(["list-providers"]);
    expect(listed.stdout).toContain("nas-files");
    expect(listed.stdout).toContain("NAS Files");
  });

  it("add-provider auto-suffixes when the slug derived from name collides", () => {
    run(["add-provider", "--name", "NAS", "--root-path", "/a"]);
    const r = run(["add-provider", "--name", "nas", "--root-path", "/b"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/nas-2/);
  });

  it("add-provider still requires --name", () => {
    const r = run(["add-provider", "--root-path", "/x"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("--name");
  });

  it("add-provider still requires --root-path", () => {
    const r = run(["add-provider", "--name", "x"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("--root-path");
  });

  it("add-provider rejects invalid slugs", () => {
    const r = run([
      "add-provider",
      "--slug",
      "Bad Slug!",
      "--name",
      "x",
      "--root-path",
      "/x",
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("slug");
  });

  it("add-provider rejects duplicate slug", () => {
    run(["add-provider", "--slug", "nas", "--name", "NAS", "--root-path", "/files"]);
    const second = run([
      "add-provider",
      "--slug",
      "nas",
      "--name",
      "NAS2",
      "--root-path",
      "/other",
    ]);
    expect(second.status).not.toBe(0);
    expect(second.stderr.toLowerCase()).toMatch(/exists|unique/);
  });

  it("remove-provider deletes it", () => {
    run(["add-provider", "--slug", "nas", "--name", "NAS", "--root-path", "/files"]);
    const removed = run(["remove-provider", "--slug", "nas"]);
    expect(removed.status).toBe(0);
    expect(run(["list-providers"]).stdout).toMatch(/no providers/i);
  });

  it("remove-provider on unknown slug fails", () => {
    const r = run(["remove-provider", "--slug", "nope"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("no such provider");
  });
});
