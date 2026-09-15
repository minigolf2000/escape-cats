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
// It is a decision, not a derivation. The old room keyed progress by INDEX
// (`GoombaSim.reconcile`, which shifts every flag after a delete) — fine for
// one party, wrong for a save that outlives a pack edit by months.
//
// Nothing here touches localStorage or the DOM: the client owns where the rows
// and the progress are STORED, this owns what they mean.

import { decodeLevel } from "./codec";
import type { GoombaLevel } from "./levels";

/** Where a level in the live list came from. Only `baked` ships. */
export type LevelSource = "baked" | "local" | "hash";

/** One level as it is WRITTEN DOWN — in `levels.data.ts`, or in the power
 * user's local overlay. The storage format and the commit format, one thing. */
export interface LevelRow {
  /** Stable identity, assigned by hand. Progress is keyed on this and nothing
   * else, so it must be unique across the baked list and must not be edited
   * casually — changing it un-clears the level for everyone. */
  id: string;
  /** Advisory, for a readable diff: the name players SEE lives inside `hash`,
   * and the codec's copy is the one that wins. `node tools/goomba/levels.mjs`
   * fails the build if the two drift. */
  name: string;
  /** The level itself — `encodeLevel` output, exactly as Ctrl+C gives it. */
  hash: string;
}

/**
 * Rows -> levels, DROPPING anything that will not decode, the same way
 * `packToLevels` does: a local overlay is edited live, and one bad entry must
 * not take the grid down with it.
 */
export function rowsToLevels(rows: LevelRow[], source: LevelSource): GoombaLevel[] {
  const out: GoombaLevel[] = [];
  for (const row of rows) {
    if (!row || typeof row.hash !== "string" || typeof row.id !== "string") continue;
    const L = decodeLevel(row.hash);
    if (!L) continue;
    L.id = row.id;
    L.source = source;
    // The selector's one visible difference, from before there were sources:
    // a dashed card means "this is not a level the game shipped".
    if (source !== "baked") L.pasted = true;
    out.push(L);
  }
  return out;
}

/** A level back out as a row — what the overlay stores and what the export
 * command prints for `levels.data.ts`. The name is re-read from the level, so
 * a row written here can never drift from its own hash. */
export const levelToRow = (L: GoombaLevel, hash: string): LevelRow => ({
  id: L.id ?? "",
  name: L.name,
  hash,
});

/** An id for a level the power user just pasted. Slug for legibility (it is
 * the line they will edit when committing), suffix because two frames may
 * carry the same name and an id collision would silently share progress. */
export function localId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `local-${slug || "level"}-${suffix}`;
}

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
