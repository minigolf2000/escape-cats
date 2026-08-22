#!/usr/bin/env node
// `stitchTerrain` — the one thing standing between "Figma drew this as six
// Lines" and "the game draws it the way it drew every hand-authored level".
//
//   node test-stitch.mjs
//
// The cases that matter are the ones where it must NOT act: a near-miss is a
// gap, and a gap is usually the design (a 45-58 u gap is how a level says "one
// band goes here"). Welding one would redraw someone's level silently.
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

check("a chain becomes one polyline",
  stitchTerrain([[[0, 0], [10, 5]], [[10, 5], [20, 5]], [[20, 5], [30, 0]]]),
  [[[0, 0], [10, 5], [20, 5], [30, 0]]]);

check("disjoint segments stay apart",
  stitchTerrain([[[0, 0], [10, 0]], [[40, 0], [50, 0]]]),
  [[[0, 0], [10, 0]], [[40, 0], [50, 0]]]);

// A tenth of a unit apart is a gap. The codec's precision IS the resolution
// here, so anything that survives rounding is a decision the designer made.
check("a 0.1 u gap is left alone",
  stitchTerrain([[[0, 0], [10, 0]], [[10.1, 0], [20, 0]]]),
  [[[0, 0], [10, 0]], [[10.1, 0], [20, 0]]]);

// Which way a Line points is which way the designer dragged it, not a fact
// about the surface.
check("a backwards-drawn segment still chains",
  stitchTerrain([[[0, 0], [10, 0]], [[20, 0], [10, 0]]]),
  [[[0, 0], [10, 0], [20, 0]]]);

check("a chain that is interrupted starts a new run",
  stitchTerrain([[[0, 0], [10, 0]], [[99, 99], [98, 98]], [[10, 0], [20, 0]]]),
  [[[0, 0], [10, 0]], [[99, 99], [98, 98]], [[10, 0], [20, 0]]]);

check("a closed loop closes", // a fenced world: last vertex back to the first
  stitchTerrain([[[0, 0], [10, 0]], [[10, 0], [10, 10]], [[10, 10], [0, 0]]]),
  [[[0, 0], [10, 0], [10, 10], [0, 0]]]);

check("nothing in, nothing out", stitchTerrain([]), []);

console.log(bad ? `\n→ FAIL ✗ (${bad})` : "\n→ PASS ✓  chains join, gaps survive");
process.exit(bad ? 1 : 0);
