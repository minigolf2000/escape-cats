// The authoritative Goomba Glider ROOM state: bands, level, phase, which
// levels are done. Same shape as hex/sim.ts — the Durable Object wraps one per
// team and is transport only. The room mutates only on player intents plus one
// transition when a run finishes: a run is SCORED the instant PLAY lands, what
// is "in flight" is only the phones' animation, so run-end is a timestamp
// comparison applied lazily by resolve(now).

import type { PlayerInfo } from "../protocol";
import { GOOMBA_LEVELS, MAX_BANDS, BAND_MIN, BAND_MAX } from "./levels";
import type { LevelPack } from "./pack";
import { snapBand, scoreRun, type GoombaBand, type RunResult } from "./physics";

/**
 * `edit` → `run` → (`win` | back to `edit`), plus `splash`: where NEXT lands
 * after the finale of a room that has cleared every level. Nothing may be
 * placed or played from it; the ways out are a `goto` (the selector, which the
 * clear unlocks — `goombaCleared`) and a proctor `reset`.
 */
export type GoombaPhase = "edit" | "run" | "win" | "splash";

export interface GoombaSimState {
  /** Bumped on every proctor reset — clients treat a new runId as a fresh boot. */
  runId: number;
  startedAt: number; // epoch ms this room first saw a player intent
  level: number;
  phase: GoombaPhase;
  bands: GoombaBand[];
  /** One flag per level. "How many levels completed" is this, counted. */
  completed: boolean[];
  /** Set while phase is "run" (and kept through "win" for the toast):
   * when the run started (epoch ms, server clock) and how it was scored. */
  runAt: number | null;
  runResult: RunResult | null;
  /** Seconds the scored run lasts — phones animate exactly this long. */
  runT: number | null;
  /** Epoch ms every level went done, else null — the proctor's finish line,
   * and the room's "we cleared it" flag (see `goombaCleared`). */
  finishedAt: number | null;
}

export interface GoombaPersistedV1 {
  v: 1;
  savedAt: number;
  state: GoombaSimState;
}

/** A teammate's band-in-progress, streamed while they drag. Presentation
 * only — never read by the sim, never persisted, rides the snapshot.
 *
 * A preview SHORTER than BAND_MIN means "I'm choosing here": the tap-tap
 * placement streams its waiting first tap as both ends on one point, and
 * clients draw that as a marker rather than a band ghost. */
export interface GoombaBandPreview {
  pid: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Server clock (ms) of the last update — clients drop stale ghosts, so a
   * phone that dies mid-drag doesn't leave one hanging. */
  at: number;
}

export interface GoombaSnapshot extends GoombaSimState {
  players: PlayerInfo[];
  /** Teammates' bands-in-progress. Presentation only. */
  previews: GoombaBandPreview[];
  /** Server clock (ms epoch) at send — phones sync their run animation to
   * `runAt` on this timeline, so everyone watches the same moment. */
  serverTime: number;
  /** 0..1 for the proctor progress bar: levels completed / levels. */
  progress: number;
  levelCount: number;
}

export type GoombaClientMsg =
  | { type: "join"; name: string }
  | {
      type: "place";
      /** Endpoints in world units. The sim snaps and validates. */
      ax: number;
      ay: number;
      bx: number;
      by: number;
    }
  /** Take a band back. Any player may remove ANY band, including a teammate's —
   * bands are the room's, not a player's. `index` into `bands`. */
  | { type: "remove"; index: number }
  | { type: "clear" }
  /** The band being stretched right now (already snapped by the sender);
   * omitted coords = the drag ended without a placement. Presentation only —
   * never touches the sim, never persisted. */
  | { type: "preview"; ax?: number; ay?: number; bx?: number; by?: number }
  | { type: "play" }
  /** Stop watching a run early (any player) — back to edit with the bands
   * still down and NOTHING scored, neither a clear nor a fail. See `stop`. */
  | { type: "stop" }
  /** Advance after a win (any player). */
  | { type: "next" }
  /** Level-selector jump: point the WHOLE ROOM at a level. Open to any player
   * (`?debug` is only a local override of the client gate) — the party's own
   * phones are the trusted tool, as `play`/`next` already assume. */
  | { type: "goto"; level: number }
  // ---- editing the level pack. These ride the ROOM socket (the lobby's is
  // closed once a phone knows its team); the room forwards them to the lobby,
  // which owns the pack and tells every room about the write.
  /** Paste a level in: `index` null appends a slot, otherwise replaces one. */
  | { type: "packSet"; index: number | null; hash: string }
  | { type: "packMove"; from: number; to: number }
  | { type: "packDelete"; index: number }
  | { type: "packAll"; pack: LevelPack }
  | { type: "reset" }; // proctor only

