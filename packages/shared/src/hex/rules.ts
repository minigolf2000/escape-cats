// Pure rules of Hex Clicker: every function here is a pure function of
// game-shaped state, so the server, the client and ?debug price the same rules
// instead of copies that drift.

import {
  BUILDINGS,
  UPGRADES,
  GROWTH,
  CLICK_BASE,
  CLICK_CPS_SHARE,
  ZOOM_MULT,
  ZOOM_S,
  INCOME_SCALE,
  type HexBuilding,
  type HexUpgrade,
  type HexEffect,
  type HexUnlock,
} from "./data";

/** The game-shaped core every rule reads. Both the server sim and the client
 * mirror satisfy this. */
export interface HexCore {
  mice: number;
  total: number; // lifetime earned, never decreases (except the night reset)
  clicks: number;
  goldCaught: number;
  owned: Record<string, number>;
  bought: Record<string, 1>;
}

export interface HexMods {
  building: Record<string, number>;
  globalMult: number;
  clickFlat: number;
  clickShare: number;
  clickMult: number;
  goldenFreq: number;
  goldenLife: number;
  zoomMult: number;
  zoomTime: number;
  trail: number;
  neon: number;
  persist: number;
  speed: number;
  lantern: number;
  pace: number;
  night: number;
}

const effectsOf = (u: HexUpgrade): HexEffect[] =>
  Array.isArray(u.effect) ? u.effect : [u.effect];

// `firstFree` is a COUNT of copies priced at zero and shifts the curve down by
// that many steps: the first PAID copy costs exactly `base`. The night cannot
// start without one (empty bank, only buildings earn).
export function costOf(b: HexBuilding, owned: number): number {
  const free = b.firstFree || 0;
  if (owned < free) return 0;
  return Math.ceil(b.base * Math.pow(b.growth || GROWTH, owned - free));
}

// Night is a pure function of the save, derived from which upgrade DECLARES
// `type: "night"`: nothing asks "do I own upgrade X?" by name.
export const NIGHT_KEYS = UPGRADES.filter((u) =>
  effectsOf(u).some((e) => e.type === "night"),
).map((u) => u.key);

const isStoryUpgrade = (u: HexUpgrade): boolean =>
  effectsOf(u).some(
    (e) =>
      e.type === "night" ||
      e.type === "trail" ||
      e.type === "neon" ||
      e.type === "persist" ||
      e.type === "speed" ||
      e.type === "lantern" ||
      e.type === "pace",
  );

// Rows that belong to the night even though their effect isn't a story beat —
// recognised by unlock chain rather than by key so a new night row needs no edit.
function nightOnlyUnlock(u: HexUpgrade): boolean {
  const seen = new Set<string>();
  let k = u.unlock && u.unlock.requires;
  while (k && !seen.has(k)) {
    if (NIGHT_KEYS.includes(k)) return true;
    seen.add(k);
    const parent = UPGRADES.find((x) => x.key === k);
    k = parent && parent.unlock && parent.unlock.requires;
  }
  return false;
}

export const NIGHT_ROW_KEYS = new Set<string>();
for (const u of UPGRADES)
  if (isStoryUpgrade(u) || nightOnlyUnlock(u)) NIGHT_ROW_KEYS.add(u.key);

export function nightOf(bought: Record<string, 1 | undefined>): boolean {
  return NIGHT_KEYS.some((k) => bought[k]);
}

/** Does this row belong on the shop rail in the current phase? At night the
 * day research is off the rail entirely — the day economy has been wiped, so
 * those rows would price improvements to buildings you no longer own. */
export function onRail(
  u: HexUpgrade,
  bought: Record<string, 1 | undefined>,
): boolean {
  return !nightOf(bought) || NIGHT_ROW_KEYS.has(u.key);
}

/** NOTHING LEFT TO SELL — every row this phase would ever show is bought.
 * Only ever true at night (day rows outnumber what a day can buy), and the
 * cue for the shop's one-way closing beat. */
export function allRailBought(s: HexCore): boolean {
  return (
    nightOf(s.bought) && UPGRADES.every((u) => !onRail(u, s.bought) || s.bought[u.key])
  );
}

