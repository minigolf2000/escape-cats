// The Hex Clicker simulation, and the intents and snapshot that reach it.
// Exactly one implementation of "what a purchase does". All timestamps are
// epoch ms supplied by the caller (`now`), never read from a clock here —
// deterministic enough to test.
//
// It used to be the authority a Durable Object wrapped, one per team, with the
// client's ?debug running a second copy in-page. There is no server: the
// client's copy is the only one, and the intent/snapshot shape below is the
// seam it sits behind rather than a wire format.

import { BUILDINGS, UPGRADES } from "./data";
import { debugDerivedBought, type HexPreset } from "./presets";
import {
  type HexCore,
  type HexMods,
  onRail,
  costOf,
  foldMods,
  nightOf,
  nightReset,
  baseCpsWith,
  clickBaseWith,
  unlockMet,
  isRevealed,
  wallCoverage,
  wallSpeed,
  wallGlow,
  wallGlowAt,
  wallRateAt,
  wallUnitsAt,
  LEGIBLE_COV,
  GOLD_MIN_S,
  GOLD_MAX_S,
  GOLD_FIRST_MIN_S,
  GOLD_FIRST_MAX_S,
  goldLifeS,
} from "./rules";

/** A golden mouse in flight. Position is client-local (each phone bounces it
 * inside its own layout); the server only owns WHEN one exists and for how
 * long. `seed` feeds the client's deterministic spawn placement. */
export interface HexGold {
  id: number;
  bornAt: number; // epoch ms
  life: number; // seconds on screen
  seed: number;
}

export interface HexSimState extends HexCore {
  /** Bumped on every proctor reset — clients treat a new runId as a fresh boot. */
  runId: number;
  startedAt: number; // epoch ms this run began
  zoomUntil: number; // epoch ms while Zoomies (pet power x mods.zoomMult) runs
  gold: HexGold | null;
  nightAt: number | null; // epoch ms the twist fired
  legibleAt: number | null; // epoch ms the word became readable
  /** The wall's odometer: scene units walked as of `wallAt`, re-banked by the
   * authority whenever wallSpeed or wallGlow changes, so a phone joining
   * mid-night lands on the same frame. See HexWallClock in rules.ts. */
  wallBase: number;
  wallAt: number | null;
  /** The rate walked, and the glow drawn, UP TO wallAt — what the hand-over
   * eases out of. Each equals its current value whenever that quantity was not
   * what changed, which is how the pace can ramp on Lucid Dreaming I without the
   * light ramping with it. */
  wallFrom: number;
  wallGlowFrom: number;
  /** Dev time-scale (?debug only) — multiplies passive income + golden cadence,
   * never click feel. A real room never leaves 1. */
  speed: number;
}

/**
 * A room's saved game — everything a Durable Object eviction would erase.
 * Versioned so a deploy that changes the shape refuses stale data.
 * Absent on purpose: mods (derived on restore, so a rebalance applies to live
 * rooms), gold (expired after any gap; restore reschedules), speed (?debug
 * only), lastTick / gold timer (restart-local).
 */
export interface HexPersistedV1 {
  v: 1;
  /** Epoch ms of the write — the anchor for capped offline credit on load. */
  savedAt: number;
  runId: number;
  startedAt: number;
  nightAt: number | null;
  legibleAt: number | null;
  zoomUntil: number;
  /** So a restored room can't reissue a golden id a client already saw. */
  goldSeq: number;
  /** The wall odometer (see HexSimState). OPTIONAL rather than a version bump:
   * a room saved before this existed rehydrates with wallAt = nightAt, which
   * replays that night at its current speed — one eviction's worth of drift on
   * a cosmetic timeline, against refusing an otherwise-good save. */
  wallBase?: number;
  wallAt?: number | null;
  wallFrom?: number;
  wallGlowFrom?: number;
  core: HexCore;
}

/** Cap on income credited for the gap a save spans. Covers the unsaved tail
 * (up to one flush interval of real play) plus a short eviction; long gaps are
 * NOT a passive-income faucet — elapsed time stays wall-clock, only the bank
 * is nudged. In a ~10 minute game 30s cannot shortcut anyone to a win. */
