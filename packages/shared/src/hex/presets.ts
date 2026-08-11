// Debug-mode jump presets: one press lands the game at a story beat, with the
// state a real run would plausibly hold there. Ported from the frozen
// prototype's DEV_PRESETS and RE-DERIVED against the shipped economy — the
// prototype's `finale`/`legible` owned 58 of a fourth night tier (`nested`)
// that the three-tier night deleted, so their numbers are recomputed here, not
// copied. Debug-only: nothing on the wire or in the server ever reads these.
//
// The night ladder math these lean on (see rules.ts wallCoverage): the full
// trail ladder is 34+50+68+84 = 236 units. Without Scent Trail that yields
// coverage ~1.53 — visibly dense but short of LEGIBLE_COV 1.6 — and with its
// persist 60 it clears ~1.81. So `finale` (everything but Scent Trail) is
// deliberately NOT legible with the word one purchase away, and `legible` is
// past it. Lifetime total no longer enters any of it: the wall is fully cast
// from the first frame of night, so coverage is a function of the PURCHASES a
// preset carries and nothing else.

import { UPGRADES, type HexUpgrade } from "./data";
import { unlockMet, WALL_EFFECTS, type HexCore } from "./rules";

export interface HexPreset {
  total: number;
  mice: number;
  clicks?: number;
  golden?: number;
  owned?: Record<string, number>;
  bought?: string[];
  /** Describe the DAY this state came out of, and let applyPreset run the same
   * nightReset the purchase runs (see sim.applyPreset). A night preset written
   * directly cannot reach the state the twist leaves: the wipe is what makes it,
   * and the upgrades that survive it were unlocked by a lifetime and a building
   * count that no longer exist to be written down. */
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
  // THE WALL OPENS, UNLIT. The whole cast is out there with nothing behind it —
  // 33 anonymous specks at a third of full brightness, barely moving at a quarter
  // speed. Paper Lantern is deliberately NOT in `bought` here — the only night
  // preset without it — because this preset is the night as it actually begins, and
  // the first thing it has to be earning toward is the light. Press `mice` after it
  // to see the state the hand-over lands in; the hand-over itself only plays on a
  // real purchase, since a jump has no beat to replay (see applyPreset).
  //
  // So this is written as THE DAY IT CAME OUT OF — `catnap`'s own state, down to
  // the counters — plus `twist`, which runs the flip's nightReset over it. The
  // jump therefore lands exactly where pressing Catnap Hypnalysis lands, and
  // stays there as the ladder is retuned: broke, lifetime back to zero, the day's
  // buildings gone, the day's UPGRADES kept (the wipe never touches `bought`),
  // and one free Hole in the Wall the only thing on the rail.
  //
  // It used to name the night state directly — `mice: 0` with 10 Holes in the
  // Wall and 3 Balls of String already standing. The empty bank was the right
  // instinct and the buildings undid it: 6600 mice/s refilled it to five figures
  // within seconds, so a beat that is ABOUT being broke was the one place you
  // could not see it. They bought nothing else, either — the wall's cast, pace
  // and glow are functions of `bought` alone (see wallSpeed/wallGlow), so it
  // opens on the same 33 unlit specks with the buildings gone. (The later night
  // presets DO carry a bank — each is deliberately one press from its beat,
  // which is a different thing to show.)
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
