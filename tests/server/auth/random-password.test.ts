import { describe, it, expect } from "vitest";
import { generatePassword } from "@/server/auth/random-password";

describe("generatePassword", () => {
  it("returns a 16-character string by default", () => {
    expect(generatePassword()).toHaveLength(16);
  });

  it("uses the Crockford base32 alphabet (no 0/O/I/L/U)", () => {
    // 1000 samples — accumulate the union of all characters seen.
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      for (const c of generatePassword()) seen.add(c);
    }
    // None of the confusing characters should appear.
    for (const banned of ["0", "O", "I", "L", "U", "o", "i", "l", "u"]) {
      expect(seen.has(banned)).toBe(false);
    }
  });

  it("returns different values across calls (high entropy)", () => {
    const s = new Set<string>();
    for (let i = 0; i < 100; i++) s.add(generatePassword());
    expect(s.size).toBe(100);
  });
});
