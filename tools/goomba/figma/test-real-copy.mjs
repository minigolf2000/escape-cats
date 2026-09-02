#!/usr/bin/env node
// The only test here made of REAL data: an actual Ctrl+C of the
// "L: 1 · The Long Way Down" frame, in fixtures/real-figma-copy.b64.
//
//   node test-real-copy.mjs
//
// What only a real copy shows, and what this pins:
//   * the buffer closes with `(/figma)`, not a second `(figma)`;
//   * the MESSAGE block is ZSTANDARD while the schema block is raw deflate —
//     decompress by magic, never by position;
//   * a copy ships the Document, the Page and the COMPONENT DEFINITIONS, named
//     exactly like the instances (four watering cans, not two);
//   * the copied frame's own canvas transform must be dropped.
//
// The expected level is FROZEN: it is what these exact bytes mean, and it must
// not follow a redesign of the level.
import { readFileSync } from "node:fs";
import { levelFromFigmaClipboard } from "../../../apps/goomba-glider/src/figma/clipboard.js";

const b64 = readFileSync(new URL("./fixtures/real-figma-copy.b64", import.meta.url), "utf8").trim();
const { level, warnings } = await levelFromFigmaClipboard(
  `<span data-buffer="<!--(figma)${b64}(/figma)-->"></span>`);

// Frame-local world units, carrying the frame's own padding offset. Terrain
// comes back as POLYLINES: `stitchTerrain` chains Lines sharing an endpoint, so
// seven Lines land as five polylines (the SURFACE is unchanged — `segsFor`
// flattens them again).
const EXPECT = {
  name: "1 · The Long Way Down",
  start: [20, 20],
  goal: [39, 136],
  terrain: [
    [[18, 22], [53, 29]],
    [[70, 27], [89, 43], [103, 41]],
    [[12, 62], [44, 72], [101, 51]],
    [[73, 84], [118, 67]],
    [[12, 137], [122, 137]],
  ],
  cans: [[96, 38], [84, 98]],
  // A REAL frame node carries its box in `size` exactly as an instance does:
  // 134×149 units around ink spanning 12-122 × 20-137, so the padding is real.
  frame: { x0: 0, y0: 0, x1: 134, y1: 149 },
  // Three `band` layers on this capture: consumed and warned about, never
  // geometry.
  droppedBands: 3,
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
check("terrain polylines", level.terrain, EXPECT.terrain);
check("cans", level.cans, EXPECT.cans);
check("frame box (size read, canvas position dropped)", level.frame, EXPECT.frame);
check("no `solution` key at all — the field is gone", "solution" in level, false);
check("pops/bumpers/cushions", [level.pops.length, level.bumpers.length, level.cushions.length], EXPECT.counts);
// Component definitions are named like the instances: four cans if counted.
check("component definitions excluded", level.cans.length, 2);
check("the `band` layers are warned about",
      warnings.filter((w) => w.includes("`band`")).length, 1);
if (warnings.length) console.log("  warnings:", warnings.join(" · "));
console.log(bad ? `\n→ FAIL ✗ (${bad})` : "\n→ PASS ✓  a real Ctrl+C decodes exactly");
process.exit(bad ? 1 : 0);
