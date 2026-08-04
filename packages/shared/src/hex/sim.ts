// The authoritative Hex Clicker simulation. The PartyKit server wraps one of
// these per room (network transport only); the client's ?solo mode runs one
// in-page. There is exactly one implementation of "what a purchase does".
//
// All timestamps are epoch milliseconds supplied by the caller (`now`), never
// read from a clock here — that keeps the sim deterministic enough to test and
// lets the server stamp everything from one Date.now() per message.

import { BUILDINGS, UPGRADES } from "./data";
import {
  type HexCore,
  type HexMods,
  NIGHT_ROW_KEYS,
  costOf,
  foldMods,
  nightOf,
  nightReset,
  baseCpsWith,
  clickBaseWith,
  unlockMet,
  isRevealed,
  isLegible,
  wallCoverage,
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
  /** Dev time-scale (proctor only) — multiplies passive income + golden cadence,
   * never click feel. 1 in real sessions. */
  speed: number;
}

/** Max pets creditable in one batch message — a tap-storm ceiling per flush. */
export const PETS_BATCH_MAX = 50;

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
      speed: 1,
    };
    this.mods = foldMods({}, this.state.owned);
    this.lastTick = now;
    this.scheduleGold(true);
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
      speed: 1,
    };
    this.recalc();
    this.lastTick = now;
    this.scheduleGold(true);
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
      return (
        0.5 +
        0.5 *
          Math.min(1, wallCoverage(this.mods, this.state.total) / LEGIBLE_COV)
      );
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
    if (!this.state.legibleAt && isLegible(this.state))
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
    // Phase enforcement, same rule as the shop rail: at night the day research
    // is off the rail entirely (the day economy has been wiped, so those rows
    // would price improvements to buildings you no longer own). The client
    // never shows them; this guards the wire.
    if (this.night() && !NIGHT_ROW_KEYS.has(u.key)) return false;
    if (this.state.mice < u.cost) return false;
    const nightBefore = this.night();
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
    }
    this.checkLegible(now);
    return true;
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