// Every bought upgrade is folded into a mods object here, and nothing else in
// the game ever asks "do I own upgrade X?". Recomputed on buy/load only.
export function foldMods(
  bought: Record<string, 1 | undefined>,
  owned: Record<string, number>,
): HexMods {
  const night = NIGHT_KEYS.some((k) => bought[k]);
  const m: HexMods = {
    building: {},
    globalMult: 1,
    clickFlat: CLICK_BASE,
    clickShare: CLICK_CPS_SHARE,
    clickMult: 1,
    goldenFreq: 1,
    goldenLife: 0,
    zoomMult: ZOOM_MULT,
    zoomTime: ZOOM_S,
    // Wall state, all of it bought rather than crossed into: neon = the points
    // resolve into mice; trail = inked tail length; persist = ink half-life (0 =
    // a rolling window); lantern = the dream is LIT; pace = instalments of the
    // night's pace paid back, out of WALL.paceSteps. Zero on lantern and pace is
    // the night's OPENING state, not a neutral default (WALL.unlitSpeed).
    trail: 0,
    neon: 0,
    persist: 0,
    speed: 0,
    lantern: 0,
    pace: 0,
    night: 0,
  };
  BUILDINGS.forEach((b) => (m.building[b.id] = 1));
  let globalPct = 0,
    globalMul = 1;
  for (const u of UPGRADES) {
    if (!bought[u.key]) continue;
    for (const e of effectsOf(u)) {
      // A DAY upgrade contributes no income at night: the twist is a hard reset
      // and a separate economy, so day globalPct/buildingMult must not keep
      // multiplying night's buildings.
      const dayRowAtNight = night && !NIGHT_ROW_KEYS.has(u.key);
      if (e.type === "buildingMult") {
        if (!dayRowAtNight) m.building[e.building] *= e.mult;
      } else if (e.type === "globalPct") {
        if (!dayRowAtNight) globalPct += e.pct;
      } else if (e.type === "globalMult") {
        if (!dayRowAtNight) globalMul *= e.mult;
      } else if (e.type === "clickFlat") m.clickFlat += e.add;
      else if (e.type === "clickShare") m.clickShare += e.pct / 100;
      else if (e.type === "clickMult") m.clickMult *= e.mult;
      else if (e.type === "goldenFreq") m.goldenFreq *= e.mult;
      else if (e.type === "goldenLife") m.goldenLife += e.add;
      else if (e.type === "zoomMult") m.zoomMult += e.add;
      else if (e.type === "zoomTime") m.zoomTime += e.add;
      else if (e.type === "trail") m.trail += e.add;
      else if (e.type === "neon") m.neon = 1;
      else if (e.type === "persist") m.persist += e.add;
      else if (e.type === "speed") m.speed += e.add;
      else if (e.type === "lantern") m.lantern = 1;
      else if (e.type === "pace") m.pace += e.add;
      else if (e.type === "night") m.night = 1;
      else if (e.type === "crossBuilding")
        m.building[e.building] *= 1 + (e.pct / 100) * (owned[e.per] || 0);
      else if (e.type === "clickPerBuilding")
        m.clickFlat += e.add * (owned[e.per] || 0);
    }
  }
  m.globalMult = (1 + globalPct / 100) * globalMul;
  return m;
}

// Order of operations mirrors Cookie Clicker's: per-building multipliers apply
// inside the per-building term, the global multiplier applies on top, and
// timed buffs sit outside everything.
export function buildingMpsWith(m: HexMods, b: HexBuilding): number {
  // Dream reset: at night the daytime mouse-industry stops earning.
  if (m.night && !b.night) return 0;
  return b.mps * m.building[b.id] * m.globalMult * INCOME_SCALE;
}

export function baseCpsWith(m: HexMods, owned: Record<string, number>): number {
  let s = 0;
  for (const b of BUILDINGS) s += buildingMpsWith(m, b) * (owned[b.id] || 0);
  return s;
}

/** Pre-buff click value: flat + a share of income, times the click multiplier. */
export function clickBaseWith(m: HexMods, owned: Record<string, number>): number {
  return (m.clickFlat + baseCpsWith(m, owned) * m.clickShare) * m.clickMult;
}

// ---- UNLOCKS / REVEALS ----
const ownedPairs = (c: HexUnlock): [string, number][] =>
  typeof c.owned![0] === "string"
    ? [c.owned as [string, number]]
    : (c.owned as [string, number][]);

