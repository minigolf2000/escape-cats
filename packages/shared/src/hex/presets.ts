// Debug-mode jump presets: one press lands the game at a story beat with the
// state a real run would plausibly hold there. Debug-only: no intent reads
// these.
//
// The night math (rules.ts wallCoverage): the full trail ladder is 34+50+68+84
// = 236 units, ~1.53 coverage without Scent Trail (short of LEGIBLE_COV 1.6)
// and ~1.81 with its persist 60. So `finale` is deliberately NOT legible and
// `legible` is. Coverage is a function of the PURCHASES a preset carries only.

import { UPGRADES, type HexUpgrade } from "./data";
import { unlockMet, WALL_EFFECTS, type HexCore } from "./rules";

export interface HexPreset {
  total: number;
  mice: number;
  clicks?: number;
  golden?: number;
  owned?: Record<string, number>;
  bought?: string[];
  /** Describe the DAY this state came out of and let applyPreset run the same
   * nightReset the purchase runs. A night preset written directly cannot reach
   * the state the twist leaves: the wipe is what makes it. */
  twist?: boolean;
}

export const DEBUG_PRESETS: Record<string, HexPreset> = {
  // The opening: Hex awake in the sunburst, an empty shop, nothing earned.
  day: { total: 0, mice: 0, clicks: 0 },
  // Mid-day, the shop busy and the building tiers climbing — the day at full tilt.
  midday: {
    total: 30000, mice: 12000, clicks: 220,
    owned: { shopper: 18, farm: 20 },
  },
  // ONE PURCHASE FROM THE TWIST. A Lab is owned, so Catnap Hypnalysis is on the
  // rail, and the bank clears its 1M — press it and the night cutscene plays.
  catnap: {
    total: 1500000, mice: 1200000, clicks: 1100,
    owned: { shopper: 30, farm: 35, factory: 12, lab: 1 },
  },
  // THE WALL OPENS, UNLIT: 33 anonymous specks at a third brightness and a
  // quarter speed. Paper Lantern is deliberately NOT in `bought` — the only
  // night preset without it — because the first thing this state has to earn is
  // the light (the hand-over itself only plays on a real purchase). Written as
  // THE DAY IT CAME OUT OF plus `twist`, so the jump lands exactly where
  // pressing Catnap Hypnalysis lands and stays there as the ladder is retuned:
  // broke, lifetime zero, day buildings gone, day upgrades kept, one free Hole.
  // Not written as a night state directly: night buildings refill the bank in
  // seconds, and this is the one beat that is ABOUT being broke.
  night: {
    total: 1500000, mice: 1200000, clicks: 1100, golden: 3,
    owned: { shopper: 30, farm: 35, factory: 12, lab: 1 },
    bought: ["catnap"],
    twist: true,
  },
  // ONE PURCHASE FROM COUNTING MICE, the twist inside the twist. Both early
  // Lucid Dreaming rungs are in, so the wall draws at trail 84 — about a third
  // of the coverage the word needs — and the bank clears 1.15M.
  mice: {
    total: 1.6e6, mice: 1.4e6, clicks: 900, golden: 5,
    owned: { portal: 25, spindle: 12, delta: 4 },
    bought: ["catnap", "lantern", "paperlantern", "luciddreaming"],
  },
  // ONE PURCHASE FROM THE END. Every night row but Scent Trail; the bank
  // clears its 60M. Coverage ~1.53 — dense, unreadable, one press from both
  // closing beats at once (the ink stops fading; the rail empties).
  // Totals sit inside the three-tier night's ~103M lifetime money supply.
  finale: {
    total: 90e6, mice: 62e6, clicks: 1200, golden: 8,
    owned: { portal: 60, spindle: 40, delta: 30 },
    bought: [
      "catnap", "lantern", "paperlantern", "luciddreaming", "countingmice",
      "deepsleep", "lucky6", "remsleep",
    ],
  },
  // AFTER it: the finished night. The whole ladder bought, coverage ~1.81, so
  // the wall holds a readable TO THE MOON and the shop is closed for good.
  legible: {
    total: 103e6, mice: 5e6, clicks: 1400, golden: 8,
    owned: { portal: 60, spindle: 40, delta: 30 },
    bought: [
      "catnap", "lantern", "paperlantern", "luciddreaming", "countingmice",
      "deepsleep", "lucky6", "remsleep", "hypnagogia",
    ],
  },
};

// Story rows flip the phase or draw the wall; a preset must own exactly the
// ones it names, or jumping to `midday` would silently carry night into day.
const isStoryUpgrade = (u: HexUpgrade) =>
  ([] as { type: string }[])
    .concat(u.effect)
    .some((e) => e.type === "night" || WALL_EFFECTS.has(e.type));

/** Presets list buildings, counters and STORY rows only; the ordinary upgrades
 * are derived (a hand-written list rots on every retune). Spends a SHARED
 * budget cheapest-affordable-first until it runs out — testing each row against
 * the budget independently buys several times the budget — and rescans after
 * each purchase, which resolves `requires` chains for free. */
export const DEBUG_BOUGHT_SHARE = 0.25;
export function debugDerivedBought(core: HexCore): void {
  let budget = core.total * DEBUG_BOUGHT_SHARE;
  for (;;) {
    let next: HexUpgrade | null = null;
    for (const u of UPGRADES) {
      if (core.bought[u.key] || isStoryUpgrade(u) || u.cost > budget) continue;
      if (next && u.cost >= next.cost) continue;
      if (!unlockMet(u, core)) continue;
      next = u;
    }
    if (!next) return;
    core.bought[next.key] = 1;
    budget -= next.cost;
  }
}
