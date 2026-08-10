// Pure rules of Hex Clicker, ported from the prototype (hex/index.html).
// Everything here is a pure function of game-shaped state, so the PartyKit
// server, the client's rendering, the ?debug mode, and any future pacing
// simulator all price the same rules instead of copies that drift.

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
  night: number;
}

const effectsOf = (u: HexUpgrade): HexEffect[] =>
  Array.isArray(u.effect) ? u.effect : [u.effect];

// `firstFree` is a COUNT of copies priced at zero, and it shifts the curve down by
// that many steps rather than discounting it: copy n costs base * growth^(n - free),
// so the first PAID copy still costs exactly `base`. It exists for one thing: night
// opens with an empty bank and nothing but buildings earns, so without a copy priced
// at zero the phase cannot start at all.
export function costOf(b: HexBuilding, owned: number): number {
  const free = b.firstFree || 0;
  if (owned < free) return 0;
  return Math.ceil(b.base * Math.pow(b.growth || GROWTH, owned - free));
}

// The night phase is a pure function of the save — no separate flag to persist.
// Derived from the table (which upgrade DECLARES `type: "night"`) rather than
// hardcoding its key: the rule is that nothing asks "do I own upgrade X?" by name.
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
      e.type === "lantern",
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
    // Wall state, all of it bought rather than crossed into:
    //   neon      the points resolve into coloured mice (Counting Mice)
    //   trail     length of the inked tail (the sleep-stage ladder)
    //   persist   ink half-life; 0 = a rolling window (Scent Trail)
    //   lantern   the dream is LIT and running at full pace (Paper Lantern).
    //             Zero is the night's opening state, not a neutral default —
    //             see WALL.unlitSpeed / wallGlow.
    trail: 0,
    neon: 0,
    persist: 0,
    speed: 0,
    lantern: 0,
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
      // multiplying night's buildings (see the prototype's foldMods note).
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

// ---------------------------------------------------------------------------
// UNLOCKS / REVEALS
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// GOLDEN MOUSE — spawn windows (the buff itself lives in mods.zoom*)
// ---------------------------------------------------------------------------
export const GOLD_MIN_S = 40,
  GOLD_MAX_S = 90; // spawn window
// The FIRST golden of a run waits longer, landing ~1:50–2:40 — late in the
// opening era, "a taste". See the prototype's note on why.
export const GOLD_FIRST_MIN_S = 90,
  GOLD_FIRST_MAX_S = 130;
/** Seconds a golden stays on screen before escaping. */
export const goldLifeS = (m: HexMods): number => 9 + m.goldenLife;

// ---------------------------------------------------------------------------
// NIGHT WALL RAMP + LEGIBILITY — the win condition, computable server-side.
// ---------------------------------------------------------------------------
// Per-shape headcounts, settled in the reveal lab. yellow spells the word.
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
  // THE WHOLE CAST, FROM THE FIRST FRAME OF NIGHT. There used to be a ramp here
  // — mouseBase 2000, mouseR 1.23, startMice 0, with mouse k climbing on when
  // lifetime total crossed mouseBase * mouseR^(k-1) — so the dream opened on an
  // empty wall and filled to 33 across the phase. It is gone, and the beat it
  // was protecting survives without it: the reason to start empty was that cast
  // slot 1 is GOLDEN and "a starting mouse would hand over a letter before the
  // phase starts", but a golden mouse with NO TRAIL BEHIND IT is a moving dot.
  // That is the same argument the deleted Word of Mouse row was retired on (see
  // data.ts) — the word stays unreadable until Lucid Dreaming, which the ladder
  // already calls its hinge.
  //
  // What dropping it buys: the wall stops growing by 33 arrivals nobody bought,
  // every shape in the scene is being drawn from the opening frame instead of
  // being staffed in over minutes, and every visible change at night is once
  // again something a player pressed — the rule the whole night ladder is
  // written to.
  maxMice: WALL_CAP,
  // Scene units/sec, ONE rate for every mouse — and, since Paper Lantern, the LIT
  // rate: the phase opens at half of it (see unlitSpeed below). 9.6, four fifths of
  // the 12 the wall shipped with: with the entire cast adrift from the first frame
  // the opening reads busier than it did, and a slower drift puts it back to specks
  // floating in the dark rather than a swarm with somewhere to be.
  //
  // NOT a free look, and the bill is paid in the trail ladder: coverage is linear
  // in speed, so the word inks 20% slower for the same trail and the four rungs
  // went 180 -> 236 units to put the same ink back on the wall (see data.ts).
  // LEGIBLE_COV is deliberately NOT what moved — it is a measurement of the
  // rendered word, not a dial (see the note there). This is the same trade the
  // lab made when the word's rate was capped at MAX_SPEED and it needed 119 units
  // of trail where 68 had sufficed.
  speedBase: 9.6,
  speedMax: 20,
  trailDt: 80,
  // ---- THE UNLIT NIGHT -------------------------------------------------------
  // What the wall is BEFORE Paper Lantern: half the pace above, and a third of the
  // brightness (unlitGlow, applied by wall.js to every speck, sprite and trail).
  // The night used to open at full speed and full brightness, which made its first
  // rung — Lucid Dreaming I, the trail hinge — the first thing that had ever
  // changed the wall. Now the phase opens under-lit and sluggish and the FIRST
  // purchase of the night is the one that fixes it, so the opening stretch has
  // something to want instead of only something to wait through.
  //
  // Both halves are one row and one mod on purpose (`lantern`, not a `speed` rung
  // plus a brightness rung): a lantern is a light you release and then watch go, so
  // the light and the going are the same gesture. It is also why the deleted speed
  // rung's `speed` effect is NOT what implements this — that one ADDED to the base
  // for everyone, where this SCALES it and only until the lantern is lit.
  //
  // NOTHING IN THE LEGIBILITY BUDGET MOVES, and that is a fact about the unlock
  // chain rather than luck: Lucid Dreaming I requires the lantern, so the wall
  // cannot own a single unit of trail while it is running at unlitSpeed. Coverage
  // is trail x speed (see wallCoverage) and trail is 0 for the whole unlit stretch,
  // so the phase's coverage curve starts where it always did — at the hinge, at
  // 9.6 units/sec. Break that `requires` and the four trail rungs are suddenly
  // inking a half-speed wall, the ladder lands at 0.9 coverage against a 1.6
  // threshold, and the word can never be read.
  //
  // 0.5 rather than something milder because the wall has to read as WRONG, not as
  // retuned: at 4.8 units/sec a mouse takes ~2.6 minutes to walk the comet's sweep,
  // so nothing on screen resolves into a shape on its own and the drift reads as
  // sleep rather than as travel.
  unlitSpeed: 0.5,
  unlitGlow: 0.3,
};