export function unlockMet(u: HexUpgrade, s: HexCore): boolean {
  const c = u.unlock;
  if (c.owned) {
    for (const [id, n] of ownedPairs(c)) if ((s.owned[id] || 0) < n) return false;
  }
  if (c.total != null && s.total < c.total) return false;
  if (c.clicks != null && s.clicks < c.clicks) return false;
  if (c.golden != null && s.goldCaught < c.golden) return false;
  if (c.requires && !s.bought[c.requires]) return false;
  return true;
}

export function isRevealed(b: HexBuilding, s: HexCore): boolean {
  // Day buildings are gone from the rail at night, and vice versa.
  if (!b.night && nightOf(s.bought)) return false;
  if (b.night && !nightOf(s.bought)) return false;
  if ((s.owned[b.id] || 0) > 0) return true;
  // A free copy is on the rail by definition — keeps the night from deadlocking.
  if (costOf(b, s.owned[b.id] || 0) === 0) return true;
  // ONE rule for both phases otherwise: a tier appears when lifetime earnings
  // have been enough to afford it once.
  return s.total >= b.base;
}

// ---- GOLDEN MOUSE — spawn windows (the buff itself lives in mods.zoom*) ----
export const GOLD_MIN_S = 40,
  GOLD_MAX_S = 90; // spawn window
// The FIRST golden of a run waits longer (~1:50–2:40): the opening is for
// learning the pet-and-buy loop, so it arrives once there is a pet worth
// multiplying.
export const GOLD_FIRST_MIN_S = 90,
  GOLD_FIRST_MAX_S = 130;
/** Seconds a golden stays on screen before escaping. */
export const goldLifeS = (m: HexMods): number => 9 + m.goldenLife;

// ---- NIGHT WALL RAMP + LEGIBILITY — the win condition, computable server-side ----
// Per-shape headcounts. yellow spells the word.
export const WALL_COUNT: Record<string, number> = {
  yellow: 9,
  pink: 10,
  blue: 4,
  green: 4,
  purple: 6,
};
export const WALL_COUNT_KEYS = ["yellow", "pink", "blue", "green", "purple"];
export const WALL_CAP = WALL_COUNT_KEYS.reduce((a, k) => a + WALL_COUNT[k], 0);

export const WALL = {
  // THE WHOLE CAST, FROM THE FIRST FRAME OF NIGHT. Don't reintroduce an arrival
  // ramp: a golden mouse with no trail behind it is a moving dot, so a full wall
  // gives nothing away — and every visible change at night must be something a
  // player pressed.
  maxMice: WALL_CAP,
  // Scene units/sec, ONE rate for every mouse, and the LIT rate: the phase opens
  // at unlitSpeed times it. Coverage is linear in speed, so the trail ladder's
  // total in data.ts is fitted to this number — move it and refit the ladder.
  // LEGIBLE_COV is NOT the dial to absorb it (see its note).
  speedBase: 9.6,
  speedMax: 20,
  trailDt: 80,
  // ---- THE UNLIT NIGHT: before Paper Lantern ---------------------------------
  // A QUARTER of the pace and a third of the brightness (unlitGlow, applied by
  // wall.js to every speck, sprite and trail). One row and one mod (`lantern`),
  // which SCALES the base until lit — unlike `speed`, which ADDS for everyone.
  //
  // NOTHING IN THE LEGIBILITY BUDGET MOVES, because of the unlock chain: Lucid
  // Dreaming I requires the lantern AND pays the last pace instalment, so trail
  // is 0 for the whole climb and every trail rung inks at the full 9.6. Break
  // that `requires` and the ladder inks a quarter-speed wall, landing at ~0.45
  // coverage against 1.6.
  //
  // 0.25 so the wall reads as WRONG, not retuned: at 2.4 units/sec a mouse needs
  // over five minutes for the comet's sweep, longer than the night, so nothing
  // resolves and the drift reads as sleep. A fourfold change is one a player
  // SEES; a doubling could be mistaken for the mice they were already watching.
  unlitSpeed: 0.25,
  unlitGlow: 0.3,
  // ---- WHO PAYS THE PACE BACK -----------------------------------------------
  // EQUAL instalments in UNITS (3.6 of the 7.2 units/sec the night is down),
  // paid by Paper Lantern and Lucid Dreaming I: 2.4 -> 6.0 -> 9.6. The LIGHT is
  // not split — the lantern is all of it. Perceived speed is ratio-based, so the
  // lantern's 2.5x feels bigger than the hinge's 1.6x, which is the right way
  // round: the hinge arrives with the first trails in hand. For two equal-
  // feeling steps the split would be geometric: `unlitSpeed ** (1 - paid)`.
  paceSteps: 2,
  // ---- THE HAND-OVER --------------------------------------------------------
  // Light and pace both ease over this from the purchase's own timestamp; they
  // are one gesture. Eased, never stepped: position is distance travelled, so a
  // rate that jumps is every mouse changing velocity in one frame — the
  // signature of a dropped frame, not of acceleration. 1.4s sits between the
  // neon cross-fade (620ms) and its ripple (900ms) in weight.
  rampMs: 1400,
};

