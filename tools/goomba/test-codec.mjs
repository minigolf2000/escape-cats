#!/usr/bin/env node
// The save format, both directions.
//
//   node test-codec.mjs
//
// The browser and these tools must agree on a link byte for byte.
// A new field rides at the TAIL behind a flag, and this holds it to that: every
// older link still decodes unchanged, a level without the field encodes to the
// SAME bytes it always did (shipped rows are not quietly rewritten), and a
// link that claims the field and ends early is `null`, not a NaN world edge.
import { encodeLevel, decodeLevel, initLevel } from "./lib.mjs";

/**
 * The level under test, as a literal rather than one out of a pack, so this
 * runs with nothing loaded. One of everything, so every count and field shape
 * in the layout is exercised.
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
/**
 * The fixture pushed to the edges the varint spelling cares about: both ends of
 * the clamped range, two- and three-byte steps, BACKWARDS steps, and a repeated
 * aim (fmt 3 prices a popper lane by its differences, so identical poppers are
 * the cheap case).
 */
const STRESS = {
  name: "Every Step Size",
  start: [-3276.8, 3276.7],
  goal: [0.1, -0.1],
  terrain: [
    [[-3276.8, -3276.8], [3276.7, 3276.7], [-3276.8, 3276.7], [0, 0]],
    [[100, 100], [100.1, 100.1], [112.7, 100.2], [112.8, 100.3], [-500.4, 99]],
  ],
  cans: [[3276.7, -3276.8], [0, 0]],
  cushions: [{ x: 1, y: 2, w: 3 }, { x: 1, y: 2, w: 3 }],
  pops: [
    { x: 0, y: 0, deg: -180, spd: 110 },
    { x: 1000, y: -1000, deg: -180, spd: 110 },
    { x: 0.1, y: 0.2, deg: 179.9, spd: 3276.7 },
  ],
  bumpers: [{ x: -0.1, y: -0.2 }],
};
const LEVELS = [FIXTURE, STRESS];

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
  // The KEY must be absent, not `undefined`: both figma tests compare against
  // a literal.
  check(`${L.name}: no frame key on a frameless level`, "frame" in back, false);
}

console.log("\nfmt 1: a link written before the solution field was removed");
// A REAL fmt-1 link, frozen (The Long Way Up with its baked 4-band `solution`),
// not a fixture built by the code that reads it. `nSolution` sat unconditionally
// in the MIDDLE of the layout, so dropping it cost a version: fmt 1 reads it
// and throws it away, fmt 2 never writes it.
const FMT1 = "AQAPVGhlIExvbmcgV2F5IFVwKADgBpYANgYDKAAACAdkAPkGkQBOB8gAOge-ACEHDgESBwQB_gZUAeoGRQHWBpABuAaBAaQGwgGGBpABOwbgAeEFMAIJBlMC4QU_AtIFewKlBWcClgWjAmkFjwJaBcsCKAW3Ah4F7gLsBNoC3QQCA84EvAKSBPgCHwRXAz0EZgMVBE0DCwSEA94DZgPUA50DpwN_A50DtgNwA5gDZgPAA1wDcAMlA5gDxgIDfgQYAZIE9AGIBNACAzIA3AWWAEAG8ADcBQMgAzoC9AHQAvAA1AMEOQDuBsT_3AWoAQAGNP7cBccCTwSy_dwFmAPGApr8FAUAARoEWAIEZAD5BpABOwbgAeEFvAKSBPgCHwRwAyUDKAAQBCgAUAU";
// The same level as fmt 2 wrote it — the shape older links and rows carry.
const FMT2 = "AgAPVGhlIExvbmcgV2F5IFVwKADgBpYANgYDKAAACAdkAPkGkQBOB8gAOge-ACEHDgESBwQB_gZUAeoGRQHWBpABuAaBAaQGwgGGBpABOwbgAeEFMAIJBlMC4QU_AtIFewKlBWcClgWjAmkFjwJaBcsCKAW3Ah4F7gLsBNoC3QQCA84EvAKSBPgCHwRXAz0EZgMVBE0DCwSEA94DZgPUA50DpwN_A50DtgNwA5gDZgPAA1wDcAMlA5gDxgIDfgQYAZIE9AGIBNACAzIA3AWWAEAG8ADcBQMgAzoC9AHQAvAA1AMEOQDuBsT_3AWoAQAGNP7cBccCTwSy_dwFmAPGApr8FAUAARoEWAI";