// Scene units per second, one rate for every mouse on the wall. The lantern
// multiplies rather than adds (see WALL.unlitSpeed); the max clamp is applied
// last so it still means "no faster than this, ever".
export function wallSpeed(m: HexMods): number {
  const lit = m.lantern ? 1 : WALL.unlitSpeed;
  return Math.min(WALL.speedMax, (WALL.speedBase + (m.speed || 0)) * lit);
}

/** Opacity multiplier for everything the wall draws — specks, mice and ink
 * alike. Cosmetic, so no rule reads it; it lives here only to sit beside the
 * speed half of the same purchase. */
export function wallGlow(m: HexMods): number {
  return m.lantern ? 1 : WALL.unlitGlow;
}

// ---------------------------------------------------------------------------
// THE WALL'S ODOMETER — scene units travelled, banked by the authority.
// ---------------------------------------------------------------------------
// Position on the wall is DISTANCE TRAVELLED, not elapsed time (see wallPosAt),
// because multiplying elapsed time by a changing speed rescales the whole of
// history and teleports every mouse on the frame the rate changes. So a rate
// change banks the distance so far and re-anchors from there.
//
// That banking has to happen ONCE, on the authority, and ride the snapshot: the
// wall's whole premise is that four phones draw the identical reveal from
// (seed, time), and a client that banks its own base at its own frame time gets
// a per-device offset — badly so for a phone that JOINS after the change, which
// would otherwise replay the entire night at the new rate. This is the fix the
// note in wall.js asked for when it said a speed rung would need one.
export interface HexWallClock {
  /** Scene units walked as of `wallAt`. */
  wallBase: number;
  /** Epoch ms that reading was taken — null until the twist fires. */
  wallAt: number | null;
}

export function wallUnitsAt(
  w: HexWallClock,
  speed: number,
  t: number,
): number {
  if (w.wallAt === null) return 0;
  return w.wallBase + (Math.max(0, t - w.wallAt) * speed) / 1000;
}

// Scent Trail's decay: ms of half-life per unit of `persist`.
export const WALL_PERSIST_MS = 40;
// 1.6, and it did NOT move when the wall slowed to 9.6 — that is the whole reason
// the trail ladder grew instead (180 -> 236 units, see data.ts). This number is not
// a taste dial that can absorb a speed change: it is a measurement of the RENDERED
// word, made in the reveal lab against the 1-stroke source, where a centreline word
// is still dropping whole letter strokes at 1.2x and only resolves near 1.7x.
// Scaling it with the speed would have declared the word readable — to the proctor,
// to the progress bar, to the win condition — on a wall that is visibly missing
// strokes. Slower mice ink less; the fix is more trail, not a lower bar.
export const LEGIBLE_COV = 1.6;
// The word's total ink in scene units, measured off the live wall.
export const WORD_INK_EST = 1067;

// Coverage is word ink laid inside the visible window over the word's total ink;
// the 1-stroke word needs LEGIBLE_COV of it to read unambiguously. visibleMs is
// the rolling trail PLUS Scent Trail's persistence (2^(-t/half) integrates to
// half/ln2 ms of full-strength equivalent).
//
// All nine golden mice are on the wall for the whole night now (see WALL), so the
// word's ink RATE is a constant and coverage is a pure function of the purchases:
// trail length, plus persistence. It used to climb with lifetime total as well,
// through the ramp's share of yellow — hence the `total` argument this function
// and isLegible below both used to take.
//
// wallSpeed is halved before Paper Lantern, so this reads half rate during the
// unlit opening — which changes NOTHING, because trail is 0 until Lucid Dreaming
// I and that row is gated behind the lantern. See WALL.unlitSpeed.
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

// ---------------------------------------------------------------------------
// THE TWIST — the hard reset into the dream economy.
// ---------------------------------------------------------------------------
export function nightReset(s: HexCore & { zoomUntil?: number }): void {
  s.mice = 0;
  s.total = 0;
  for (const b of BUILDINGS) if (!b.night) s.owned[b.id] = 0;
  // A golden caught in the last seconds of the day leaves Zoomies running — a
  // multiplier on the one mechanic the night doesn't have. It ends with the day.
  if (s.zoomUntil !== undefined) s.zoomUntil = 0;
}

// ---------------------------------------------------------------------------
// SHOP TEXT DERIVATIONS shared by the client (the proctor may want them too).
// ---------------------------------------------------------------------------
// The wall rows are the MYSTERY, so they do not describe themselves — every
// effect that touches the wall renders as ??? in the shop.
export const WALL_EFFECTS = new Set([
  "trail",
  "neon",
  "persist",
  "speed",
  "lantern",
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