export type GoombaServerMsg =
  | { type: "state"; state: GoombaSnapshot }
  /**
   * The level pack, sent on connect and whenever it changes. Separate from the
   * snapshot, which goes out on every intent including 10Hz previews.
   */
  | { type: "pack"; v: number; pack: LevelPack };

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * The whole band budget: `MAX_BANDS` per level, shared by whoever is in the
 * room. There is deliberately NO per-player quota (README, "The four bands");
 * any player may lay, lift or clear any band. Shared with the client so the
 * phone greys the gesture out by the rule the server rejects it with.
 */
export const canPlaceBand = (bands: GoombaBand[]): boolean => bands.length < MAX_BANDS;

/**
 * Has this ROOM cleared the game? Room state, so all four phones unlock the
 * selector on the same snapshot and a proctor `reset` takes it back. `?debug`
 * is a client-side override of this gate and nothing more.
 */
export const goombaCleared = (s: GoombaSimState): boolean => s.finishedAt !== null;

/** Where NEXT goes from the current win: the splash iff this is the finale of a
 * cleared room. One copy so the sim's transition and the button that triggers
 * it cannot disagree about which it is. */
export const nextLeadsToSplash = (s: GoombaSimState): boolean =>
  s.phase === "win" && s.level === GOOMBA_LEVELS.length - 1 && goombaCleared(s);

function freshState(now: number): GoombaSimState {
  return {
    runId: 1,
    startedAt: now,
    level: 0,
    phase: "edit",
    bands: [],
    completed: GOOMBA_LEVELS.map(() => false),
    runAt: null,
    runResult: null,
    runT: null,
    finishedAt: null,
  };
}

export class GoombaSim {
  st: GoombaSimState;

  constructor(now: number) {
    this.st = freshState(now);
  }

  /** Apply the finished run if the phones' animation of it has played out.
   * Callers invoke this with every message and on connect; the server also
   * arms one short timeout so the transition lands even in a silent room. */
  resolve(now: number): boolean {
    const s = this.st;
    if (s.phase !== "run" || s.runAt === null || s.runT === null) return false;
    if (now < s.runAt + s.runT * 1000) return false;
    if (s.runResult === "win") {
      s.phase = "win";
      s.completed[s.level] = true;
      // `[].every` is true, so an empty pack would otherwise clear the game.
      if (s.completed.length > 0 && s.completed.every(Boolean) && s.finishedAt === null)
        s.finishedAt = now;
    } else {
      s.phase = "edit";
      s.runAt = null;
      s.runT = null;
      // runResult stays for the fail toast; cleared on the next placement.
    }
    return true;
  }

  /** ms until the current run finishes, or null when no run is in flight. */
  runEndsIn(now: number): number | null {
    const s = this.st;
    if (s.phase !== "run" || s.runAt === null || s.runT === null) return null;
    return Math.max(0, s.runAt + s.runT * 1000 - now);
  }