const OFFLINE_CREDIT_MS = 30_000;

/** Max pets creditable in one batch message — a tap-storm ceiling per flush. */
export const PETS_BATCH_MAX = 50;

/** How often the authority ticks income and broadcasts a snapshot — shared by
 * the room server and the client's ?debug mode so their pacing is identical. */
export const SNAPSHOT_TICK_MS = 250;

/** Lifetime total at which a day is "about done" (bank + Lab + Catnap) — only
 * used for the proctor's progress bar, never by game rules. */
const DAY_TOTAL_TARGET = 1.5e6;

function freshCore(): HexCore {
  const owned: Record<string, number> = {};
  BUILDINGS.forEach((b) => (owned[b.id] = 0));
  return { mice: 0, total: 0, clicks: 0, goldCaught: 0, owned, bought: {} };
}

/**
 * Has this game been won? The one gate on hex's win splash.
 *
 * It used to be `wonAt`: a PROCTOR's press, because the code word left the game
 * on a phone and came back as four humans reading it out, so the win was
 * witnessed rather than scored. With one player and nobody to read it to, the
 * honest translation is the neighbouring fact this has always sat next to —
 * the wall is READABLE. Reaching that IS the win now, and `setWon` is gone.
 */
export const hexWon = (s: { legibleAt: number | null }): boolean => s.legibleAt !== null;

/**
 * The full snapshot the client renders from. One per tick (~4Hz) and after
 * every intent; the client extrapolates income between them with the same
 * shared rules, so the counter stays smooth.
 */
export interface HexSnapshot extends HexSimState {
  /** The clock at send. It was the SERVER's, and the name is kept because
   * every consumer already syncs its own timeline to it — there is just one
   * clock now, so the offset it produces is zero. */
  serverTime: number;
  /** 0..1, how far along the run is. */
  progress: number;
  /** Mice/second the bank is actually accruing (base rate x dev speed) —
   * stamped here so nothing else re-runs the economy fold to draw a rate. */
  cps: number;
}

/** Everything the player can ask for. Intents only: the sim decides. */
export type HexClientMsg =
  | { type: "pets"; count: number }
  | { type: "buyBuilding"; id: string }
  | { type: "buyUpgrade"; key: string }
  | { type: "catchGold"; id: number }
  /** Start over. Was proctor-only; it is the player's own button now. */
  | { type: "reset" };

export class HexSim {
  state: HexSimState;
  mods: HexMods;
  private goldTimer = 0; // seconds until next spawn while none is up
  private goldSeq = 0;
  private lastTick: number;

  constructor(now: number) {
    this.state = {
      ...freshCore(),
      runId: 1,
      startedAt: now,
      zoomUntil: 0,
      gold: null,
      nightAt: null,
      legibleAt: null,
      wallBase: 0,
      wallAt: null,
      wallFrom: 0,
      wallGlowFrom: 0,
      speed: 1,
    };
    this.mods = foldMods({}, this.state.owned);
    this.restWall();
    this.lastTick = now;
    this.scheduleGold(true);
  }

  /** Snapshot of everything worth surviving an eviction. Pure — storage I/O
   * stays in the room server, so ?debug (no storage) shares this code path
   * for free and the round-trip is unit-testable without a server. */
  persisted(now: number): HexPersistedV1 {
    const s = this.state;
    return {
      v: 1,
      savedAt: now,
      runId: s.runId,
      startedAt: s.startedAt,
      nightAt: s.nightAt,
      legibleAt: s.legibleAt,
      zoomUntil: s.zoomUntil,
      goldSeq: this.goldSeq,
      wallBase: s.wallBase,
      wallAt: s.wallAt,
      wallFrom: s.wallFrom,
      wallGlowFrom: s.wallGlowFrom,
      core: {
        mice: s.mice,
        total: s.total,
        clicks: s.clicks,
        goldCaught: s.goldCaught,
        owned: { ...s.owned },
        bought: { ...s.bought },
      },
    };
  }

