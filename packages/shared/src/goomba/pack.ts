// A PACK: an ordered list of base64url level links, with no ids and no names
// beside them. It was the storage format in the lobby Durable Object and the
// wire format to every phone; what the game ships is `levels.data.ts` rows now
// (`library.ts`), and what it plays is composed from three layers.
//
// This survives because the node tools speak it: `lib.mjs --pack` loads a
// plain JSON array of links, which is still the easiest thing to hand a script
// (`bands.mjs`). Not a second source of truth — nothing in the client calls it.

import { decodeLevel, encodeLevel } from "./codec";
import { GOOMBA_LEVELS, setGoombaLevels, type GoombaLevel } from "./levels";

/** An ordered list of level links. Storage format and wire format, one thing. */
export type LevelPack = string[];

/** How many levels a list may hold. Not a design limit — a sanity bound, so a
 * malformed overlay cannot make the grid decode forever. Read by the client's
 * paste path. */
export const PACK_MAX = 64;

/**
 * Pack -> levels, DROPPING anything that will not decode: one bad entry must
 * not take the game down. `rowsToLevels` in `library.ts` is the same rule for
 * the shape the game actually ships.
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

// There is no seed pack here: the levels the game ships are `levels.data.ts`.