  /** `pid` rides on the band as a note of who laid it; nothing reads it as a
   * rule. */
  place(
    pid: string,
    msg: { ax: unknown; ay: unknown; bx: unknown; by: unknown },
    now: number,
  ): void {
    this.resolve(now);
    const s = this.st;
    if (s.phase !== "edit") return;
    // A free band is the whole permission check.
    if (!canPlaceBand(s.bands)) return;
    const ax = num(msg.ax),
      ay = num(msg.ay),
      bx = num(msg.bx),
      by = num(msg.by);
    if (ax === null || ay === null || bx === null || by === null) return;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < BAND_MIN || len > BAND_MAX) return;
    const L = GOOMBA_LEVELS[s.level];
    if (!L) return; // pack emptied under us
    // Snapped HERE, once, so every phone animates the endpoints the server
    // scored with.
    s.bands.push(snapBand(L, { ax, ay, bx, by, pid }));
    s.runResult = null;
  }

  remove(index: number, now: number): void {
    this.resolve(now);
    const s = this.st;
    if (s.phase !== "edit") return;
    if (!Number.isInteger(index) || index < 0 || index >= s.bands.length) return;
    s.bands.splice(index, 1);
  }

  clear(now: number): void {
    this.resolve(now);
    if (this.st.phase !== "edit") return;
    this.st.bands = [];
  }

  play(now: number): void {
    this.resolve(now);
    const s = this.st;
    if (s.phase !== "edit") return;
    const { result, t } = scoreRun(s.level, s.bands);
    s.phase = "run";
    s.runAt = now;
    s.runResult = result;
    s.runT = t;
  }

  /** Cutting a run short is an ABORT, not a verdict: back to edit with the
   * bands down and nothing scored. Never backdate `runAt` and resolve instead:
   * PLAY becomes STOP under the same finger, so a second press would bank a
   * win nobody watched. Clearing `runResult` keeps the run→edit edge silent
   * (main.js gates the fail toast on it). */
  stop(now: number): void {
    // resolve() is lazy: a run that has already played out resolves first, or
    // aborting it would throw away an earned win.
    this.resolve(now);
    const s = this.st;
    if (s.phase !== "run") return;
    s.phase = "edit";
    s.runAt = null;
    s.runResult = null;
    s.runT = null;
  }

  /** The selector's jump: fresh edit phase on the chosen level for the whole
   * room. Completed flags untouched. Legal from the splash. */
  goto(level: unknown, now: number): void {
    this.resolve(now);
    if (!Number.isInteger(level)) return;
    const li = level as number;
    if (li < 0 || li >= GOOMBA_LEVELS.length) return;
    const s = this.st;
    s.level = li;
    s.phase = "edit";
    s.bands = [];
    s.runAt = null;
    s.runResult = null;
    s.runT = null;
  }

  next(now: number): void {
    this.resolve(now);
    const s = this.st;
    if (s.phase !== "win") return;
    const splash = nextLeadsToSplash(s);
    s.phase = splash ? "splash" : "edit";
    s.bands = [];
    s.runAt = null;
    s.runResult = null;
    s.runT = null;
    // The splash stays pointed at the finale; a `goto` picks the next level.
    if (splash) return;
    // Next level, or past the last one wrap to the first still open.
    if (s.level < GOOMBA_LEVELS.length - 1) s.level++;
    else {
      const open = s.completed.findIndex((c) => !c);
      if (open >= 0) s.level = open;
    }
  }

  reset(now: number): void {
    const runId = this.st.runId + 1;
    this.st = { ...freshState(now), runId };
  }

  snapshot(now: number, players: PlayerInfo[], previews: GoombaBandPreview[] = []): GoombaSnapshot {
    this.resolve(now);
    const done = this.st.completed.filter(Boolean).length;
    return {
      ...this.st,
      players,
      previews,
      serverTime: now,
      progress: GOOMBA_LEVELS.length ? done / GOOMBA_LEVELS.length : 0,
      levelCount: GOOMBA_LEVELS.length,
    };
  }

  persisted(now: number): GoombaPersistedV1 {
    this.resolve(now);
    return { v: 1, savedAt: now, state: this.st };
  }

  restore(saved: GoombaPersistedV1, now: number): void {
    this.st = saved.state;
    this.reconcile(now);
  }

  /**
   * Fit the room to the pack it is now looking at — the whole of "apply
   * immediately, keep progress", taken whenever the pack lands: `completed`
   * re-fitted to the new length, `level` clamped inside it, a run in flight
   * abandoned (scored against geometry that may be gone). It deliberately does
   * NOT remap flags by identity: a delete shifts every flag after it. Accepted
   * cost of editing live.
   */
  reconcile(now: number): void {
    const s = this.st;
    const n = GOOMBA_LEVELS.length;
    s.completed = GOOMBA_LEVELS.map((_, i) => s.completed[i] === true);
    s.level = Math.max(0, Math.min(s.level, n - 1));
    if (s.phase === "run") {
      s.phase = "edit";
      s.runAt = null;
      s.runResult = null;
      s.runT = null;
    }
    // "Every level done" can change in both directions: a new level un-clears
    // a room, deleting the last unfinished one clears it.
    const all = n > 0 && s.completed.every(Boolean);
    if (!all) s.finishedAt = null;
    else if (s.finishedAt === null) s.finishedAt = now;
    if (n === 0) s.phase = s.phase === "splash" ? "splash" : "edit";
    this.resolve(now);
  }
}
