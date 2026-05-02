import { randomBytes } from "node:crypto";

// Crockford base32 minus 0, I, L, O, U — 31 chars (no confusing 0/I/L/O/U).
// Note: Crockford excludes I, L, O, U; we additionally exclude 0 because
// the spec says "no confusing 0/O/l/1" — visually 0 and O are the same.
const ALPHABET = "123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 31 chars

export function generatePassword(length = 16): string {
  if (length <= 0) throw new Error("generatePassword: length must be > 0");
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[i] ?? 0;
    out += ALPHABET[byte % ALPHABET.length] ?? "";
  }
  return out;
}
