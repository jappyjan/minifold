#!/usr/bin/env node
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

function createDb(path) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function usage() {
  console.log(`minifold — admin CLI

Commands:
  list-users                              List all users.
  reset-admin   --username <name>         Reset the password for an admin user (creates one if missing).
  promote       --username <name>         Promote a user to admin.
  demote        --username <name>         Demote an admin to user (refuses if last admin).
  delete-user   --username <name>         Delete a user (refuses if last admin).

Environment:
  DATABASE_PATH   Path to the SQLite DB. Defaults to /app/data/minifold.db in the image,
                  or ./data/minifold.db locally.
`);
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = args[i + 1];
      i++;
    }
  }
  return out;
}

function dbPath() {
  return (
    process.env.DATABASE_PATH ?? resolve(process.cwd(), "data/minifold.db")
  );
}

function randomPassword() {
  // 24 chars of base64url.
  return randomBytes(18).toString("base64url");
}

function findByUsername(db, username) {
  return db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username.toLowerCase());
}

function countAdmins(db) {
  const row = db
    .prepare("SELECT COUNT(*) as n FROM users WHERE role = 'admin'")
    .get();
  return row.n;
}

function cmdListUsers(db) {
  const rows = db
    .prepare("SELECT id, username, role, deactivated, last_login FROM users ORDER BY created_at")
    .all();
  if (rows.length === 0) {
    console.log("No users.");
    return 0;
  }
  console.log(["USERNAME", "ROLE", "DEACTIVATED", "LAST_LOGIN", "ID"].join("\t"));
  for (const r of rows) {
    console.log(
      [
        r.username,
        r.role,
        r.deactivated ? "yes" : "no",
        r.last_login ? new Date(r.last_login).toISOString() : "-",
        r.id,
      ].join("\t"),
    );
  }
  return 0;
}

async function cmdResetAdmin(db, username) {
  if (!username) {
    console.error("--username is required");
    return 2;
  }
  const newPassword = randomPassword();
  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const existing = findByUsername(db, username);
  if (existing) {
    db.prepare(
      "UPDATE users SET password = ?, role = 'admin', must_change_password = 1, deactivated = 0 WHERE id = ?",
    ).run(hash, existing.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
  } else {
    const id = randomBytes(16).toString("hex").replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
      "$1-$2-$3-$4-$5",
    );
    db.prepare(
      `INSERT INTO users (id, name, username, password, role, must_change_password, deactivated, created_at, last_login)
       VALUES (?, ?, ?, ?, 'admin', 1, 0, ?, NULL)`,
    ).run(id, username.toLowerCase(), username.toLowerCase(), hash, Date.now());
  }
  console.log(`Admin username: ${username.toLowerCase()}`);
  console.log(`New password: ${newPassword}`);
  console.log("(The user will be asked to change this on next login.)");
  return 0;
}

function cmdPromote(db, username) {
  if (!username) {
    console.error("--username is required");
    return 2;
  }
  const user = findByUsername(db, username);
  if (!user) {
    console.error(`No such user: ${username}`);
    return 1;
  }
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
  console.log(`${username} is now an admin.`);
  return 0;
}

function cmdDemote(db, username) {
  if (!username) {
    console.error("--username is required");
    return 2;
  }
  const user = findByUsername(db, username);
  if (!user) {
    console.error(`No such user: ${username}`);
    return 1;
  }
  if (user.role !== "admin") {
    console.log(`${username} is already a non-admin.`);
    return 0;
  }
  if (countAdmins(db) <= 1) {
    console.error("Refusing to demote the last admin.");
    return 1;
  }
  db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(user.id);
  console.log(`${username} is now a regular user.`);
  return 0;
}

function cmdDeleteUser(db, username) {
  if (!username) {
    console.error("--username is required");
    return 2;
  }
  const user = findByUsername(db, username);
  if (!user) {
    console.error(`No such user: ${username}`);
    return 1;
  }
  if (user.role === "admin" && countAdmins(db) <= 1) {
    console.error("Refusing to delete the last admin.");
    return 1;
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  console.log(`Deleted ${username}.`);
  return 0;
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd) {
    usage();
    return 0;
  }
  const flags = parseFlags(rest);
  const db = createDb(dbPath());
  try {
    switch (cmd) {
      case "list-users":
        return cmdListUsers(db);
      case "reset-admin":
        return await cmdResetAdmin(db, flags.username);
      case "promote":
        return cmdPromote(db, flags.username);
      case "demote":
        return cmdDemote(db, flags.username);
      case "delete-user":
        return cmdDeleteUser(db, flags.username);
      case "--help":
      case "help":
        usage();
        return 0;
      default:
        console.error(`Unknown command: ${cmd}`);
        usage();
        return 2;
    }
  } finally {
    db.close();
  }
}

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(err?.stack ?? err);
    process.exit(1);
  },
);
