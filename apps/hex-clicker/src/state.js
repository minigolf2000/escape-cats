// The client's mirror of the room. The server (or the ?solo sim) is
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
  hashString,
} from "@escape-cats/shared";

// ---------------------------------------------------------------------------
// STATE — same shape the prototype kept, so every ported module reads the
// fields it always read. `unlocked`/`seen` are per-phone UI stickiness (what
// this player has been shown), never server state.
// ---------------------------------------------------------------------------
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
  speed: 1, // proctor dev time-scale, mirrored for extrapolation
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

// ---------------------------------------------------------------------------
// SHARED CLOCK — the night wall is a pure function of (seed, time), so every
// phone has to draw it against the same timeline. wallNow() is server-epoch
// milliseconds riding on this device's performance.now() ticker.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// OPTIMISTIC PETS — a tap credits the display immediately; the server's
// snapshot replaces it as soon as the batch round-trips. Entries older than
// the round-trip window are dropped rather than reconciled: on venue wifi the
// error is a fraction of one tap.
// ---------------------------------------------------------------------------
// Must cover a tap's whole round trip: PET_FLUSH_MS (100, net.ts) until the
// batch leaves, SNAPSHOT_TICK_MS (250, shared sim — pets ride the tick, they
// don't trigger a broadcast) until a snapshot carries it, plus RTT margin.
// Shorter and the counter dips once per batch; longer and it double-counts
// taps the snapshot already includes. Retune alongside those two constants.
const OPTIMISTIC_MS = 400;
let optimistic = []; // {at: perfNow, gain}
export function petCredit(gain) {
  game.mice += gain;
  game.total += gain;
  game.clicks += 1;
  optimistic.push({ at: performance.now(), gain });
}
function optimisticGain() {
  const cut = performance.now() - OPTIMISTIC_MS;
  optimistic = optimistic.filter((o) => o.at > cut);
  return optimistic.reduce((a, o) => a + o.gain, 0);
}

/** Frame-loop extrapolation between snapshots (passive income only — pets are
 * credited at the tap). */
export function extrapolate(dt) {
  const inc = baseCps() * dt * game.speed;
  if (inc > 0) {
    game.mice += inc;
    game.total += inc;
  }
}

// ---------------------------------------------------------------------------
// SNAPSHOT APPLICATION — copy the authoritative state in, report the edges.
// ---------------------------------------------------------------------------
let runId = null;
export let players = [];

export function applySnapshot(snap) {
  syncClock(snap.serverTime);
  const first = runId === null;
  const edges = {
    first,
    reset: !first && snap.runId !== runId,
    nightFlip: false, // day -> night while we watch (the cutscene beat)
    neonOn: false, // Counting Mice landed live
    goldSpawn: null, // a golden mouse just appeared
    goldGone: false, // ...or just left (caught or escaped)
    soldOut: false, // the last upgrade was just bought (shop-close beat)
  };
  runId = snap.runId;

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

  game.total = snap.total;
  game.clicks = snap.clicks;
  game.goldCaught = snap.goldCaught;
  game.owned = { ...snap.owned };
  game.bought = { ...snap.bought };
  game.nightAt = snap.nightAt;
  game.speed = snap.speed;
  // Zoomies deadline arrives in server time; convert onto this device's ticker.
  game.zoomUntil =
    snap.zoomUntil > snap.serverTime
      ? performance.now() + (snap.zoomUntil - snap.serverTime)
      : 0;
  // The bank: authoritative value plus any of our own taps still in flight.
  game.mice = snap.mice + optimisticGain();

  recalc();
  players = snap.players || [];

  const nightAfter = nightOf(game.bought);
  edges.nightFlip = !first && !nightBefore && nightAfter;
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
