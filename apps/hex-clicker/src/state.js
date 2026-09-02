// The client's mirror of the room. The server (or the ?debug sim) is
// authoritative; this module holds the latest snapshot plus just enough local
// extrapolation to keep the counter smooth between broadcasts, and turns each
// snapshot into EDGES (day->night flip, neon on, gold spawned...) that main.js
// wires to the UI beats. Nothing in here touches the DOM.

import {
  BUILDINGS,
  foldMods,
  nightOf,
  allRailBought,
  baseCpsWith,
  clickBaseWith,
  unlockMet,
  wallSpeed,
  wallGlow,
  hashString,
} from "@escape-cats/shared";

// ---- STATE. `unlocked`/`seen` are per-phone UI stickiness (what this player
// has been shown), never server state. ----
export const game = {
  mice: 0, // display bank: server value + local extrapolation
  total: 0,
  clicks: 0,
  goldCaught: 0,
  owned: {}, // id -> count
  bought: {}, // upgrade key -> 1 once purchased
  unlocked: {}, // upgrade key -> 1 once revealed (sticky; never re-hides)
  seen: {}, // upgrade key -> 1 once its row has been laid eyes on
  zoomUntil: 0, // performance.now() ms while Zoomies is active (converted from server time)
  nightAt: null, // wall-clock (server epoch) ms the twist fired — anchors the wall
  wonAt: null, // server epoch ms the PROCTOR marked this team won (see HexSim.setWon)
  // The wall's odometer, banked by the authority (see HexWallClock in rules.ts):
  // scene units walked as of `wallAt` (server epoch ms), out of the rate and glow
  // it was holding then. wall.js reads position AND brightness off this, so every
  // phone draws the same frame — including one that joins mid hand-over.
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
  return performance.now() < game.zoomUntil ? mods.zoomMult : 1;
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

// ---- SHARED CLOCK — the night wall is a pure function of (seed, time), so
// every phone draws it against the same timeline. wallNow() is server-epoch ms
// riding on this device's performance.now() ticker. ----
let clockSkew = null; // serverEpoch - performance.now()
function syncClock(serverTime) {
  const skew = serverTime - performance.now();
  // First snapshot pins it; later ones only correct real drift (a re-pin every
  // 250ms would make the wall micro-stutter with network jitter).
  if (clockSkew === null || Math.abs(skew - clockSkew) > 500) clockSkew = skew;
}
export function wallNow() {
  return performance.now() + (clockSkew ?? 0);
}

// Room seed: all phones derive the same wall cast/phases from the room code.
let seed = 7;
export function setRoomSeed(room) {
  seed = hashString(String(room));
}
export function wallSeed() {
  return seed;
}

// ---- OPTIMISTIC PETS — a tap credits the display immediately and is held
// until the server acknowledges the batch that carried it. ----
// Ack-based, not a time window: a window had to equal the whole round trip, and
// jitter either way made the counter jump tap by tap. The timestamp is only a
// backstop against a lost ack (a reconnect mid-flight) inflating the bank forever.
const OPTIMISTIC_BACKSTOP_MS = 5000;
let optimistic = []; // {seq, gain, at: perfNow}

export function petCredit(gain, seq) {
  optimistic.push({ seq, gain, at: performance.now() });
  game.clicks += 1;
  // Straight onto the counter rather than on the next frame: the tap and the
  // number have to move together or the pet feels like it missed.
  extrapolate();
}

/** Every batch at or below `seq` is baked into the snapshot that follows. */
export function ackPets(seq) {
  optimistic = optimistic.filter((o) => o.seq > seq);
}

function optimisticGain() {
  const cut = performance.now() - OPTIMISTIC_BACKSTOP_MS;
  optimistic = optimistic.filter((o) => o.at > cut);
  return optimistic.reduce((a, o) => a + o.gain, 0);
}

// ---- THE BANK IS A FUNCTION OF TIME, NOT A RUNNING TOTAL ----
// A running total that a snapshot then overwrites ticks backwards two ways: it
// re-bases on ARRIVAL, so network jitter moves the bank, and the frame after a
// snapshot double-counts the sliver since the previous frame. So the bank is
// read off an ANCHOR — a value, the shared-clock moment it was true, and the
// rate it was climbing at. Consecutive anchors AGREE (the authority integrates
// the same rate over the same interval), so there is nothing to reconcile. And
// income can never move the bank DOWN: `total` only climbs and the spent gap
// only steps on a purchase, so the one thing that takes the number down is a
// teammate at the shop — the money actually being gone.
let anchorTotal = 0; // lifetime mice as of anchorAt
let anchorSpent = 0; // total - mice there; only a purchase moves it
let anchorCps = 0; // mice/sec it was climbing at (dev speed already folded in)
let anchorAt = null; // server-epoch ms, on the shared clock — see wallNow()

/** Recompute the bank from the anchor. Every frame, and again the instant
 * anything feeding it changes, so no reader is handed a stale one. */
export function extrapolate() {
  if (anchorAt === null) return;
  const age = Math.max(0, (wallNow() - anchorAt) / 1000);
  game.total = anchorTotal + anchorCps * age + optimisticGain();
  game.mice = game.total - anchorSpent;
}

// ---- SNAPSHOT APPLICATION — copy the authoritative state in, report the edges ----
let runId = null;
export let players = [];

export function applySnapshot(snap) {
  syncClock(snap.serverTime);
  const first = runId === null;
  const edges = {
    first,
    reset: !first && snap.runId !== runId,
    nightFlip: false, // day -> night while we watch (the cutscene beat)
    wonFlip: false, // the proctor marked us won while we watch (raise the splash)
    neonOn: false, // Counting Mice landed live
    goldSpawn: null, // a golden mouse just appeared
    goldGone: false, // ...or just left (caught or escaped)
    soldOut: false, // the last upgrade was just bought (shop-close beat)
  };
  runId = snap.runId;

  const wonBefore = game.wonAt !== null;
  const nightBefore = nightOf(game.bought);
  const neonBefore = !!mods.neon;
  const soldOutBefore = allRailBought(game);
  const goldBefore = prevGoldId;

  if (edges.reset) {
    // Proctor reset: this phone starts over with the room.
    game.unlocked = {};
    game.seen = {};
    optimistic = [];
  }

  game.clicks = snap.clicks;
  game.goldCaught = snap.goldCaught;
  game.owned = { ...snap.owned };
  game.bought = { ...snap.bought };
  game.nightAt = snap.nightAt;
  game.wonAt = snap.wonAt ?? null;
  game.wallBase = snap.wallBase ?? 0;
  game.wallAt = snap.wallAt ?? snap.nightAt;
  game.speed = snap.speed;
  // Zoomies deadline arrives in server time; convert onto this device's ticker.
  game.zoomUntil =
    snap.zoomUntil > snap.serverTime
      ? performance.now() + (snap.zoomUntil - snap.serverTime)
      : 0;
  recalc();
  // After the fold, because the fallbacks need the CURRENT rest values: a snapshot
  // from a build without these must read as "nothing is handing over" rather than
  // as a ramp easing out of zero and up from black.
  game.wallFrom = snap.wallFrom ?? wallSpeed(mods);
  game.wallGlowFrom = snap.wallGlowFrom ?? wallGlow(mods);
  players = snap.players || [];

  // The bank's anchor — what the authority held, the moment it held it, and how
  // fast it was climbing. `cps` and `serverTime` both ride the snapshot, so none
  // of it is measured against when the message happened to ARRIVE. After the
  // fold too, so the fallback rate is this snapshot's economy and not the last.
  anchorTotal = snap.total;
  anchorSpent = snap.total - snap.mice;
  anchorCps = snap.cps ?? baseCps() * game.speed;
  anchorAt = snap.serverTime;
  extrapolate();

  const nightAfter = nightOf(game.bought);
  edges.nightFlip = !first && !nightBefore && nightAfter;
  // Live edge only, like nightFlip: a phone that joins an already-won room
  // lands on the game with the toggle lit, not on a celebration it missed.
  edges.wonFlip = !first && !wonBefore && game.wonAt !== null;
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
