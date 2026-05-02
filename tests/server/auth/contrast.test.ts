import { describe, it, expect } from "vitest";
import {
  wcagContrast,
  validateAccent,
  nearestAccessible,
  LIGHT_BG,
  DARK_BG,
} from "@/server/auth/contrast";

describe("wcagContrast", () => {
  it("computes 21:1 for black on white (max contrast)", () => {
    expect(wcagContrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("computes 1:1 for the same colour on itself", () => {
    expect(wcagContrast("#777777", "#777777")).toBeCloseTo(1, 1);
  });

  it("returns a contrast ratio greater than 1 for distinct colours", () => {
    expect(wcagContrast("#595959", "#ffffff")).toBeGreaterThan(5);
  });
});

describe("validateAccent (3:1 threshold)", () => {
  it("passes light bg, fails dark bg for black", () => {
    // black on white: ~21 (passes); black on #0a0a0a: ~1 (fails).
    const r = validateAccent("#000000");
    expect(r.light.passes).toBe(true);
    expect(r.dark.passes).toBe(false);
    expect(r.passes).toBe(false);
  });

  it("passes both backgrounds for the seeded default #3b82f6 at 3:1", () => {
    // #3b82f6 has ~3.7:1 on white (passes) and ~5.4:1 on #0a0a0a (passes) — both ≥ 3.
    const r = validateAccent("#3b82f6");
    expect(r.light.passes).toBe(true);
    expect(r.dark.passes).toBe(true);
    expect(r.passes).toBe(true);
  });

  it("includes the actual ratios in the report", () => {
    const r = validateAccent("#3b82f6");
    expect(r.light.ratio).toBeGreaterThan(3);
    expect(r.dark.ratio).toBeGreaterThan(3);
  });

  it("fails for a colour too close to white in luminance", () => {
    // #f0f0f0 is very light — fails on white.
    const r = validateAccent("#f0f0f0");
    expect(r.light.passes).toBe(false);
    expect(r.passes).toBe(false);
  });
});

describe("nearestAccessible", () => {
  it("returns the input unchanged when already passing", () => {
    expect(nearestAccessible("#3b82f6")).toBe("#3b82f6");
  });

  it("returns a passing colour for a failing input — bright red", () => {
    const out = nearestAccessible("#ff5555");
    expect(validateAccent(out).passes).toBe(true);
  });

  it("returns a passing colour for a failing input — light yellow", () => {
    const out = nearestAccessible("#ffff77");
    expect(validateAccent(out).passes).toBe(true);
  });

  it("returns a passing colour for a failing input — near-white", () => {
    const out = nearestAccessible("#f0f0f0");
    expect(validateAccent(out).passes).toBe(true);
  });
});

describe("background constants", () => {
  it("exports LIGHT_BG and DARK_BG matching the design", () => {
    expect(LIGHT_BG).toBe("#ffffff");
    expect(DARK_BG).toBe("#0a0a0a");
  });
});
