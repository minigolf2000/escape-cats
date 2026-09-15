// The Goomba Glider game state: bands, level, phase, which levels are done.
// Same shape as hex/sim.ts. It mutates only on player intents plus one
// transition when a run finishes: a run is SCORED the instant PLAY lands, what
// is "in flight" is only the animation, so run-end is a timestamp comparison
// applied lazily by resolve(now) — which is what lets a backgrounded tab, one
// that missed every frame, resolve correctly the moment it comes back.
//
// It used to be the authority a Durable Object wrapped, one per team. "Room"
// survives in a few names below because the state it describes is unchanged.

import { GOOMBA_LEVELS, MAX_BANDS, BAND_MIN, BAND_MAX } from "./levels";
import { snapBand, scoreRun, type GoombaBand, type RunResult } from "./physics";

/**
 * `edit` → `run` → (`win` | back to `edit`), plus `splash`: THE FINALE, which
 * the last flag going up lands on directly (`resolve` — the clearing win never
 * passes through `win`, so there is no banner and no NEXT to press). It is
 * TERMINAL: nothing may be placed, played or jumped to from it, and the only
 * ways off are `reset` and a level-list edit that un-clears the game
 * (`reconcile`).
 */
export type GoombaPhase = "edit" | "run" | "win" | "splash";

export interface GoombaSimState {
  /** Bumped on every reset — the client treats a new runId as a fresh boot. */
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
  /** Epoch ms every level went done, else null — the "we cleared it" flag
   * (see `goombaCleared`). */
  finishedAt: number | null;
}

export interface GoombaPersistedV1 {
  v: 1;
  savedAt: number;
  state: GoombaSimState;
}

export interface GoombaSnapshot extends GoombaSimState {
  /** The clock at send. It was the SERVER's, and the name is kept because the
   * run animation still syncs to `runAt` on this timeline — there is just one
   * clock now, so the offset it produces is zero. */
  serverTime: number;
  /** 0..1: levels completed / levels. */
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
  /** Take a band back. `index` into `bands`. */
  | { type: "remove"; index: number }
  | { type: "clear" }
  | { type: "play" }
  /** Stop watching a run early — back to edit with the bands still down and
   * NOTHING scored, neither a clear nor a fail. See `stop`. */
  | { type: "stop" }
  /** Advance after a win (any player). */
  | { type: "next" }
  /** Level-selector jump: point the WHOLE ROOM at a level. Open to any player
   * (`?debug` is only a local override of the client gate) — the party's own
   * phones are the trusted tool, as `play`/`next` already assume. */
  | { type: "goto"; level: number }
  // ---- editing the level list. The client's backend applies these to the
  // LOCAL overlay only; the shipped levels are source (`goomba/library.ts`).
  /** Paste a level in: `index` null appends a slot, otherwise replaces one. */
  | { type: "packSet"; index: number | null; hash: string }
  | { type: "packMove"; from: number; to: number }
  | { type: "packDelete"; index: number }
  /** Start over. Was proctor-only; it is the player's own button now. */
  | { type: "reset" };

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * The whole band budget: `MAX_BANDS` per level. Shared with the client so a
 * gesture is greyed out by the same rule the sim refuses it with.
 */
export const canPlaceBand = (bands: GoombaBand[]): boolean => bands.length < MAX_BANDS;

/**
 * Are there POST-CREDITS levels — any marked `bonus` (`goomba/library.ts`)?
 * The finale is terminal only when there are not: with a bonus section behind
 * it, the ending has somewhere to let you out to.
 */
export const hasBonusLevels = (): boolean => GOOMBA_LEVELS.some((L) => L.bonus === true);

/**
 * Has the MAIN game been cleared — every level that is NOT post-credits?
 *
 * This is what the finale fires on, and it used to be "every level, full
 * stop". The bonus section sits BEHIND the ending, so counting it would mean
 * the game could never say goodbye until the extras were done too.
 *
 * A list with nothing but bonus levels is never cleared (`any` stays false):
 * an ending needs something to be the end OF.
 */
function mainCleared(completed: boolean[]): boolean {
  let any = false;
  for (let i = 0; i < GOOMBA_LEVELS.length; i++) {
    if (GOOMBA_LEVELS[i].bonus) continue;
    any = true;
    if (completed[i] !== true) return false;
  }
  return any;
}

/**
 * Has the game been cleared? The gate on the level selector — which, now that
 * there are post-credits levels, is also the DOOR to them. `?debug` and `\`
 * are client-side overrides of it and nothing more.
 */
export const goombaCleared = (s: GoombaSimState): boolean => s.finishedAt !== null;

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
      s.completed[s.level] = true;
      // The win that clears the MAIN game skips `win` altogether: the ride ends
      // on the splash, on the frame Goomba reaches the plant. Every other win
      // stops for its banner and its NEXT — including every post-credits win,
      // which happens after the game has already said goodbye.
      //
      // ONCE, on the first time: `finishedAt` is the latch. Clearing a bonus
      // level must not re-run the ending, and neither must re-clearing a main
      // level the player went back to.
      const firstClear = s.finishedAt === null && mainCleared(s.completed);
      if (firstClear) s.finishedAt = now;
      s.phase = firstClear ? "splash" : "win";
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

