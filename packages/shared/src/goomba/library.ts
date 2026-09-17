// THE LIBRARY: how a list of level ROWS becomes the `GOOMBA_LEVELS` array, and
// how a player's progress survives that list changing under them.
//
// A row is `{ id, name, hash }`. The hash is the level (the same base64url
// link `codec.ts` writes and the clipboard carries); the id is a name a HUMAN
// assigns and progress is keyed on. That split is the whole design:
//
//   - reorder the pack, rename a level, or retune its geometry in Figma and
//     re-paste it — the id is unchanged, so a cleared level stays cleared;
//   - CHANGE the id when you want a level to read as new and un-clear itself.
//
// It is a decision, not a derivation. `GoombaSim.reconcile` keys progress by
// INDEX (and shifts every flag after a delete) — fine for one sitting, wrong
// for a save that outlives a list edit by months.
//
// Nothing here touches localStorage or the DOM: the client owns where the rows
// and the progress are STORED, this owns what they mean.

import { decodeLevel } from "./codec";
import type { GoombaLevel } from "./levels";

/** How many levels a list may hold. Not a design limit — a sanity bound on
 * the paste path, so a local overlay cannot grow without end. */
export const PACK_MAX = 64;

/** Where a level in the live list came from. Only `baked` ships. */
export type LevelSource = "baked" | "local" | "hash";

/** One level as it is WRITTEN DOWN — in `levels.data.ts`, or in the power
 * user's local overlay. The storage format and the commit format, one thing. */
export interface LevelRow {
  /** Stable identity, assigned by hand. Progress is keyed on this and nothing
   * else, so it must be unique across the baked list and must not be edited
   * casually — changing it un-clears the level for everyone. */
  id: string;
  /** Advisory, for a readable diff: the name the player SEES lives inside `hash`,
   * and the codec's copy is the one that wins. `node tools/goomba/levels.mjs`
   * fails the build if the two drift. */
  name: string;
  /** The level itself — `encodeLevel` output, exactly as Ctrl+C gives it. */
  hash: string;
  /**
   * POST-CREDITS. The finale fires when the last level WITHOUT this flag is
   * cleared, and these sit behind it: still real levels, still numbered, but
   * the game has already said goodbye.
   *
   * It rides the ROW and not the hash on purpose — it is a fact about the
   * list's shape, not about the level's geometry, so moving a level in or out
   * of the bonus section costs no re-paste and no codec version.
   */
  bonus?: boolean;
}

/**
 * Rows -> levels, DROPPING anything that will not decode: a local overlay is
 * edited live, and one bad entry must not take the grid down with it.
 */
export function rowsToLevels(rows: LevelRow[], source: LevelSource): GoombaLevel[] {
  const out: GoombaLevel[] = [];
  for (const row of rows) {
    if (!row || typeof row.hash !== "string" || typeof row.id !== "string") continue;
    const L = decodeLevel(row.hash);
    if (!L) continue;
    L.id = row.id;
    L.source = source;
    // Only what the row SAYS. "Anything not shipped is post-credits too" is
    // the sim's rule (`isMain` in sim.ts), asked of `source` — so a layer that
    // never passes through here (the `#hash` level) gets it as well.
    L.bonus = row.bonus === true;
    out.push(L);
  }
  return out;
}

/** A name as an id: the ONE slug rule. What a paste's local id is built on,
 * and what the export writes as the id to commit — one function, so the id
 * a player's progress was saved under and the id that lands in
 * `levels.data.ts` cannot drift apart. */
export const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "level";

/** An id for a level the power user just pasted. The slug for legibility (it
 * is the line they will edit when committing), a suffix because two frames may
 * carry the same name and an id collision would silently share progress. */
export const localId = (name: string): string =>
  `local-${slugOf(name)}-${Math.random().toString(36).slice(2, 6)}`;

// ---------- progress ----------

/** What a player has ever finished: level id -> when (epoch ms). THE durable
 * record. `GoombaSimState.completed` is a per-session projection of this onto
 * whatever list is loaded right now. */
export interface GoombaProgressV1 {
  v: 1;
  cleared: Record<string, number>;
}

export const freshProgress = (): GoombaProgressV1 => ({ v: 1, cleared: {} });

/** Accept a save, or start over. Anything malformed is a fresh start rather
 * than a throw: this is read from localStorage, which anyone can edit. */
export function readProgress(raw: unknown): GoombaProgressV1 {
  if (!raw || typeof raw !== "object") return freshProgress();
  const p = raw as Partial<GoombaProgressV1>;
  if (p.v !== 1 || !p.cleared || typeof p.cleared !== "object") return freshProgress();
  const cleared: Record<string, number> = {};
  for (const [id, at] of Object.entries(p.cleared))
    if (typeof at === "number" && Number.isFinite(at)) cleared[id] = at;
  return { v: 1, cleared };
}

/** The `completed` array for the list that is loaded, read off the durable
 * record. A level with no id (the `#hash` one) is never remembered. */
export const completedFor = (levels: GoombaLevel[], p: GoombaProgressV1): boolean[] =>
  levels.map((L) => L.id !== undefined && p.cleared[L.id] !== undefined);

/**
 * Fold this session's `completed` back into the durable record.
 *
 * Levels IN the list track the sim exactly, in both directions — so "start
 * over" (`GoombaSim.reset`, which blanks `completed`) actually forgets them
 * rather than being undone by the next load. Ids NOT in the list are left
 * alone: that is what makes deleting a level and pasting it back keep its
 * clear, and it is the whole reason progress is keyed by id.
 */
export function foldProgress(
  p: GoombaProgressV1,
  levels: GoombaLevel[],
  completed: boolean[],
  now: number,
): GoombaProgressV1 {
  const cleared = { ...p.cleared };
  levels.forEach((L, i) => {
    if (L.id === undefined) return;
    if (completed[i]) cleared[L.id] ??= now;
    else delete cleared[L.id];
  });
  return { v: 1, cleared };
}
