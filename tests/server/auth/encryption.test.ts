import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { getSetting } from "@/server/db/settings";
import { decryptJSON, encryptJSON } from "@/server/auth/encryption";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-enc-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("encryption", () => {
  it("encrypt + decrypt roundtrip", () => {
    const plain = { secret: "hunter2", n: 42 };
    const cipher = encryptJSON(db, plain);
    expect(cipher).not.toContain("hunter2");
    expect(decryptJSON(db, cipher)).toEqual(plain);
  });

  it("generates and persists an encryption key on first use", () => {
    expect(getSetting(db, "config_encryption_key")).toBeNull();
    encryptJSON(db, { x: 1 });
    const key = getSetting(db, "config_encryption_key");
    expect(key).toMatch(/^[A-Za-z0-9+/=]{40,}$/); // base64
  });

  it("two encryptions of the same plaintext produce different ciphertexts (random IV)", () => {
    const a = encryptJSON(db, { x: 1 });
    const b = encryptJSON(db, { x: 1 });
    expect(a).not.toBe(b);
  });

  it("reuses the same key across calls", () => {
    const a = encryptJSON(db, { x: 1 });
    const keyAfterFirst = getSetting(db, "config_encryption_key");
    const b = encryptJSON(db, { x: 2 });
    const keyAfterSecond = getSetting(db, "config_encryption_key");
    expect(keyAfterFirst).toBe(keyAfterSecond);
    expect(decryptJSON(db, a)).toEqual({ x: 1 });
    expect(decryptJSON(db, b)).toEqual({ x: 2 });
  });

  it("decryptJSON throws on tampered ciphertext", () => {
    const cipher = encryptJSON(db, { x: 1 });
    const parts = cipher.split(":");
    // Flip the first hex char of the ciphertext to a guaranteed-different value.
    const firstChar = parts[2]![0]!;
    const flippedChar = firstChar === "0" ? "1" : "0";
    const tampered = `${parts[0]}:${parts[1]}:${flippedChar}${parts[2]!.slice(1)}`;
    expect(() => decryptJSON(db, tampered)).toThrow();
  });

  it("decryptJSON throws on malformed input", () => {
    expect(() => decryptJSON(db, "not-a-valid-ciphertext")).toThrow();
  });
});