  /** Rebuild from a save. Seeded from freshCore() so a building added by a
   * rebalance deploy exists (at 0) even in rooms saved before it did. */
  restore(p: HexPersistedV1, now: number): void {
    const core = freshCore();
    Object.assign(core.owned, p.core.owned);
    this.state = {
      ...core,
      mice: p.core.mice,
      total: p.core.total,
      clicks: p.core.clicks,
      goldCaught: p.core.goldCaught,
      bought: { ...p.core.bought },
      runId: p.runId,
      startedAt: p.startedAt,
      zoomUntil: p.zoomUntil,
      gold: null,
      nightAt: p.nightAt,
      legibleAt: p.legibleAt,
      wallBase: p.wallBase ?? 0,
      wallAt: p.wallAt ?? p.nightAt,
      wallFrom: 0,
      wallGlowFrom: 0,
      speed: 1,
    };
    this.goldSeq = p.goldSeq;
    this.recalc();
    // After the fold, so a save written before these existed lands on "no
    // hand-over running" rather than on a rate of zero the wall would crawl at
    // and a glow it would fade up from.
    this.restWall();
    if (p.wallFrom !== undefined) this.state.wallFrom = p.wallFrom;
    if (p.wallGlowFrom !== undefined) this.state.wallGlowFrom = p.wallGlowFrom;
    this.lastTick = now;
    this.scheduleGold(true);
    // Capped credit for the gap, at the RESTORED build rate. Elapsed time is
    // wall-clock on purpose: an eviction makes the proctor's timer jump, and
    // nothing else — the reveal keys off total, not elapsed time.
    const gapSec =
      Math.min(Math.max(0, now - p.savedAt), OFFLINE_CREDIT_MS) / 1000;
    const inc = this.baseCps() * gapSec;
    if (inc > 0) {
      this.state.mice += inc;
      this.state.total += inc;
    }
  }

  reset(now: number): void {
    const runId = this.state.runId + 1;
    this.state = {
      ...freshCore(),
      runId,
      startedAt: now,
      zoomUntil: 0,
      gold: null,
      nightAt: null,
      legibleAt: null,
      wallBase: 0,
      wallAt: null,
      wallFrom: 0,
      wallGlowFrom: 0,
      speed: 1,
    };
    this.recalc();
    this.restWall();
    this.lastTick = now;
    this.scheduleGold(true);
  }

  /** Debug-only: mint mice from nothing. Counts toward lifetime total, so it
   * moves the wall ramp and unlock thresholds exactly like earned income. */
  grant(amount: number, now: number): void {
    const n = Math.max(0, Number(amount) || 0);
    if (n === 0) return;
    this.state.mice += n;
    this.state.total += n;
    this.checkLegible(now);
  }

  /** Debug-only: put a golden up NOW. Day-only like tick(); returns false at
   * night, which greys the panel's button. A golden in flight is REPLACED (new
   * id, so the client re-places it), not extended; the natural timer only runs
   * while none is up, so it needs no touching. */
  spawnGold(now: number): boolean {
    if (this.night()) return false;
    this.mintGold(now);
    return true;
  }

  /** Debug-only: jump the run to a story beat. Runs through reset() first, so
   * runId bumps and clients treat the jump as a fresh boot (unlocks, seen
   * flags and FX state all re-derive rather than leaking across the jump). */
  applyPreset(p: HexPreset, now: number): void {
    this.reset(now);
    const s = this.state;
    s.total = p.total;
    s.mice = p.mice;
    s.clicks = p.clicks ?? 0;
    s.goldCaught = p.golden ?? 0;
    Object.assign(s.owned, p.owned);
    for (const k of p.bought ?? []) s.bought[k] = 1;
    debugDerivedBought(s);
    // A `twist` preset spells out the DAY it came out of, so the derivation above
    // ran against that day and the flip is the SAME wipe buyUpgrade runs. Order
    // matters: after the derivation, or the day hands over nothing; before
    // recalc, or the mods fold from buildings this state no longer owns.
    if (p.twist) nightReset(s);
    this.recalc();
    if (this.night()) {
      // The preset IS the flip: stamp it so elapsed-time UI reads sanely, clear
      // any golden (day-only, see tick()), and start the odometer here at the
      // speed the preset's purchases imply — a jump has no hand-over to replay.
      s.nightAt = now;
      s.wallBase = 0;
      s.wallAt = now;
      this.restWall();
      s.gold = null;
    }
    this.checkLegible(now);
  }

