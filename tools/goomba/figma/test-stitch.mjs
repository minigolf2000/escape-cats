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

// ---- T-junctions: a platform butting into a wall ----------------------------
// Chaining is end-to-end, which is the wrong shape for the commonest thing
// anyone draws. Level 1 stores its start platform at x 124 and its wall at
// x 133, so the platform ends 0.9 units past the wall's centreline — a sliver
// under Figma's 15 px stroke, a visible stub hanging off the game's 4.4-unit
// collision halo.

check("a loose end snaps onto the wall it was drawn against",
  stitchTerrain([[[12.4, 21.5], [50, 24.3]], [[13.3, 85.7], [13.3, 8.9]]]),
  [[[13.3, 21.5], [50, 24.3]], [[13.3, 85.7], [13.3, 8.9]]]);

// ...but only where the wall actually IS. Level 1's ground is at y 137 and the
// wall stops at y 85.7, so that end hangs off the world on purpose.
check("an end past the wall's extent is left hanging",
  stitchTerrain([[[12, 137], [122, 137]], [[13.3, 85.7], [13.3, 8.9]]]),
  [[[12, 137], [122, 137]], [[13.3, 85.7], [13.3, 8.9]]]);

check("an end already ON the surface is not moved",
  stitchTerrain([[[75, 31], [89, 43]], [[13.3, 43], [98.7, 43]]]),
  [[[75, 31], [89, 43]], [[13.3, 43], [98.7, 43]]]);

// A T is not a chain: the two stay separate polylines, each with its own ends.
check("a T-junction does not merge the two surfaces",
  stitchTerrain([[[0, 10], [20, 10]], [[21, 0], [21, 30]]]).length, 2);

// The whole of level 1, exactly as it decodes out of Figma today.
check("level 1's platform and shelf both land on the wall",
  stitchTerrain([
    [[12.4, 21.5], [50, 24.3]], [[75, 31], [89, 43]], [[12.6, 43], [98.7, 43]],
    [[73, 84], [110.6, 57.5]], [[70.4, 103.3], [93.2, 114.3]],
    [[12, 137], [122, 137]], [[13.3, 85.7], [13.3, 8.9]],
  ]).map((p) => p[0]),
  [[13.3, 21.5], [75, 31], [13.3, 43], [73, 84], [70.4, 103.3], [12, 137], [13.3, 85.7]]);

// A momentum arc (tools/goomba/pipe.mjs) is drawn FINER than the weld
// tolerance: a 90° quarter of radius 8 cut into 24 lines has 0.52-unit chords,
// so both ends of the next segment — and of the two after it — sit inside
// WELD's 2 units. That is why chaining takes the NEAREST endpoint rather than
// the first one it finds. Under a first-match rule this case came back
// scrambled the moment a Line was drawn backwards or a layer moved: 0 of 40
// perturbed orders reproduced the drawing, with vertices moved by up to 4.4
// units on a 3.2-unit arc.
const arcSegs = (r, n) => {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = (Math.PI / 2 * i) / n;
    pts.push([+(70 + r * Math.sin(p)).toFixed(2), +(200 - r * (1 - Math.cos(p))).toFixed(2)]);
  }
  const segs = [[[50, 200], [70, 200]]];
  for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
  return segs;
};
/** The segment SET, which is all the physics ever sees. */
const segSet = (polys) => {
  const out = [];
  for (const p of polys)
    for (let i = 0; i + 1 < p.length; i++)
      out.push([p[i], p[i + 1]].map((q) => q.join(",")).sort().join("|"));
  return out.sort().join(";");
};
for (const [r, n] of [[8, 24], [3.2, 24], [26, 24]]) {
  const base = arcSegs(r, n), want = segSet(base);
  let worst = "";
  for (let seed = 1; seed <= 20 && !worst; seed++) {
    let st = seed * 7919;
    const rnd = () => (st = (st * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const a = base.map((g) => g.map((q) => q.slice()));
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    for (const g of a) if (rnd() < 0.5) g.reverse();
    if (segSet(stitchTerrain(a)) !== want) worst = `seed ${seed}`;
  }
  check(`a ${n}-line r${r} arc survives any order and direction`, worst || "clean", "clean");
}

console.log(bad ? `\n→ FAIL ✗ (${bad})` : "\n→ PASS ✓  joints weld, tees land, real gaps survive");
process.exit(bad ? 1 : 0);
