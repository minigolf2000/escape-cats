// The client's mirror of the game. The backend's sim is
// authoritative; this module holds the latest snapshot plus just enough local
// extrapolation to keep the counter smooth between broadcasts, and turns each
// snapshot into EDGES (day->night flip, neon on, gold spawned...) that main.js
// wires to the UI beats. Nothing in here touches the DOM.

import {
  BUILDINGS,
  foldMods,
  hexWon,
  nightOf,
  allRailBought,
  baseCpsWith,
  clickBaseWith,
  unlockMet,
  wallSpeed,
  wallGlow,
  hashString,
} from "@escape-cats/shared";

// ---- STATE. `unlocked`/`seen` are local UI stickiness (what this player
// has been shown), never sim state. ----
export const game = {
  mice: 0, // display bank: sim value + local extrapolation
  total: 0,
  clicks: 0,
  goldCaught: 0,
  owned: {}, // id -> count
  bought: {}, // upgrade key -> 1 once purchased
  unlocked: {}, // upgrade key -> 1 once revealed (sticky; never re-hides)
  seen: {}, // upgrade key -> 1 once its row has been laid eyes on
  zoomUntil: 0, // epoch ms while Zoomies is active
  nightAt: null, // epoch ms the twist fired — anchors the wall
  legibleAt: null, // epoch ms the wall became readable — which IS the win (hexWon)
  // The wall's odometer, banked by the sim (see HexWallClock in rules.ts):
  // scene units walked as of `wallAt` (epoch ms), out of the rate and glow it
  // was holding then. wall.js reads position AND brightness off this, so a
  // reload draws the same frame — including one mid hand-over.
  wallBase: 0,
  wallAt: null,
  wallFrom: 0,
  wallGlowFrom: 0,
  speed: 1, // ?debug dev time-scale, mirrored for extrapolation
};
BUILDINGS.forEach((b) => (game.owned[b.id] = 0));

export const mods = foldMods({}, game.owned);
export function recalc() {
  Object.assign(mods, foldMods(game.bought, game.owned));
}

export function nightActive() {
  return nightOf(game.bought);
}
export function baseCps() {
  return baseCpsWith(mods, game.owned);
}
export function zoomBuff() {
  return wallNow() < game.zoomUntil ? mods.zoomMult : 1;
}
export function clickGain() {
  return clickBaseWith(mods, game.owned) * zoomBuff();
}

// Sticky reveal, exactly the prototype's isUnlocked: once a row has been shown
// it never re-hides, even if a condition wobbles.
export function isUnlocked(u) {
  if (game.unlocked[u.key]) return true;
  if (!unlockMet(u, game)) return false;
  game.unlocked[u.key] = 1;
  return true;
}

// ---- THE CLOCK — the night wall is a pure function of (seed, time), and every
// timestamp in a snapshot is epoch ms, so the frame loop reads the clock the
// sim stamps with. ----
export const wallNow = () => Date.now();

/**
 * The wall's seed — which mice are cast into the night scene, and in what
 * phases. One constant, so the wall is the same every run. Deliberately fixed
 * rather than random per run: the night is a reveal, and a player coming back
 * to finish one should find the wall they left.
 */
const WALL_SEED = hashString("hex");
export function wallSeed() {
  return WALL_SEED;
}

// ---- OPTIMISTIC PETS — a tap credits the display immediately and is held
// until the snapshot that carries it arrives. ----
// Still needed with the sim in this tab: taps are folded into the sim once per
// SNAPSHOT_TICK_MS (a Zoomies mash is 20 a second, and the income fold must
// stay off the 60fps tap path), so there is still up to a tick between the
// finger and the bank.
//
// Every snapshot is emitted AFTER the queue is folded in (`backend.ts`,
// `emit`), so a snapshot arriving IS the ack: `applySnapshot` clears the
// credit, and there is nothing to lose.
let optimistic = 0;

export function petCredit(gain) {
  optimistic += gain;
  game.clicks += 1;
  // Straight onto the counter rather than on the next frame: the tap and the
  // number have to move together or the pet feels like it missed.
  extrapolate();
}



