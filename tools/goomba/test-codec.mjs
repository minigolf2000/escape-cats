#!/usr/bin/env node
// The save format, both directions.
//
//   node test-codec.mjs
//
// A level saves by BEING a link, and three programs have to agree on that link
// byte for byte: the browser writes it, the lobby DO stores it, this bench
// grades it. There was no test on it until `frame` was added, which is the
// first time the format had ever grown a field — so this is mostly about the
// promise that growing it again stays cheap:
//
//   * every link written before a new field still decodes, unchanged;
//   * a level with no frame encodes to the SAME bytes it always did, so the
//     packs sitting in live lobbies are not quietly rewritten;
//   * a link that claims a frame and then ends early is `null`, not a level
//     with NaN for a world edge.
import { encodeLevel, decodeLevel, initLevel } from "./lib.mjs";

/**
 * The level under test, as a literal.
 *
 * Its own, rather than one out of the loaded pack: the bench has no levels
 * until somebody points it at a pack, and a format test that only runs when
 * you remembered to pull one is a format test that does not run. One of
 * everything, so every count and every field shape in the layout is exercised.
 */
const FIXTURE = {
  name: "Codec Fixture",
  start: [10, 10],
  goal: [90, 60],
  terrain: [[[0, 70], [40, 72.5], [80, 66]], [[95, 20], [95, 55]]],
  cans: [[30, 40], [70, 30]],
  cushions: [{ x: 20, y: 65, w: 12 }],
  pops: [{ x: 50, y: 50, deg: -45, spd: 110 }],
  bumpers: [{ x: 60, y: 20 }],
};
const LEVELS = [FIXTURE];

let bad = 0;
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
};
const clone = (L) => JSON.parse(JSON.stringify(L));

console.log("a level round-trips through its link");
for (const L of LEVELS) {
  const hash = encodeLevel(L);
  const back = decodeLevel(hash);
  check(`${L.name}: byte-identical`, encodeLevel(back), hash);
  // Not `back.frame === undefined`: the KEY must be absent. A level that came
  // back carrying an empty frame would compare unequal to the literal it was
  // built from, which is how both figma tests assert.
  check(`${L.name}: no frame key on a frameless level`, "frame" in back, false);
}

console.log("\nfmt 1: a link written before the solution field was removed");
// A REAL link, frozen: `The Long Way Up` as it was encoded when levels lived in
// the repo and carried a baked 4-band `solution`. Every link in every lobby
// looks like this, so "old links still decode" has to be tested against one
// rather than against a fixture built by the same code that reads it.
//
// The solution is the reason this cost a format version. `nSolution` sat in the
// MIDDLE of the layout and was unconditional, so dropping it moved every byte
// after it — there is no flag an old link could have failed to set. fmt 1 reads
// it and throws it away; fmt 2 does not write it at all.
const FMT1 = "AQAPVGhlIExvbmcgV2F5IFVwKADgBpYANgYDKAAACAdkAPkGkQBOB8gAOge-ACEHDgESBwQB_gZUAeoGRQHWBpABuAaBAaQGwgGGBpABOwbgAeEFMAIJBlMC4QU_AtIFewKlBWcClgWjAmkFjwJaBcsCKAW3Ah4F7gLsBNoC3QQCA84EvAKSBPgCHwRXAz0EZgMVBE0DCwSEA94DZgPUA50DpwN_A50DtgNwA5gDZgPAA1wDcAMlA5gDxgIDfgQYAZIE9AGIBNACAzIA3AWWAEAG8ADcBQMgAzoC9AHQAvAA1AMEOQDuBsT_3AWoAQAGNP7cBccCTwSy_dwFmAPGApr8FAUAARoEWAIEZAD5BpABOwbgAeEFvAKSBPgCHwRwAyUDKAAQBCgAUAU";
{
  const L = decodeLevel(FMT1);
  check("decodes at all", !!L, true);
  check("name", L.name, "The Long Way Up");
  check("geometry survives", [L.terrain.length, L.cans.length, L.pops.length], [3, 3, 4]);
  check("its baked solution is dropped, not exposed", "solution" in L, false);
  // Re-encoding is where the version shows: same level, fmt 2, shorter by the
  // whole solution block plus its count byte.
  const again = encodeLevel(L);
  check("re-encodes as fmt 2", atob(again.replace(/-/g, "+").replace(/_/g, "/")).charCodeAt(0), 2);
  check("and is shorter by the solution it dropped", again.length < FMT1.length, true);
  check("fmt 2 round-trips from there", encodeLevel(decodeLevel(again)), again);
  console.log(`       (${FMT1.length} chars at fmt 1 -> ${again.length} at fmt 2)`);
}

console.log("\nthe frame a level was drawn in");
const framed = clone(FIXTURE);
const before = encodeLevel(framed);
framed.frame = { x0: -12.5, y0: 0, x1: 140, y1: 210.3 };
const after = encodeLevel(framed);
check("survives the round trip", decodeLevel(after).frame, framed.frame);
check("re-encodes byte-identical", encodeLevel(decodeLevel(after)), after);
check("costs 4 coordinates and nothing else", after.length - before.length, 11);
check("a link written before it decodes with no frame", "frame" in decodeLevel(before), false);

// Truncate the tail: the flag says a frame follows and it does not.
const raw = atob(after.replace(/-/g, "+").replace(/_/g, "/"));
const cut = btoa(raw.slice(0, raw.length - 3))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
check("a truncated frame is null, not a NaN world", decodeLevel(cut), null);

console.log("\nbounds = the ink UNION the frame");
const plain = initLevel(clone(FIXTURE)).bounds;
const wide = initLevel(clone(framed)).bounds;
// Three edges come from the frame and one from the ink: the fixture's start
// sits at y 10, and the derived box's 16-unit top margin reaches to -6, above
// the frame's own y0 of 0. That mixed result IS the union — it takes whichever
// edge is further out, per edge, not whichever box is bigger.
check("a frame outside the ink widens the world", wide, { x0: -12.5, y0: -6, x1: 140, y1: 210.3 });
check("...and the ink's own box is the floor", [wide.x0 <= plain.x0, wide.y0 <= plain.y0, wide.x1 >= plain.x1, wide.y1 >= plain.y1], [true, true, true, true]);
// The union is what makes this safe: a frame cropped tighter than its contents
// is an accident (a stray guide dragged past the edge, a frame resized after
// the fact), and honouring it would put terrain outside the world.
const tight = initLevel({ ...clone(FIXTURE), frame: { x0: 50, y0: 50, x1: 60, y1: 60 } });
check("a frame INSIDE the ink changes nothing", tight.bounds, plain);
// Idempotence matters because `bounds` is written onto the level object itself:
// applyPack -> initLevel runs again on a level that already has bounds.
const once = initLevel(clone(framed));
check("initLevel twice cannot drift", initLevel(once).bounds, once.bounds);

// An old reader meeting a fmt-2 link refuses it, which is the property the
// version bump was bought for: a dropped level is visible, a misparsed one is
// not. The same test from this side — an unknown version is null, never a guess.
check("an unknown format version is refused", decodeLevel("Aw" + FMT1.slice(2)), null);

console.log(bad ? `\n→ FAIL ✗  ${bad} check(s)` : "\n→ PASS ✓  fmt 2 is clean and every fmt 1 link still decodes");
process.exit(bad ? 1 : 0);
