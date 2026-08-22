// The party gate's shared vocabulary: the thresholds and enumerations that
// DEFINE what "passes" means, in one copy.
//
// Two programs grade levels against the gate — `tools/goomba/verify.mjs` (the
// authority) and the editor (the game's level selector, the fast loop) — and a
// verdict in the editor is only worth showing if it means the same thing the
// bench will say. These numbers used to live in both places "kept in step" by
// a comment, and the predicted drift showed up before the feature even merged
// (a hardcoded 6 where BAND_MIN was meant). So: the thresholds live here, next
// to the codec both sides already share.
//
// Deliberately NOT here: sample budgets. verify.mjs samples 30000/20000
// 2/3-band sets and the editor 12000/8000 — that difference is on purpose
// (the gate proves, the editor iterates) and each side documents its own.
import { BAND_MAX, BAND_MIN, type GoombaLevelInit, type Pt } from "./levels";

/** The finger-slop check: a solution must survive human placement. */
export const JITTER_UNITS = 3; // ± world units of slop per band end
export const JITTER_TRIALS = 30;
export const JITTER_MIN_WINS = 18; // below this, real fingers suffer
export const JITTER_SEED = 12345; // fixed, so the verdict never flickers

/** The exhaustive-search lattice for the 1-band hunt. */
export const HUNT_GRID = 10;

/**
 * The gate's deterministic PRNG — a 31-bit LCG, kept under the name the
 * design-bench tools have always used for it (it is not mulberry32; that one
 * lives in seeded.ts). Determinism is the point: the same level must always
 * get the same verdict.
 */
export const mulberry = (seed: number) => () =>
  (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

/**
 * Every legal single band on the HUNT_GRID lattice over the level bounds —
 * the search space of the exhaustive 1-band check and the pool the 2/3-band
 * samplers draw from. One copy, so "the editor's hunt came back clean" and
 * "verify.mjs check 5 passed" are statements about the same set.
 */
export function legalBands(L: GoombaLevelInit): [Pt, Pt][] {
  const b = L.bounds,
    pts: Pt[] = [];
  for (let x = b.x0; x <= b.x1; x += HUNT_GRID)
    for (let y = b.y0; y <= b.y1; y += HUNT_GRID) pts.push([x, y]);
  const legal: [Pt, Pt][] = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const len = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
      if (len >= BAND_MIN && len <= BAND_MAX) legal.push([pts[i], pts[j]]);
    }
  return legal;
}

/** One jittered copy of a solution: every band end nudged by ±JITTER_UNITS. */
export const jitterSolution = (
  sol: readonly [Pt, Pt][],
  rnd: () => number,
): [Pt, Pt][] =>
  sol.map(([a, b]) => [
    [a[0] + (rnd() * 2 - 1) * JITTER_UNITS, a[1] + (rnd() * 2 - 1) * JITTER_UNITS],
    [b[0] + (rnd() * 2 - 1) * JITTER_UNITS, b[1] + (rnd() * 2 - 1) * JITTER_UNITS],
  ]);
