// The level PACK: the game's levels as a list of base64url links.
//
// A level already knows how to be a URL — `encodeLevel` packs one into ~100-450
// base64url chars, and that is how a design has travelled between Figma, the
// bench and the game since the paste target shipped. A pack is just an ordered
// list of those strings, which makes the whole thing storable as text in a
// Durable Object, diffable in a terminal, and movable between events one entry
// at a time (`tools/goomba/seed.mjs`).
//
// This is the ONLY copy of that shape. The lobby DO stores it, the goomba room
// scores against it, every phone draws from it, and the editor edits it — all
// through the two functions below, so a pack that round-trips through storage
// and back onto four phones is the same pack byte for byte.

import { decodeLevel, encodeLevel } from "./codec";
import { GOOMBA_LEVELS, setGoombaLevels, type GoombaLevel } from "./levels";

/** An ordered list of level links. Storage format and wire format, one thing. */
export type LevelPack = string[];

/** How many levels a pack may hold. Not a design limit — a sanity bound, so a
 * malformed write cannot make every phone decode forever. */
export const PACK_MAX = 64;

/**
 * Pack -> levels, dropping anything that will not decode.
 *
 * Dropping rather than throwing is deliberate: a pack is edited live by people
 * at a party, and one bad entry must not take the game down for everyone. The
 * caller gets the count it actually got, and a short pack is visible on every
 * phone immediately.
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

// There is no seed pack. `SEED_LEVELS` — five levels as TypeScript literals,
// which this returned for an operator to push on day one — is deleted: the
// game never read them at play time, the Figma frame is a level's source, and
// a transcription of a drawing maintained by hand in another language is a
// second copy that can only go stale. A new event starts EMPTY and is filled
// by pasting frames, or by `seed.mjs --push --file <pack.json>` from a pack
// somebody pulled off a running event.
