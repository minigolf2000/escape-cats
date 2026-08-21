#!/usr/bin/env node
// The only test here made of REAL data: an actual Ctrl+C of the
// "L: 1 · The Long Way Down" frame, captured off the Windows clipboard, in
// fixtures/real-figma-copy.b64.
//
//   node test-real-copy.mjs
//
// It earns its keep because every synthetic fixture in test-clipboard.mjs is
// built from what I BELIEVED the format to be, and four times that belief was
// wrong in ways no synthetic test could catch:
//
//   * the buffer closes with `(/figma)`, not a second `(figma)`;
//   * the MESSAGE block is ZSTANDARD while the schema block beside it is raw
//     deflate — decompress by magic, never by position;
//   * a copy also ships the Document, the Page and the COMPONENT DEFINITIONS,
//     which are named exactly like the instances (four watering cans, not two);
//   * the copied frame's own transform must be dropped: its position on the
//     canvas is not part of the level.
//
// The expected level below is FROZEN rather than compared against
// `levels.ts[0]`. It used to read from there — that frame was generated from it
// — but the two drift the moment a level is redesigned, and then this test
// starts failing for a reason that has nothing to do with the decoder. What is
// being tested is the decode, so the expectation is a snapshot of what these
// exact bytes mean.
import { readFileSync } from "node:fs";
import { levelFromFigmaClipboard } from "../../../apps/goomba-editor/src/figma-clipboard.js";

const b64 = readFileSync(new URL("./fixtures/real-figma-copy.b64", import.meta.url), "utf8").trim();
const { level, warnings } = await levelFromFigmaClipboard(
  `<span data-buffer="<!--(figma)${b64}(/figma)-->"></span>`);

// What these bytes mean, in frame-local world units. Terrain arrives as
// segments (a Figma line each) rather than the polylines levels.ts stores, and
// the coordinates carry the frame's own padding offset — both expected.
const EXPECT = {
  name: "1 · The Long Way Down",
  start: [20, 20],
  goal: [39, 136],
  terrain: [
    [[18, 22], [53, 29]],
    [[70, 27], [89, 43]],
    [[89, 43], [103, 41]],
    [[12, 62], [44, 72]],
    [[44, 72], [101, 51]],
    [[73, 84], [118, 67]],
    [[12, 137], [122, 137]],
  ],
  cans: [[96, 38], [84, 98]],
  solution: [
    [[53, 29], [70, 27]],
    [[129, 48], [122, 89]],
    [[124, 90], [76, 111]],
  ],
  counts: [0, 0, 0], // pops / bumpers / cushions
};

let bad = 0;
const check = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) { console.log(`         got  ${g}`); console.log(`         want ${w}`); }
};

console.log("a real Figma Ctrl+C -> GoombaLevel");
check("name", level.name, EXPECT.name);
check("start", level.start, EXPECT.start);
check("goal", level.goal, EXPECT.goal);
check("terrain segments", level.terrain, EXPECT.terrain);
check("cans", level.cans, EXPECT.cans);
check("solution bands", level.solution, EXPECT.solution);
check("pops/bumpers/cushions", [level.pops.length, level.bumpers.length, level.cushions.length], EXPECT.counts);
// The component definitions ride along in the payload and are named exactly
// like the instances; counting them would show four cans here, not two.
check("component definitions excluded", level.cans.length, 2);
if (warnings.length) console.log("  warnings:", warnings.join(" · "));
console.log(bad ? `\n→ FAIL ✗ (${bad})` : "\n→ PASS ✓  a real Ctrl+C decodes exactly");
process.exit(bad ? 1 : 0);
