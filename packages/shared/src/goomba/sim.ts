// The authoritative Goomba Glider ROOM state — who has placed which band,
// which level the team is on, whether a run is in flight, and which levels are
// done.
//
// Same shape as hex/sim.ts: the Durable Object wraps one of these per team and
// is transport only. Unlike hex there is no economy ticking away — the room
// mutates only on player intents, plus one deterministic transition when a run
// finishes. A run is SCORED the instant PLAY lands (the physics is
// deterministic, so the server steps all ~15s of substeps synchronously in a
// few ms); what remains "in flight" is only the phones' animation of it, so
// run-end is a timestamp comparison, not a timer the object must stay awake
// for. resolve(now) applies it lazily on the next message/connect/tick.

import type { PlayerInfo } from "../protocol";
import { GOOMBA_LEVELS, MAX_BANDS, BAND_MIN, BAND_MAX } from "./levels";
import type { LevelPack } from "./pack";
import { snapBand, scoreRun, type GoombaBand, type RunResult } from "./physics";

/**
 * `edit` → `run` → (`win` | back to `edit`), plus one terminal screen:
 *
 * `splash` is where NEXT lands after the finale of a room that has cleared
 * every level — the party's curtain call rather than a victory lap on the last
 * level. Nothing may be placed or played from it; the only ways out are the
 * level selector (a `goto`, which the clear itself unlocks — see
 * `goombaCleared`) and a proctor `reset`.
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
  /** Failed attempts on the current level — the proctor's "how stuck are
   * they" read. */
  fails: number;
  /** Epoch ms every level went done, else null — the proctor's finish line,
   * and the room's "we cleared it" flag (see `goombaCleared`). */
  finishedAt: number | null;
}

export interface GoombaPersistedV1 {
  v: 1;
  savedAt: number;
  state: GoombaSimState;
}

/** A teammate's band-in-progress: the ghost they are stretching RIGHT NOW,
 * streamed while they drag and gone when they release. Presentation only —
 * the sim never reads these; they exist so the other phones can watch a
 * band take shape (and yell about where it should go). Same deal as hex's
 * teammate taps: ephemeral, never persisted, rides the snapshot.
 *
 * A preview SHORTER than BAND_MIN means "I'm choosing here", not "here is my
 * band" — it can't become one, since the sim would reject it. That's how the
 * tap-tap placement streams its waiting first tap: both ends on the same
 * point. Clients draw those as a marker rather than a band ghost; no extra
 * wire shape, and a half-finished drag reads honestly the same way. */
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
  /** Stop watching a run early (any player) — back to edit, scored as a fail
   * only if the scored result was one. */
  | { type: "stop" }
  /** Advance after a win (any player). */
  | { type: "next" }
  /** Level-selector jump: point the WHOLE ROOM at a level (any player). The
   * selector is what a team EARNS by clearing every level (`goombaCleared`);
   * `?debug` is only a local override of that gate, so the intent itself stays
   * open to any player — the party's own phones are the trusted tool here,
   * exactly as `play`/`next` already assume. */
  | { type: "goto"; level: number }
  // ---- editing the level pack, from inside the game.
  //
  // These ride the ROOM socket rather than the lobby's, because the lobby
  // socket is closed the moment a phone learns its team — and because the room
  // is the authority a player is actually talking to. The room forwards them to
  // the lobby, which owns the pack and tells every room about the write.
  /** Paste a level in: `index` null appends a slot, otherwise replaces one. */
  | { type: "packSet"; index: number | null; hash: string }
  | { type: "packMove"; from: number; to: number }
  | { type: "packDelete"; index: number }
  | { type: "packAll"; pack: LevelPack }
  | { type: "reset" }; // proctor only

export type GoombaServerMsg =
  | { type: "state"; state: GoombaSnapshot }
  /**
   * **The level pack**, sent on connect and again whenever it changes.
   *
   * A separate message rather than a field on the snapshot, because snapshots
   * go out on every intent — including band previews at 10Hz while someone is
   * dragging. Riding along there would put the whole pack (a couple of KB) on
   * the wire ten times a second, per phone, to say nothing new.
   */
  | { type: "pack"; v: number; pack: LevelPack };

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// ---------------------------------------------------------------------------
// The four bands
// ---------------------------------------------------------------------------