// ---- THE BANK IS A FUNCTION OF TIME, NOT A RUNNING TOTAL ----
// A running total that a snapshot then overwrites ticks backwards two ways: it
// re-bases on ARRIVAL, so the tick's timing moves the bank, and the frame after a
// snapshot double-counts the sliver since the previous frame. So the bank is
// read off an ANCHOR — a value, the moment it was true, and the
// rate it was climbing at. Consecutive anchors AGREE (the sim integrates
// the same rate over the same interval), so there is nothing to reconcile. And
// income can never move the bank DOWN: `total` only climbs and the spent gap
// only steps on a purchase, so the one thing that takes the number down is
// the money actually being spent at the shop.
let anchorTotal = 0; // lifetime mice as of anchorAt
let anchorSpent = 0; // total - mice there; only a purchase moves it
let anchorCps = 0; // mice/sec it was climbing at (dev speed already folded in)
let anchorAt = null; // epoch ms — see wallNow()

/** Recompute the bank from the anchor. Every frame, and again the instant
 * anything feeding it changes, so no reader is handed a stale one. */
export function extrapolate() {
  if (anchorAt === null) return;
  const age = Math.max(0, (wallNow() - anchorAt) / 1000);
  game.total = anchorTotal + anchorCps * age + optimistic;
  game.mice = game.total - anchorSpent;
}

// ---- SNAPSHOT APPLICATION — copy the authoritative state in, report the edges ----
let runId = null;

export function applySnapshot(snap) {
  // Every queued tap is in this snapshot (the backend folds them in before it
  // emits), so the optimistic credit is spent.
  optimistic = 0;
  const first = runId === null;
  const edges = {
    first,
    reset: !first && snap.runId !== runId,
    nightFlip: false, // day -> night while we watch (the cutscene beat)
    wonFlip: false, // the wall went legible while we watch (raise the splash)
    neonOn: false, // Counting Mice landed live
    goldSpawn: null, // a golden mouse just appeared
    goldGone: false, // ...or just left (caught or escaped)
    soldOut: false, // the last upgrade was just bought (shop-close beat)
  };
  runId = snap.runId;

  const wonBefore = hexWon(game);
  const nightBefore = nightOf(game.bought);
  const neonBefore = !!mods.neon;
  const soldOutBefore = allRailBought(game);
  const goldBefore = prevGoldId;

  if (edges.reset) {
    // Start over.
    game.unlocked = {};
    game.seen = {};
  }

  game.clicks = snap.clicks;
  game.goldCaught = snap.goldCaught;
  game.owned = { ...snap.owned };
  game.bought = { ...snap.bought };
  game.nightAt = snap.nightAt;
  game.legibleAt = snap.legibleAt;
  game.wallBase = snap.wallBase ?? 0;
  game.wallAt = snap.wallAt ?? snap.nightAt;
  game.speed = snap.speed;
  game.zoomUntil = snap.zoomUntil;
  recalc();
  // After the fold, because the fallbacks need the CURRENT rest values: a snapshot
  // from a build without these must read as "nothing is handing over" rather than
  // as a ramp easing out of zero and up from black.
  game.wallFrom = snap.wallFrom ?? wallSpeed(mods);
  game.wallGlowFrom = snap.wallGlowFrom ?? wallGlow(mods);

  // The bank's anchor — what the sim held, the moment it held it, and how
  // fast it was climbing. `cps` and `at` both ride the snapshot. After the
  // fold too, so the fallback rate is this snapshot's economy and not the last.
  anchorTotal = snap.total;
  anchorSpent = snap.total - snap.mice;
  anchorCps = snap.cps ?? baseCps() * game.speed;
  anchorAt = snap.at;
  extrapolate();

  const nightAfter = nightOf(game.bought);
  edges.nightFlip = !first && !nightBefore && nightAfter;
  // Live edge only, like nightFlip: a returning player whose wall was already
  // legible lands on the game with the toggle lit, not on a celebration they
  // have already had.
  edges.wonFlip = !first && !wonBefore && hexWon(game);
  edges.neonOn = !first && !neonBefore && !!mods.neon;
  edges.soldOut = !first && !soldOutBefore && allRailBought(game);
  const gid = snap.gold ? snap.gold.id : null;
  if (gid !== goldBefore) {
    if (gid !== null) edges.goldSpawn = snap.gold;
    else edges.goldGone = !first;
  }
  prevGoldId = gid;

  return edges;
}
let prevGoldId = null;
