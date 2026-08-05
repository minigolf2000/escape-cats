// Debug-mode jump presets: one press lands the game at a story beat, with the
// state a real run would plausibly hold there. Ported from the frozen
// prototype's DEV_PRESETS and RE-DERIVED against the shipped economy — the
// prototype's `finale`/`legible` owned 58 of a fourth night tier (`nested`)
// that the three-tier night deleted, so their numbers are recomputed here, not
// copied. Debug-only: nothing on the wire or in the server ever reads these.
//
// The night ladder math these lean on (see rules.ts wallCoverage): the full
// trail ladder is 26+38+52+64 = 180 units. Without Scent Trail that yields
// coverage ~1.46 — visibly dense but short of LEGIBLE_COV 1.6 — and with its
// persist 60 it clears ~1.81. So `finale` (everything but Scent Trail) is
// deliberately NOT legible with the word one purchase away, and `legible` is
// past it. The full 33-mouse wall needs lifetime total ≥ ~1.51e6
// (mouseBase * mouseR^32); every night preset here is comfortably above it.

import { UPGRADES, type HexUpgrade } from "./data";
import { unlockMet, WALL_EFFECTS, type HexCore } from "./rules";

export interface HexPreset {
  total: number;
  mice: number;
  clicks?: number;
  golden?: number;
  owned?: Record<string, number>;
  bought?: string[];
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
  // THE WALL OPENS. Night lifetime is deliberately small — the ramp is still
  // filling, so this is a dozen anonymous white specks over an unlit scene,
  // which is what the phase actually looks like for its first half minute. No
  // day buildings: the flip wipes them (see nightReset). The bank clears Lucid
  // Dreaming I's 50k, so the next beat is one press away too.
  night: {
    total: 30000, mice: 120000, clicks: 550, golden: 3,
    owned: { portal: 10, spindle: 3 },
    bought: ["catnap"],
  },
  // ONE PURCHASE FROM COUNTING MICE, the twist inside the twist. Both early
  // Lucid Dreaming rungs are in, so the wall draws at trail 64 — about half
  // the coverage the word needs — and the bank clears 1.15M.
  mice: {
    total: 1.6e6, mice: 1.4e6, clicks: 900, golden: 5,
    owned: { portal: 25, spindle: 12, delta: 4 },
    bought: ["catnap", "paperlantern", "luciddreaming"],
  },
  // ONE PURCHASE FROM THE END. Every night row but Scent Trail; the bank
  // clears its 60M. Coverage ~1.46 — dense, unreadable, one press from both
  // closing beats at once (the ink stops fading; the rail empties).
  // Totals sit inside the three-tier night's ~103M lifetime money supply.
  finale: {
    total: 90e6, mice: 62e6, clicks: 1200, golden: 8,
    owned: { portal: 60, spindle: 40, delta: 30 },
    bought: [
      "catnap", "paperlantern", "luciddreaming", "countingmice",
      "deepsleep", "lucky6", "remsleep",
    ],
  },
  // AFTER it: the finished night. The whole ladder bought, coverage ~1.81, so
  // the wall holds a readable TO THE MOON and the shop is closed for good.
  legible: {
    total: 103e6, mice: 5e6, clicks: 1400, golden: 8,
    owned: { portal: 60, spindle: 40, delta: 30 },
    bought: [
      "catnap", "paperlantern", "luciddreaming", "countingmice",
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

/** Presets list buildings, counters and STORY rows only. The ordinary upgrades
 * a save in this state would hold are derived: unlock conditions met, paid out
 * of a share of lifetime earnings. A hand-written list rotted on every retune.
 *
 * Spends from a SHARED budget, cheapest affordable row first, until the money
 * runs out. Testing each row against the budget independently instead bought
 * every row under the threshold — several times the budget in total, a state
 * no real save reaches. Cheapest-first also resolves `requires` chains for
 * free: each purchase can make the next row eligible, and the scan reruns. */
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
