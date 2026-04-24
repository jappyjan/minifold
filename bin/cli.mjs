#!/usr/bin/env node
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const BCRYPT_COST = 10;
const MIGRATIONS_DIR = resolve(process.cwd(), "src/server/db/migrations");

function createDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

function runMigrations(db, dir) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const isApplied = db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?");
  const record = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );
  for (const file of files) {
    if (isApplied.get(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      record.run(file, Date.now());
    });
    tx();
  }
}

const SLUG_RE = /^[a-z0-9-]{1,32}$/i;
const KEY_SETTING = "config_encryption_key";

function getSetting(db, key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row?.value ?? null;
}

function setSetting(db, key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

function loadOrCreateKey(db) {
  const existing = getSetting(db, KEY_SETTING);
  if (existing) return Buffer.from(existing, "base64");
  const generated = randomBytes(32);
  setSetting(db, KEY_SETTING, generated.toString("base64"));
  return generated;
}

function encryptJSON(db, plain) {
  const key = loadOrCreateKey(db);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(plain), "utf8")),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${enc.toString("hex")}`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function decryptJSON(db, payload) {
  const [ivHex, tagHex, encHex] = payload.split(":");
  if (!ivHex || !tagHex || !encHex) throw new Error("decryptJSON: malformed");
  const key = loadOrCreateKey(db);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encHex, "hex")),
    decipher.final(),
  ]);
  return JSON.parse(dec.toString("utf8"));
}

function usage() {
  console.log(`minifold — admin CLI

User commands:
  list-users                              List all users.
  reset-admin   --username <name>         Reset the password for an admin user (creates one if missing).
  promote       --username <name>         Promote a user to admin.
  demote        --username <name>         Demote an admin to user (refuses if last admin).
  delete-user   --username <name>         Delete a user (refuses if last admin).

Provider commands:
  list-providers                          List configured storage providers.
  add-provider  --name <n> --root-path <p> [--slug <s>]
                                          Add a local-FS provider. Slug auto-
                                          generated from name if omitted.
  remove-provider --slug <s>              Remove a provider.

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

function cmdListProviders(db) {
  const rows = db
    .prepare("SELECT slug, name, type, position, created_at FROM providers ORDER BY position, created_at")
    .all();
  if (rows.length === 0) {
    console.log("No providers.");
    return 0;
  }
  console.log(["SLUG", "NAME", "TYPE", "POSITION", "CREATED"].join("\t"));
  for (const r of rows) {
    console.log(
      [
        r.slug,
        r.name,
        r.type,
        r.position,
        new Date(r.created_at).toISOString(),
      ].join("\t"),
    );
  }
  return 0;
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function generateUniqueSlug(db, name) {
  const base = slugify(name) || "provider";
  const exists = db.prepare("SELECT 1 FROM providers WHERE slug = ?");
  if (!exists.get(base)) return base;
  for (let suffix = 2; suffix <= 999; suffix++) {
    const tail = `-${suffix}`;
    const allowed = 32 - tail.length;
    const trimmed = base.length > allowed ? base.slice(0, allowed) : base;
    const candidate = `${trimmed}${tail}`;
    if (!exists.get(candidate)) return candidate;
  }
  throw new Error("generateUniqueSlug: too many collisions");
}

function cmdAddProvider(db, flags) {
  if (!flags.name) {
    console.error("--name is required");
    return 2;
  }
  if (!flags["root-path"]) {
    console.error("--root-path is required");
    return 2;
  }

  let slug;
  if (flags.slug) {
    if (!SLUG_RE.test(flags.slug)) {
      console.error("--slug must match /^[a-z0-9-]{1,32}$/i");
      return 2;
    }
    slug = flags.slug.toLowerCase();
    const existing = db.prepare("SELECT 1 FROM providers WHERE slug = ?").get(slug);
    if (existing) {
      console.error(`Provider slug already exists: ${slug}`);
      return 1;
    }
  } else {
    slug = generateUniqueSlug(db, flags.name);
  }

  const encrypted = encryptJSON(db, { rootPath: flags["root-path"] });
  const now = Date.now();
  db.prepare(
    `INSERT INTO providers (slug, name, type, config, position, created_at)
     VALUES (?, ?, 'local', ?, 0, ?)`,
  ).run(slug, flags.name, encrypted, now);
  console.log(`Added provider ${slug} (${flags.name}) → ${flags["root-path"]}`);
  return 0;
}

function cmdRemoveProvider(db, slug) {
  if (!slug) {
    console.error("--slug is required");
    return 2;
  }
  const found = db
    .prepare("SELECT 1 FROM providers WHERE slug = ?")
    .get(slug.toLowerCase());
  if (!found) {
    console.error(`No such provider: ${slug}`);
    return 1;
  }
  db.prepare("DELETE FROM providers WHERE slug = ?").run(slug.toLowerCase());
  console.log(`Removed provider ${slug}.`);
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
      case "list-providers":
        return cmdListProviders(db);
      case "add-provider":
        return cmdAddProvider(db, flags);
      case "remove-provider":
        return cmdRemoveProvider(db, flags.slug);
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