{
  const L = decodeLevel(FMT1);
  check("decodes at all", !!L, true);
  check("name", L.name, "The Long Way Up");
  check("geometry survives", [L.terrain.length, L.cans.length, L.pops.length], [3, 3, 4]);
  check("its baked solution is dropped, not exposed", "solution" in L, false);
  // Re-encodes at the current version, shorter by the solution block and its
  // count byte.
  const again = encodeLevel(L);
  check("re-encodes as fmt 3", atob(again.replace(/-/g, "+").replace(/_/g, "/")).charCodeAt(0), 3);
  check("and is shorter by the solution it dropped", again.length < FMT1.length, true);
  check("fmt 3 round-trips from there", encodeLevel(decodeLevel(again)), again);
  console.log(`       (${FMT1.length} chars at fmt 1 -> ${FMT2.length} at fmt 2 -> ${again.length} at fmt 3)`);
}

console.log("\nfmt 2: a link written before coordinates became steps");
{
  const one = decodeLevel(FMT1);
  const two = decodeLevel(FMT2);
  check("decodes at all", !!two, true);
  // The two links differ only by the field fmt 1 throws away: EQUAL, not similar.
  check("identical to the fmt 1 link of the same level", two, one);
  const three = encodeLevel(two);
  check("and re-encodes as a shorter fmt 3", three.length < FMT2.length, true);
  check("with nothing lost on the way", decodeLevel(three), two);
  console.log(`       (${FMT2.length} chars at fmt 2 -> ${three.length} at fmt 3, ${(100 * (1 - three.length / FMT2.length)).toFixed(0)}% shorter)`);
}

console.log("\nthe frame a level was drawn in");
const framed = clone(FIXTURE);
const before = encodeLevel(framed);
framed.frame = { x0: -12.5, y0: 0, x1: 140, y1: 210.3 };
const after = encodeLevel(framed);
check("survives the round trip", decodeLevel(after).frame, framed.frame);
check("re-encodes byte-identical", encodeLevel(decodeLevel(after)), after);
// Four coordinates, no flag byte (the flags field already existed). Still 11
// chars as at fmt 2: a frame's corners are the longest steps in the file and
// cost two bytes each, same as an absolute i16. The saving is in the vertices.
check("costs its four coordinates and nothing else", after.length - before.length, 11);
check("a link written before it decodes with no frame", "frame" in decodeLevel(before), false);

// Truncate the tail: the flag says a frame follows and it does not.
const raw = atob(after.replace(/-/g, "+").replace(/_/g, "/"));
const cut = btoa(raw.slice(0, raw.length - 3))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
check("a truncated frame is null, not a NaN world", decodeLevel(cut), null);

console.log("\nbounds = the ink UNION the frame");
const plain = initLevel(clone(FIXTURE)).bounds;
const wide = initLevel(clone(framed)).bounds;
// The union is PER EDGE: three edges from the frame, the top from the ink (the
// start at y 10 plus the 16-unit top margin reaches -6, above the frame's 0).
check("a frame outside the ink widens the world", wide, { x0: -12.5, y0: -6, x1: 140, y1: 210.3 });
check("...and the ink's own box is the floor", [wide.x0 <= plain.x0, wide.y0 <= plain.y0, wide.x1 >= plain.x1, wide.y1 >= plain.y1], [true, true, true, true]);
// A frame cropped tighter than its ink (a stray guide, a late resize) must not
// put terrain outside the world.
const tight = initLevel({ ...clone(FIXTURE), frame: { x0: 50, y0: 50, x1: 60, y1: 60 } });
check("a frame INSIDE the ink changes nothing", tight.bounds, plain);
// `bounds` is written onto the level object, and setGoombaLevels -> initLevel runs
// again on a level that already has one.
const once = initLevel(clone(framed));
check("initLevel twice cannot drift", initLevel(once).bounds, once.bounds);

// An unknown version is null, never a guess: a dropped level is visible, a
// misparsed one is not.
check("an unknown format version is refused", decodeLevel("BA" + FMT1.slice(2)), null);

console.log(bad ? `\n→ FAIL ✗  ${bad} check(s)` : "\n→ PASS ✓  fmt 3 is clean and every older link still decodes");
process.exit(bad ? 1 : 0);