/**
 * **The band budget, and now the whole of it: `MAX_BANDS` bands per level,
 * shared by whoever is in the room.**
 *
 * There used to be a second half — a per-player quota of ⌈`MAX_BANDS` / players
 * in the room⌉, so that four players were forced to lay exactly one band each —
 * and it is deliberately gone. Nobody owns a band. Any player may lay any of
 * the four, take back any of them (their own or a teammate's), and clear the
 * board. The game is multiplayer because four people are arguing over the same
 * four bands, not because the room hands each of them a token; a player who
 * wants to lay three of them while a teammate reads the level out loud is
 * playing it right.
 *
 * So the predicate is just "is there a band left to lay". It stays shared
 * between the client and the authority for the reason it always was: the phone
 * greys the gesture out with the same rule the server rejects it by, so a
 * refused tap is never a silent one.
 */
export const canPlaceBand = (bands: GoombaBand[]): boolean => bands.length < MAX_BANDS;

// ---------------------------------------------------------------------------
// The clear, and what it unlocks
// ---------------------------------------------------------------------------

/**
 * **Has this ROOM cleared the game?** Every level done, which is exactly what
 * `finishedAt` records (set once, in `resolve`, the moment the last flag flips).
 *
 * Room state, not per-phone state: the team clears it together, so all four
 * phones unlock the level selector on the same snapshot — and a proctor
 * `reset` takes it back, because it is the same field the finish line is.
 * `?debug` is a client-side override of this gate and nothing more; nothing on
 * the authority knows or cares which phones are holding one.
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
    fails: 0,
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
      s.fails++;
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

  /** `pid` rides along on the band as a note of who laid it — nothing reads it
   * as a rule any more (see `canPlaceBand`), and any player may take any band
   * back. */
  place(
    pid: string,
    msg: { ax: unknown; ay: unknown; bx: unknown; by: unknown },
    now: number,
  ): void {
    this.resolve(now);
    const s = this.st;
    if (s.phase !== "edit") return;
    // A free band, and that is the whole permission check. The client greys the
    // gesture out with the same predicate; this is what makes it true.
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
    // Snapping happens HERE, once, on the authority — so the run every phone
    // animates uses exactly the endpoints the server scored with.
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

  stop(now: number): void {
    // Cutting a run short: score it as the fail/win it already was, now.
    const s = this.st;
    if (s.phase !== "run" || s.runAt === null) return;
    s.runAt = now - (s.runT ?? 0) * 1000 - 1;
    this.resolve(now);
  }

  /** The level selector's jump: fresh edit phase on the chosen level, for
   * everyone in the room. Completed flags are untouched — jumping earns
   * nothing. Legal from the splash too, which is how a cleared room picks its
   * next victory lap. Also the solo (?solo) backend's card-tap, so both run
   * the same transition. */
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
    s.fails = 0;
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
    s.fails = 0;
    // The finale of a cleared room lands on the splash instead of a victory
    // lap, and stays pointed at the finale behind it — a `goto` out of the
    // splash is what picks the next level now, and clearing the game is what
    // handed the team that selector.
    if (splash) return;
    // Otherwise: on to the next level, or (past the last one, with levels still
    // open) wrap to the first that isn't done.
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
   * Fit the room to the level pack it is now looking at.
   *
   * This used to be a once-per-boot correction for a list that changed in a
   * DEPLOY. The pack is live data now — someone can paste, reorder or delete a
   * level while a team is mid-session — so it is a transition the room takes
   * whenever the pack lands, and it is the whole of "apply immediately, keep
   * progress":
   *
   *  - `completed` is re-fitted to the new length: flags past the end fall off,
   *    new slots read as not-done rather than as undefined.
   *  - `level` is clamped back inside the pack, so a team standing on a level
   *    that was just deleted lands on the last one rather than on nothing.
   *  - a run in flight is abandoned, because it was scored against geometry
   *    that may no longer be there — finishing it would credit a level nobody
   *    played.
   *
   * What it deliberately does NOT do is remap flags by identity. A delete
   * shifts every level after it, so a cleared flag can end up describing its
   * neighbour. That is the known cost of editing live, and it is cheap next to
   * the alternative of wiping a team's progress every time someone fixes a
   * typo in Figma.
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
    // The finish line is "every level done", and that answer just changed in
    // both directions: a new level un-clears a cleared room, and deleting the
    // last unfinished one clears it.
    const all = n > 0 && s.completed.every(Boolean);
    if (!all) s.finishedAt = null;
    else if (s.finishedAt === null) s.finishedAt = now;
    if (n === 0) s.phase = s.phase === "splash" ? "splash" : "edit";
    this.resolve(now);
  }
}
