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
// OPTIMISTIC PETS — a tap credits the display immediately and is held until
// the server acknowledges the batch that carried it.
// ---------------------------------------------------------------------------
// This used to expire entries after a fixed window that had to equal the whole
// round trip: PET_FLUSH_MS (100) + SNAPSHOT_TICK_MS (250) + RTT. With ?debug the
// RTT is zero so any window worked, but over a real connection the budget left
// ~50ms for the network. Overshoot and the entry died before its snapshot
// arrived (bank dips one tap); undershoot and it was still counted after the
// snapshot included it (bank reads high). Both happened, tap by tap, which is
// what made the counter jitter.
//
// Now the server tells us exactly which batches a snapshot contains, so the
// arithmetic is exact at any latency. The timestamp survives only as a
// backstop: if an ack is lost — a reconnect mid-flight — an entry must not
// inflate the bank forever.
const OPTIMISTIC_BACKSTOP_MS = 5000;
let optimistic = []; // {seq, gain, at: perfNow}

export function petCredit(gain, seq) {
  game.mice += gain;
  game.total += gain;
  game.clicks += 1;
  optimistic.push({ seq, gain, at: performance.now() });
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

  game.total = snap.total;
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
  // The bank: authoritative value plus any of our own taps still in flight.
  game.mice = snap.mice + optimisticGain();

  recalc();
  // After the fold, because the fallbacks need the CURRENT rest values: a snapshot
  // from a build without these must read as "nothing is handing over" rather than
  // as a ramp easing out of zero and up from black.
  game.wallFrom = snap.wallFrom ?? wallSpeed(mods);
  game.wallGlowFrom = snap.wallGlowFrom ?? wallGlow(mods);
  players = snap.players || [];

  const nightAfter = nightOf(game.bought);
  edges.nightFlip = !first && !nightBefore && nightAfter;
  // Live edge only, exactly like nightFlip: the splash RAISES itself the moment
  // the proctor presses, and a phone that joins an already-won room lands on the
  // game with the toggle lit instead of on a celebration it missed (the night
  // cutscene set that precedent — a rejoin gets the state, not the beat).
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
