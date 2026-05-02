import chroma from "chroma-js";

export const LIGHT_BG = "#ffffff";
export const DARK_BG = "#0a0a0a";
// 3:1 — WCAG 1.4.11 Non-text Contrast (UI components / AA Large).
// Accent colour is used for buttons, focus rings, etc. — not normal text.
// 4.5:1 against both bgs is mathematically unsatisfiable; see spec §6.
const AA_THRESHOLD = 3.0;
const FALLBACK = "#3b82f6";

export function wcagContrast(foreground: string, background: string): number {
  return chroma.contrast(foreground, background);
}

export type ContrastReport = {
  light: { ratio: number; passes: boolean };
  dark: { ratio: number; passes: boolean };
  passes: boolean;
};

export function validateAccent(color: string): ContrastReport {
  const lightRatio = wcagContrast(color, LIGHT_BG);
  const darkRatio = wcagContrast(color, DARK_BG);
  const lightPasses = lightRatio >= AA_THRESHOLD;
  const darkPasses = darkRatio >= AA_THRESHOLD;
  return {
    light: { ratio: lightRatio, passes: lightPasses },
    dark: { ratio: darkRatio, passes: darkPasses },
    passes: lightPasses && darkPasses,
  };
}

/**
 * Walks OKLCH lightness in both directions, returning the passing candidate
 * closest to the original by Euclidean distance in OKLCH space.
 * Falls back to FALLBACK if no value within the full range passes both backgrounds.
 */
export function nearestAccessible(color: string): string {
  const original = chroma(color);
  if (validateAccent(color).passes) return original.hex();

  const [oL, oC, oH] = original.oklch();
  const STEP = 0.02;
  const MAX_ITERS = 100;

  let best: { hex: string; dist: number } | null = null;

  for (const direction of [-1, 1]) {
    for (let i = 1; i <= MAX_ITERS; i++) {
      const newL = oL + direction * STEP * i;
      if (newL < 0 || newL > 1) break;
      // chroma-js OKLCH may produce NaN hue for very desaturated colours; default to 0.
      const candidate = chroma.oklch(newL, oC, Number.isNaN(oH) ? 0 : oH);
      if (!validateAccent(candidate.hex()).passes) continue;
      const [cL, cC, cH] = candidate.oklch();
      const dh = Number.isNaN(cH) || Number.isNaN(oH) ? 0 : cH - oH;
      const dist = Math.sqrt((cL - oL) ** 2 + (cC - oC) ** 2 + (dh / 360) ** 2);
      if (best === null || dist < best.dist) {
        best = { hex: candidate.hex(), dist };
      }
      break; // first passing in this direction is closest in this direction
    }
  }

  return best?.hex ?? FALLBACK;
}