  /** The selector's jump: fresh edit phase on the chosen level. Completed
   * flags untouched.
   *
   * From the SPLASH only when there are post-credits levels to jump to. With
   * none, the finale is terminal and this is the intent that would leave it. */
  goto(level: unknown, now: number): void {
    this.resolve(now);
    if (!Number.isInteger(level)) return;
    const li = level as number;
    if (li < 0 || li >= GOOMBA_LEVELS.length) return;
    const s = this.st;
    if (s.phase === "splash" && !hasBonusLevels()) return;
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
    // Never the finale: the win that clears the room went straight to the
    // splash and this button was never drawn (`resolve`).
    s.phase = "edit";
    s.bands = [];
    s.runAt = null;
    s.runResult = null;
    s.runT = null;
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

  snapshot(now: number): GoombaSnapshot {
    this.resolve(now);
    const done = this.st.completed.filter(Boolean).length;
    return {
      ...this.st,
      serverTime: now,
      progress: GOOMBA_LEVELS.length ? done / GOOMBA_LEVELS.length : 0,
      levelCount: GOOMBA_LEVELS.length,
    };
  }

  persisted(now: number): GoombaPersistedV1 {
    this.resolve(now);
    return { v: 1, savedAt: now, state: this.st };
  }

  /**
   * Rebuild from a save. `completed` is the caller's own projection of its
   * durable record onto the list that is loaded NOW, and it is applied BEFORE
   * `reconcile` runs — which is the whole point of the parameter.
   *
   * Without it, reconcile's first look is at the save's own `completed`, an
   * array indexed against whatever list existed when it was written. Ship a
   * level and that array is stale: a finished game can read as unfinished for
   * one reconcile, which is long enough to take the finale's splash away
   * (`s.phase === "splash" && !all` below) and nothing puts it back.
   */
  restore(saved: GoombaPersistedV1, now: number, completed?: boolean[]): void {
    this.st = saved.state;
    if (completed) this.st.completed = completed;
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
    // "The main game is done" can change in both directions: a new main level
    // un-clears the game, deleting the last unfinished one clears it.
    const all = mainCleared(s.completed);
    if (!all) s.finishedAt = null;
    else if (s.finishedAt === null) s.finishedAt = now;
    if (n === 0) s.phase = s.phase === "splash" ? "splash" : "edit";
    // The splash is terminal only while the game is still CLEARED: adding a
    // main level un-clears it above, and there is somewhere to be again. An
    // emptied list keeps the finale, having nothing to show instead.
    if (s.phase === "splash" && !all && n > 0) {
      s.phase = "edit";
      s.bands = [];
      const open = s.completed.findIndex((c) => !c);
      if (open >= 0) s.level = open;
    }
    this.resolve(now);
  }
}