// Scene units per second, one rate for every mouse on the wall. The pace is paid
// back in WALL.paceSteps equal instalments (see there) and SCALES the base rather
// than adding to it; the max clamp is applied last so it still means "no faster
// than this, ever".
export function wallSpeed(m: HexMods): number {
  const paid = Math.min(1, (m.pace || 0) / WALL.paceSteps);
  const lit = WALL.unlitSpeed + (1 - WALL.unlitSpeed) * paid;
  return Math.min(WALL.speedMax, (WALL.speedBase + (m.speed || 0)) * lit);
}

/** Opacity multiplier for everything the wall draws — specks, mice and ink
 * alike, at REST. The LIGHT is not split the way the pace is: Paper Lantern is
 * all of it. Cosmetic, so no rule reads it. Renderers want wallGlowAt, which
 * plays the hand-over. */
export function wallGlow(m: HexMods): number {
  return m.lantern ? 1 : WALL.unlitGlow;
}

// ---- THE WALL'S ODOMETER — scene units travelled, banked by the sim ----
// Position on the wall is DISTANCE TRAVELLED, not elapsed time (wallPosAt):
// multiplying elapsed time by a changed speed rescales the whole of history and
// teleports every mouse. So a rate change banks the distance so far and
// re-anchors from there — ONCE, in the sim, riding the snapshot, or a
// phone joining after the change replays the whole night at the new rate.
//
// The from-values record what the wall WAS at `wallAt`, because the change is
// eased (WALL.rampMs) and reproducing an eased change needs where it came FROM.
// Each derived quantity decides for itself whether IT is mid-change by comparing
// its own `from` against its own target; equal means not animating. Rate and
// glow are independent: Lucid Dreaming I changes the rate and not the light.
export interface HexWallClock {
  /** Scene units walked as of `wallAt`. */
  wallBase: number;
  /** Epoch ms that reading was taken — null until the twist fires. */
  wallAt: number | null;
  /** Scene units/sec the wall was walking at up to `wallAt`. */
  wallFrom: number;
  /** The glow it was drawing at up to `wallAt`. */
  wallGlowFrom: number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
// Smoothstep: zero acceleration at both ends, so the mice ease rather than lurch.
const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** 0..1 through the hand-over anchored at `wallAt`; 1 once it is spent. Whether
 * any given quantity is actually moving is that quantity's own question. */
export function wallRampAt(w: HexWallClock, t: number): number {
  if (w.wallAt === null) return 1;
  return clamp01((t - w.wallAt) / WALL.rampMs);
}

// Scene units walked by time `t`. During the hand-over this is the INTEGRAL of
// the smoothstep blend between the two rates, in closed form — the wall must be
// a pure function of (shared state, time), or four phones accumulating their
// own frames drift apart and a phone joining mid-ramp cannot land where the
// others are.
//
//   rate(d) = from + (to - from) * smoothstep(d / R)
//   ∫₀ᴰ smoothstep(d/R) dd = R(x³ - x⁴/2) for x = D/R ≤ 1,  else D - R/2
//
// Continuous in value and slope at D = R, so there is no seam where the ramp ends.
export function wallUnitsAt(
  w: HexWallClock,
  speed: number,
  t: number,
): number {
  if (w.wallAt === null) return 0;
  const d = Math.max(0, t - w.wallAt);
  if (w.wallFrom === speed) return w.wallBase + (d * speed) / 1000;
  const R = WALL.rampMs;
  const x = d / R;
  const j = x <= 1 ? R * (x * x * x - (x * x * x * x) / 2) : d - R / 2;
  return w.wallBase + (w.wallFrom * d + (speed - w.wallFrom) * j) / 1000;
}

/** The instantaneous rate at `t` — the derivative of wallUnitsAt, and what the
 * authority banks as the next `wallFrom`, so a change landing mid-hand-over
 * eases out of the speed the mice are actually travelling at. */
export function wallRateAt(
  w: HexWallClock,
  speed: number,
  t: number,
): number {
  if (w.wallAt === null || w.wallFrom === speed) return speed;
  const u = clamp01((t - w.wallAt) / WALL.rampMs);
  return w.wallFrom + (speed - w.wallFrom) * smoothstep(u);
}

/** The glow to draw at `t`: the rest value, eased from `wallGlowFrom` on the
 * same curve and anchor the pace rides. Self-restoring — a reload lands with
 * `t - wallAt` long past rampMs, so the ramp reads as finished. */
export function wallGlowAt(
  w: HexWallClock,
  m: HexMods,
  t: number,
): number {
  const to = wallGlow(m);
  if (w.wallGlowFrom === to) return to;
  const u = wallRampAt(w, t);
  return u >= 1 ? to : w.wallGlowFrom + (to - w.wallGlowFrom) * smoothstep(u);
}

// Scent Trail's decay: ms of half-life per unit of `persist`.
export const WALL_PERSIST_MS = 40;
// A MEASUREMENT of the rendered 1-stroke word, not a taste dial: a centreline
// word still drops whole letter strokes at 1.2x and only resolves near 1.7x.
// Never scale it with the speed — that would declare the word readable (to the
// win) on a wall visibly missing strokes.
// Slower mice ink less; the fix is more trail (data.ts), not a lower bar.
export const LEGIBLE_COV = 1.6;
// The word's total ink in scene units, measured off the live wall.
export const WORD_INK_EST = 1067;

// Coverage = word ink laid inside the visible window / the word's total ink;
// visibleMs is the rolling trail PLUS Scent Trail's persistence (2^(-t/half)
// integrates to half/ln2 ms of full-strength equivalent). The cast is constant
// (see WALL), so coverage is a pure function of the purchases. It reads the
// unlit rate before Paper Lantern, which changes NOTHING: trail is 0 until Lucid
// Dreaming I and that row is gated behind the lantern.
export function wallCoverage(m: HexMods): number {
  if (!m.night) return 0;
  const visibleMs =
    m.trail * WALL.trailDt +
    (m.persist > 0 ? (m.persist * WALL_PERSIST_MS) / Math.LN2 : 0);
  return (WALL_COUNT.yellow * (wallSpeed(m) / 1000) * visibleMs) / WORD_INK_EST;
}

export function isLegible(s: HexCore): boolean {
  return wallCoverage(foldMods(s.bought, s.owned)) >= LEGIBLE_COV;
}

// ---- THE TWIST — the hard reset into the dream economy ----
export function nightReset(s: HexCore & { zoomUntil?: number }): void {
  s.mice = 0;
  s.total = 0;
  for (const b of BUILDINGS) if (!b.night) s.owned[b.id] = 0;
  // A golden caught in the last seconds of the day leaves Zoomies running — a
  // multiplier on the one mechanic the night doesn't have. It ends with the day.
  if (s.zoomUntil !== undefined) s.zoomUntil = 0;
}

// ---- SHOP TEXT DERIVATIONS shared with the client ----
// The wall rows are the MYSTERY, so they do not describe themselves — every
// effect that touches the wall renders as ??? in the shop.
export const WALL_EFFECTS = new Set([
  "trail",
  "neon",
  "persist",
  "speed",
  "lantern",
  "pace",
]);

// GOLDEN NAMES: wall rows that are the ONLY row of their kind change what the
// wall does rather than how much of it there is — they get the crux styling.
export const CRUX_KEYS = (() => {
  const seen: Record<string, number> = {};
  for (const u of UPGRADES)
    for (const e of effectsOf(u))
      if (WALL_EFFECTS.has(e.type)) seen[e.type] = (seen[e.type] || 0) + 1;
  return new Set(
    UPGRADES.filter((u) =>
      effectsOf(u).some((e) => WALL_EFFECTS.has(e.type) && seen[e.type] === 1),
    ).map((u) => u.key),
  );
})();

export { effectsOf };