  night(): boolean {
    return nightOf(this.state.bought);
  }

  baseCps(): number {
    return baseCpsWith(this.mods, this.state.owned);
  }

  /** 0..1 for the proctor's progress bar: day is the first half, the wall
   * becoming readable is the second. */
  progress(): number {
    if (this.state.legibleAt) return 1;
    if (this.night())
      return 0.5 + 0.5 * Math.min(1, wallCoverage(this.mods) / LEGIBLE_COV);
    return 0.5 * Math.min(1, this.state.total / DAY_TOTAL_TARGET);
  }

  private recalc(): void {
    this.mods = foldMods(this.state.bought, this.state.owned);
  }

  /** Park the wall clock's from-values ON their current targets, i.e. "nothing is
   * handing over". Every anchor that is not a CHANGE wants this — a fresh sim, a
   * reset, a restore, the twist itself, a preset jump — because the ramp exists to
   * replay a purchase, and none of those is one. Must run after recalc(). */
  private restWall(): void {
    this.state.wallFrom = wallSpeed(this.mods);
    this.state.wallGlowFrom = wallGlow(this.mods);
  }

  /** Put a golden up as of `now`. The one place a HexGold is constructed, so
   * the timer's spawn and the debug button's cannot drift in life or id. */
  private mintGold(now: number): void {
    this.state.gold = {
      id: ++this.goldSeq,
      bornAt: now,
      life: goldLifeS(this.mods),
      seed: (Math.random() * 0x7fffffff) | 0,
    };
  }

  private scheduleGold(first: boolean): void {
    const lo = first ? GOLD_FIRST_MIN_S : GOLD_MIN_S;
    const hi = first ? GOLD_FIRST_MAX_S : GOLD_MAX_S;
    this.goldTimer = (lo + Math.random() * (hi - lo)) / this.mods.goldenFreq;
  }

  private checkLegible(now: number): void {
    // Against the CACHED mods — recalc() keeps them current on every purchase,
    // and this runs on the sim's hottest path (every tick and pets batch).
    if (!this.state.legibleAt && wallCoverage(this.mods) >= LEGIBLE_COV)
      this.state.legibleAt = now;
  }

  /** Advance passive income + golden mouse scheduling to `now`. */
  tick(now: number): void {
    const dt = Math.max(0, Math.min(2, (now - this.lastTick) / 1000));
    this.lastTick = now;
    const s = this.state;
    const inc = this.baseCps() * dt * s.speed;
    if (inc > 0) {
      s.mice += inc;
      s.total += inc;
    }
    // Goldens are DAY-ONLY: Zoomies multiplies PET power, which mints nothing
    // once Hex is asleep — a golden at night would be a tappable prop paying
    // zero, drifting over the reveal.
    if (this.night()) {
      s.gold = null;
    } else if (s.gold) {
      if (now > s.gold.bornAt + s.gold.life * 1000) {
        s.gold = null;
        this.scheduleGold(false);
      }
    } else {
      this.goldTimer -= dt * s.speed;
      if (this.goldTimer <= 0) this.mintGold(now);
    }
    this.checkLegible(now);
  }

  /** Credit a batch of pets. Night pets mint nothing (the client shows the
   * sleepy "Zzz" locally and never sends them). Returns mice minted. */
  pets(count: number, now: number): number {
    if (this.night()) return 0;
    const n = Math.max(0, Math.min(PETS_BATCH_MAX, Math.floor(count)));
    if (n === 0) return 0;
    const zoom = now < this.state.zoomUntil ? this.mods.zoomMult : 1;
    const gain = clickBaseWith(this.mods, this.state.owned) * zoom * n;
    this.state.mice += gain;
    this.state.total += gain;
    this.state.clicks += n;
    this.checkLegible(now);
    return gain;
  }

