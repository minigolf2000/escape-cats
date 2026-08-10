// The authoritative Hex Clicker simulation. The PartyKit server wraps one of
// these per room (network transport only); the client's ?debug mode runs one
// in-page. There is exactly one implementation of "what a purchase does".
//
// All timestamps are epoch milliseconds supplied by the caller (`now`), never
// read from a clock here — that keeps the sim deterministic enough to test and
// lets the server stamp everything from one Date.now() per message.

import { BUILDINGS, UPGRADES, HEX_CODEWORD } from "./data";
import { debugDerivedBought, type HexPreset } from "./presets";
import type { HexSnapshot, PlayerInfo, TapEvent } from "../protocol";
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
   * authority whenever wallSpeed changes (Paper Lantern is the one row that
   * does). Every phone reads position off this pair rather than integrating
   * locally, so a phone that joins mid-night lands on the same frame as the
   * rest of the room. See HexWallClock in rules.ts. */
  wallBase: number;
  wallAt: number | null;
  /** Dev time-scale (?debug only) — multiplies passive income + golden cadence,
   * never click feel. A real room never leaves 1. */
  speed: number;
}

/**
 * The wire-format for a room's saved game — everything a Durable Object
 * eviction would otherwise erase. Versioned so a deploy that changes the shape
 * refuses stale data instead of rehydrating garbage into a live room.
 *
 * Deliberately absent:
 *  - mods       — derived (foldMods) on restore, so a rebalance deploy applies
 *                 to live rooms instead of freezing the old table.
 *  - gold       — wall-clock lifetimes mean it is expired after any gap;
 *                 restore reschedules instead. Costs one missed golden.
 *  - speed      — ?debug-only time-scale: a real room never leaves ×1, and
 *                 ?debug runs storageless, so there is nothing to save.
 *  - lastTick / gold timer — restart-local by definition.
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
      speed: 1,
    };
    this.mods = foldMods({}, this.state.owned);
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
      speed: 1,
    };
    this.goldSeq = p.goldSeq;
    this.recalc();
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
      speed: 1,
    };
    this.recalc();
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
    this.recalc();
    if (this.night()) {
      // The preset IS the flip: stamp it now so elapsed-time UI reads sanely,
      // and clear any golden — they are day-only (see tick()). The wall's
      // odometer starts here too, at whatever speed the preset's purchases
      // imply — a jump has no history to bank.
      s.nightAt = now;
      s.wallBase = 0;
      s.wallAt = now;
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
      if (this.goldTimer <= 0) {
        s.gold = {
          id: ++this.goldSeq,
          bornAt: now,
          life: goldLifeS(this.mods),
          seed: (Math.random() * 0x7fffffff) | 0,
        };
      }
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
    // Read BEFORE the fold: banking the odometer needs the rate the wall has
    // actually been walking at, not the one this purchase just set.
    const speedBefore = wallSpeed(this.mods);
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
      // The wall starts walking here, at the twist's own timestamp, so every
      // phone derives the same opening frame however late it joins.
      this.state.wallBase = 0;
      this.state.wallAt = now;
    } else if (this.state.wallAt !== null) {
      // A rate change (Paper Lantern) banks the distance walked so far and
      // re-anchors — continuous for every mouse, and identical on every phone
      // because the authority does it once. See HexWallClock in rules.ts.
      const speedAfter = wallSpeed(this.mods);
      if (speedAfter !== speedBefore) {
        this.state.wallBase = wallUnitsAt(this.state, speedBefore, now);
        this.state.wallAt = now;
      }
    }
    this.checkLegible(now);
    return true;
  }

  /** Assemble the wire snapshot. The ONE place this happens — the room server
   * and the ?debug mode both call it, so derived fields (progress, cps) and the
   * codeword gate ("the word never leaves before the wall is legible") cannot
   * drift between them. */
  snapshot(now: number, players: PlayerInfo[], taps: TapEvent[] = []): HexSnapshot {
    return {
      ...this.state,
      players,
      taps,
      serverTime: now,
      progress: this.progress(),
      cps: this.baseCps() * this.state.speed,
      codeword: this.state.legibleAt ? HEX_CODEWORD : null,
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
