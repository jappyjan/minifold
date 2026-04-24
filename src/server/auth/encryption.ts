import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";
import { getSetting, setSetting } from "@/server/db/settings";

const KEY_SETTING = "config_encryption_key";
const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function loadOrCreateKey(db: Database): Buffer {
  const existing = getSetting(db, KEY_SETTING);
  if (existing) return Buffer.from(existing, "base64");

  const generated = randomBytes(KEY_LENGTH);
  setSetting(db, KEY_SETTING, generated.toString("base64"));
  const canonical = getSetting(db, KEY_SETTING);
  if (!canonical) throw new Error("encryption: failed to persist key");
  return Buffer.from(canonical, "base64");
}

export function encryptJSON(db: Database, plain: unknown): string {
  const key = loadOrCreateKey(db);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const json = Buffer.from(JSON.stringify(plain), "utf8");
  const enc = Buffer.concat([cipher.update(json), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptJSON<T = unknown>(db: Database, payload: string): T {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("decryptJSON: malformed payload");
  const [ivHex, tagHex, encHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  if (iv.length !== IV_LENGTH) throw new Error("decryptJSON: bad IV length");

  const key = loadOrCreateKey(db);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}
