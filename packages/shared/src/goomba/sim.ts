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
import { snapBand, scoreRun, type GoombaBand, type RunResult } from "./physics";

export type GoombaPhase = "edit" | "run" | "win";

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
  /** Epoch ms every level went done, else null — the proctor's finish line. */
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
  slot: number;
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
  /** Bands one player may hold right now — ⌈MAX_BANDS / connected players⌉,
   * see `bandQuota`. Derived from `players`, but stamped by the authority so
   * every surface reads the number the server is actually enforcing rather
   * than re-deriving one that could drift. */
  quota: number;
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
  /** Take a band back. Any player may remove ANY band, including a teammate's:
   * the quota counts current holdings, so removing a band hands its share back
   * to its owner and gains the remover nothing. `index` into `bands`. */
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
  /** Debug-menu jump: point the WHOLE ROOM at a level (any player — the
   * debug menu is a trusted tool on the party's own phones, sent by clients
   * opened with ?debug; there is no UI for it otherwise). */
  | { type: "goto"; level: number }
  | { type: "reset" }; // proctor only

export type GoombaServerMsg = { type: "state"; state: GoombaSnapshot };

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// ---------------------------------------------------------------------------
// The participation rule
// ---------------------------------------------------------------------------

/** How many players the band budget is divided between: the players CONNECTED
 * right now, counted by pid (two tabs on one phone are one player).
 *
 * Connected, not rostered, is the load-bearing choice. A phone that locks or
 * drops wifi keeps its seat in the roster, but its quota would then be a share
 * nobody can spend — the team would sit at 3/4 bands with no legal way to lay
 * the fourth. Counting live sockets means a dropped player's share is handed
 * back to the room within one socket close, and reclaimed when they return. */
export const activePlayerCount = (players: PlayerInfo[]): number =>
  players.reduce((n, p) => n + (p.connected ? 1 : 0), 0);

/**
 * **The party rule, as one number.** A level's `MAX_BANDS` bands are shared by
 * the `n` players in the room, and no player may hold more than
 *
 *     quota  k(n) = ⌈MAX_BANDS / n⌉
 *
 * bands at once. That ceiling is the whole rule, and it is the *tightest* cap
 * the team can still finish a level under: `n·k ≥ MAX_BANDS` by definition of
 * the ceiling, while `n·(k−1) < MAX_BANDS` would leave the fourth band
 * unplaceable. Smallest legal cap ⟺ most forced participation.
 *
 * | players `n` | quota `k` | what it forces (`MAX_BANDS` = 4)          |
 * | ----------- | --------- | ----------------------------------------- |
 * | 1           | 4         | one player lays all four                  |
 * | 2           | 2         | exactly two each                          |
 * | 3           | 2         | up to two each; at least two players place |
 * | 4           | 1         | exactly one each — nobody is a spectator  |
 *
 * Two consequences fall out of the same formula, which is why it is worth
 * stating as one:
 *
 * - **When `n` divides `MAX_BANDS`, the cap becomes an equality.** The counts
 *   are each ≤ `k` and must sum to `MAX_BANDS = n·k`, so every player places
 *   *exactly* `k`. That is where "each must place 2" (n=2) and "each must
 *   place 1" (n=4) come from — they are not separate rules.
 * - **Otherwise the slack `n·k − MAX_BANDS` is the freedom a short team gets.**
 *   n=3 has 2 spare units, which is exactly why a third player *may* sit out
 *   where a fourth may not.
 *
 * And by pigeonhole, at least `⌈MAX_BANDS / k⌉` distinct players touch every
 * completed level: 1, 2, 2, 4 for n = 1…4.
 */
export const bandQuota = (playerCount: number): number =>
  Math.ceil(MAX_BANDS / Math.max(1, playerCount));

/** Bands this player is holding on the board. Current holdings, never a
 * lifetime tally: taking a band back returns its share, so a player who
 * repositions their own band a dozen times is never locked out. */
export const bandsHeldBy = (bands: GoombaBand[], pid: string): number =>
  bands.reduce((n, b) => n + (b.pid === pid ? 1 : 0), 0);

/**
 * The whole enforcement predicate: room has a free slot AND this player is
 * under quota. Shared so the client greys out the band it may not lay and the
 * server rejects it — one rule, not a UI copy of one.
 *
 * **A level can never wedge.** Quotas tighten when a player joins mid-level,
 * and already-placed bands are never retracted, so a player can legitimately
 * sit *over* quota (laid 3 alone, then three teammates arrive). Even then the
 * room's remaining headroom
 *
 *     Σᵢ max(0, k − cᵢ)  ≥  Σᵢ (k − cᵢ)  =  n·k − Σᵢ cᵢ  ≥  MAX_BANDS − placed
 *
 * covers every band still to place — so while bands remain, someone may
 * always lay one.
 */
export const canPlaceBand = (bands: GoombaBand[], pid: string, playerCount: number): boolean =>
  bands.length < MAX_BANDS && bandsHeldBy(bands, pid) < bandQuota(playerCount);

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
      if (s.completed.every(Boolean) && s.finishedAt === null) s.finishedAt = now;
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

  /** `playerCount` is the room's live headcount (`activePlayerCount`); it sets
   * this player's quota. The caller passes it rather than the sim holding a
   * roster: presence belongs to the transport, the rule belongs here. */
  place(
    pid: string,
    slot: number,
    msg: { ax: unknown; ay: unknown; bx: unknown; by: unknown },
    now: number,
    playerCount: number,
  ): void {
    this.resolve(now);
    const s = this.st;
    if (s.phase !== "edit") return;
    // Free slot AND under quota — the participation rule, enforced on the
    // authority. The client greys the gesture out with the same predicate;
    // this is what makes it true.
    if (!canPlaceBand(s.bands, pid, playerCount)) return;
    const ax = num(msg.ax),
      ay = num(msg.ay),
      bx = num(msg.bx),
      by = num(msg.by);
    if (ax === null || ay === null || bx === null || by === null) return;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < BAND_MIN || len > BAND_MAX) return;
    const L = GOOMBA_LEVELS[s.level];
    // Snapping happens HERE, once, on the authority — so the run every phone
    // animates uses exactly the endpoints the server scored with.
    s.bands.push(snapBand(L, { ax, ay, bx, by, slot, pid }));
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

  /** The debug menu's level jump: fresh edit phase on the chosen level, for
   * everyone in the room. Completed flags are untouched — jumping earns
   * nothing. Also the solo (?solo) backend's card-tap, so both run the same
   * transition. */
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
    s.phase = "edit";
    s.bands = [];
    s.runAt = null;
    s.runResult = null;
    s.runT = null;
    s.fails = 0;
    // Past the last level: wrap to the first level not yet completed, or stay
    // on the finale for victory laps once everything is done.
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
      progress: done / GOOMBA_LEVELS.length,
      levelCount: GOOMBA_LEVELS.length,
      quota: bandQuota(activePlayerCount(players)),
    };
  }

  persisted(now: number): GoombaPersistedV1 {
    this.resolve(now);
    return { v: 1, savedAt: now, state: this.st };
  }

  restore(saved: GoombaPersistedV1, now: number): void {
    this.st = saved.state;
    // A level list that shrank in a deploy must not strand the room past the
    // end, and one that grew must not read undefined as "done".
    const n = GOOMBA_LEVELS.length;
    this.st.level = Math.min(this.st.level, n - 1);
    this.st.completed = GOOMBA_LEVELS.map((_, i) => this.st.completed[i] === true);
    this.resolve(now);
  }
}