  buyBuilding(id: string, now: number): boolean {
    const b = BUILDINGS.find((x) => x.id === id);
    if (!b || !isRevealed(b, this.state)) return false;
    const price = costOf(b, this.state.owned[b.id]);
    if (this.state.mice < price) return false;
    this.state.mice -= price;
    this.state.owned[b.id] += 1;
    // REQUIRED, not defensive: crossBuilding/clickPerBuilding read owned, so
    // their multipliers are only correct as of the last recalc.
    this.recalc();
    this.checkLegible(now);
    return true;
  }

  buyUpgrade(key: string, now: number): boolean {
    const u = UPGRADES.find((x) => x.key === key);
    if (!u || this.state.bought[u.key] || !unlockMet(u, this.state)) return false;
    // Phase enforcement, same rule the shop rail renders by: the client never
    // shows off-phase rows; this guards the wire.
    if (!onRail(u, this.state.bought)) return false;
    if (this.state.mice < u.cost) return false;
    const nightBefore = this.night();
    // Read BEFORE the fold, twice: *Target is the change test (a purchase that
    // touches neither leaves a running hand-over alone); *Now is what gets
    // banked, so a change landing INSIDE a hand-over — a fast team buys the
    // second pace rung inside the first's 1.4s — continues from the speed and
    // glow on screen rather than snapping to the old targets. Glow is tracked
    // apart from speed: Lucid Dreaming I moves the pace, not the light.
    const speedTarget = wallSpeed(this.mods);
    const glowTarget = wallGlow(this.mods);
    const speedNow = wallRateAt(this.state, speedTarget, now);
    const glowNow = wallGlowAt(this.state, this.mods, now);
    this.state.mice -= u.cost;
    this.state.bought[u.key] = 1;
    this.recalc();
    if (!nightBefore && this.night()) {
      // THE TWIST: hard reset into the dream economy. Clients see the flip in
      // the snapshot diff and play the cutscene themselves.
      this.state.nightAt = now;
      nightReset(this.state);
      this.state.gold = null;
      this.recalc();
      // The wall starts walking at the twist's own timestamp, so every phone
      // derives the same opening frame. It starts AT the unlit values (restWall).
      this.state.wallBase = 0;
      this.state.wallAt = now;
      this.restWall();
    } else if (this.state.wallAt !== null) {
      // A change to EITHER quantity banks the distance walked so far and
      // re-anchors — once, here, so every phone agrees. wallUnitsAt against the
      // clock as it stands banks the EASED distance when a change lands mid
      // hand-over. See HexWallClock in rules.ts.
      if (
        wallSpeed(this.mods) !== speedTarget ||
        wallGlow(this.mods) !== glowTarget
      ) {
        this.state.wallBase = wallUnitsAt(this.state, speedTarget, now);
        this.state.wallAt = now;
        this.state.wallFrom = speedNow;
        this.state.wallGlowFrom = glowNow;
      }
    }
    this.checkLegible(now);
    return true;
  }

  /** Assemble the snapshot. The ONE place this happens, so derived fields
   * (progress, cps) cannot drift from the state they are derived from.
   *
   * `codeword` is gone with the proctor: it was that dashboard's readout of
   * "is this team's wall legible yet". The player's win screen never read it —
   * it shows HEX_CODEWORD flat, because a screen that only exists after the
   * win has nothing to gate on. */
  snapshot(now: number): HexSnapshot {
    return {
      ...this.state,
      serverTime: now,
      progress: this.progress(),
      cps: this.baseCps() * this.state.speed,
    };
  }

  catchGold(id: number, now: number): boolean {
    const g = this.state.gold;
    if (!g || g.id !== id) return false;
    this.state.goldCaught++;
    this.state.zoomUntil = now + this.mods.zoomTime * 1000;
    this.state.gold = null;
    this.scheduleGold(false);
    return true;
  }
}
