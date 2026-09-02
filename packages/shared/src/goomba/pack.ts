// The level PACK: an ordered list of base64url level links. Storage format in
// the lobby DO, wire format to every phone, and what the editor edits, all
// through the functions below — the ONLY copy of that shape.

import { decodeLevel, encodeLevel } from "./codec";
import { GOOMBA_LEVELS, setGoombaLevels, type GoombaLevel } from "./levels";

/** An ordered list of level links. Storage format and wire format, one thing. */
export type LevelPack = string[];

/** How many levels a pack may hold. Not a design limit — a sanity bound, so a
 * malformed write cannot make every phone decode forever. */
export const PACK_MAX = 64;

/**
 * Pack -> levels, DROPPING anything that will not decode: a pack is edited
 * live at a party, and one bad entry must not take the game down.
 */
export function packToLevels(pack: LevelPack): GoombaLevel[] {
  const out: GoombaLevel[] = [];
  for (const hash of pack.slice(0, PACK_MAX)) {
    if (typeof hash !== "string") continue;
    const L = decodeLevel(hash);
    if (L) out.push(L);
  }
  return out;
}

/** Levels -> pack. The inverse, used when seeding and when the editor writes. */
export const levelsToPack = (levels: GoombaLevel[]): LevelPack => levels.map(encodeLevel);

/**
 * Apply a pack to `GOOMBA_LEVELS` — the one call every surface makes.
 * Returns the number of levels now live.
 */
export const applyPack = (pack: LevelPack): number => setGoombaLevels(packToLevels(pack));

/** The pack currently live, re-encoded. What the editor sends back after a
 * reorder or a delete, so an untouched level round-trips unchanged. */
export const currentPack = (): LevelPack => levelsToPack(GOOMBA_LEVELS);

// There is no seed pack: a new event starts EMPTY and is filled by pasting
// frames, or by `seed.mjs --push --file <pack.json>` from a pulled pack.
