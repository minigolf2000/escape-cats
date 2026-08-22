#!/usr/bin/env node
// `stitchTerrain` — the one thing standing between "Figma drew this as eight
// Lines" and "the game draws it the way it drew every hand-authored level".
//
//   node test-stitch.mjs
//
// Two kinds of case matter here and they pull in opposite directions:
//
//   * it must WELD, because hand-drawn joints are never exact. Measured on
//     "2 · The Long Way Up" as actually drawn: seven joints, one exact, the
//     rest 0.3-1.8 units apart. An exact-match rule chains nothing real.
//   * it must NOT weld a real gap. A 45-58 unit gap is how a level says "one
//     band goes here", and closing one silently redraws someone's level.
//
// The tolerance between those is set by the game's own design rule: no two
// terrain segments may come closer than 4.4 units (2 × her radius) or she
// wedges, so nothing under that is ever a deliberate separation.
import { stitchTerrain } from "../../../apps/goomba-glider/src/figma/stitch.js";

let bad = 0;
const check = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) { console.log(`         got  ${g}`); console.log(`         want ${w}`); }
};

console.log("stitchTerrain");

check("an exact chain becomes one polyline",
  stitchTerrain([[[0, 0], [10, 5]], [[10, 5], [20, 5]], [[20, 5], [30, 0]]]),
  [[[0, 0], [10, 5], [20, 5], [30, 0]]]);

// The case the first version of this got wrong, and the reason it exists.
check("a hand-drawn near-miss welds",
  stitchTerrain([[[0, 0], [10, 0]], [[10.6, 0.2], [20, 0]]]),
  [[[0, 0], [10, 0], [20, 0]]]);

check("the weld keeps the point already in the chain",
  stitchTerrain([[[0, 0], [10, 0]], [[9.4, 0], [20, 0]]]),
  [[[0, 0], [10, 0], [20, 0]]]);

// 4.4u is where deliberate geometry starts (2 × her 2.2 radius — closer than
// that and she wedges), so this must survive untouched.
check("a 4.4 u wedge gap survives",
  stitchTerrain([[[0, 0], [10, 0]], [[14.4, 0], [24, 0]]]),
  [[[0, 0], [10, 0]], [[14.4, 0], [24, 0]]]);

check("a band-sized gap survives",
  stitchTerrain([[[0, 0], [10, 0]], [[60, 0], [70, 0]]]),
  [[[0, 0], [10, 0]], [[60, 0], [70, 0]]]);

// Which way a Line points is which way the designer dragged it.
check("a backwards-drawn segment still chains",
  stitchTerrain([[[0, 0], [10, 0]], [[20, 0], [10, 0]]]),
  [[[0, 0], [10, 0], [20, 0]]]);

// The notch in The Long Way Up: its floor and its left wall share a corner at
// both their START points, which a forward-only pass cannot see.
check("two segments sharing their start points chain",
  stitchTerrain([[[10, 0], [20, 0]], [[10, 0], [10, -8]]]),
  [[[10, -8], [10, 0], [20, 0]]]);

check("a chain that is interrupted is still found",
  stitchTerrain([[[0, 0], [10, 0]], [[99, 99], [98, 98]], [[10, 0], [20, 0]]]),
  [[[0, 0], [10, 0], [20, 0]], [[99, 99], [98, 98]]]);

check("a closed loop closes",
  stitchTerrain([[[0, 0], [10, 0]], [[10, 0], [10, 10]], [[10, 10], [0, 0]]]),
  [[[0, 0], [10, 0], [10, 10], [0, 0]]]);

check("nothing in, nothing out", stitchTerrain([]), []);

// The real thing: the eight Lines the floor of "2 · The Long Way Up" is drawn
// as, straight off a Figma clipboard, in Figma's own order.
check("The Long Way Up's floor is one surface",
  stitchTerrain([
    [[8.1, 168.3], [35.6, 172.3]], [[35, 172.3], [63.8, 174.1]],
    [[79, 173.2], [96.3, 173.2]], [[96, 173.1], [114.6, 165.5]],
    [[113.9, 165.3], [128.1, 151.1]], [[63.8, 181.1], [79.6, 181.1]],
    [[63.8, 181.1], [63.8, 173.2]], [[80.6, 180.2], [80.6, 172.3]],
  ]),
  [[[8.1, 168.3], [35.6, 172.3], [63.8, 174.1], [63.8, 181.1], [79.6, 181.1],
    [80.6, 172.3], [96.3, 173.2], [114.6, 165.5], [128.1, 151.1]]]);

console.log(bad ? `\n→ FAIL ✗ (${bad})` : "\n→ PASS ✓  joints weld, real gaps survive");
process.exit(bad ? 1 : 0);
