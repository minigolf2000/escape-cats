#!/usr/bin/env node
// Shapes as terrain, and `cut` shapes that take terrain away.
//
//   node test-shapes.mjs
//
// The case that matters is the last one, because it is the level this feature
// was added for: two concentric Ellipses named `t`, two crossed Rectangles
// named `cut`, and the answer has to be EIGHT arcs — four per ring, with four
// doorways. Nothing about that is expressible as Lines, which is why a ring
// level could not be drawn in Figma at all before.
import { rectPoly, ellipsePoly, cutTester, applyCuts } from "../../../apps/goomba-glider/src/figma/shapes.js";

let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n         ${detail}`}`);
};
/** Figma's 2x3 affine for an unrotated node at (x, y), in px. */
const at = (x, y) => [1, 0, x, 0, 1, y];
/** ...and one rotated `deg` clockwise about its own top-left. */
const rot = (x, y, deg) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, -s, x, s, c, y];
};

console.log("shapes as terrain");
{
  // 200x100 px at (100,100) = 20x10 world units at (10,10). Square corners.
  const p = rectPoly(at(100, 100), 200, 100, 0);
  check("a Rectangle is its outline, closed", p.length === 5 &&
    JSON.stringify(p[0]) === JSON.stringify(p[4]) &&
    JSON.stringify(p) === JSON.stringify([[10, 10], [30, 10], [30, 20], [10, 20], [10, 10]]),
    JSON.stringify(p));

  const r = rectPoly(at(100, 100), 200, 100, 30);
  const xs = r.map((q) => q[0]), ys = r.map((q) => q[1]);
  check("a rounded Rectangle keeps its bounds and rounds its corners",
    r.length > 10 && Math.min(...xs) === 10 && Math.max(...xs) === 30 &&
    Math.min(...ys) === 10 && Math.max(...ys) === 20 &&
    // the square corner (10,10) is NOT on a rounded outline
    !r.some((q) => q[0] === 10 && q[1] === 10),
    JSON.stringify(r.slice(0, 4)));

  const e = ellipsePoly(at(0, 0), 200, 200);   // r = 10 world units about (10,10)
  const off = e.map((q) => Math.abs(Math.hypot(q[0] - 10, q[1] - 10) - 10));
  check("an Ellipse is a circle of the right radius", Math.max(...off) < 0.15,
    `worst radial error ${Math.max(...off).toFixed(3)}`);
  check("...faceted finely enough to ride", e.length >= 12, `${e.length} points`);
}

console.log("\ncut shapes");
{
  // A floor from x 0 to 60 at y 20, with a doorway punched at x 25..35.
  const floor = [[0, 20], [60, 20]];
  const door = cutTester("rect", at(250, 150), 100, 100);
  const out = applyCuts([floor], [door]);
  check("a cut splits one surface into two", out.length === 2, JSON.stringify(out));
  check("...at the cut's own edges", out.length === 2 &&
    Math.abs(out[0][out[0].length - 1][0] - 25) < 0.2 &&
    Math.abs(out[1][0][0] - 35) < 0.2, JSON.stringify(out));

  check("a cut that misses changes nothing",
    JSON.stringify(applyCuts([floor], [cutTester("rect", at(2500, 1500), 100, 100)])) ===
    JSON.stringify([floor]));

  const wholly = applyCuts([[[26, 20], [34, 20]]], [door]);
  check("a surface wholly inside a cut disappears", wholly.length === 0, JSON.stringify(wholly));

  // The case a solver would need writing for separately: both ENDS outside a
  // cut and the middle inside. The sampler sees it because it walks the segment.
  const long = applyCuts([[[0, 20], [60, 20]]], [cutTester("rect", at(200, 150), 200, 100)]);
  check("a long segment cut through its middle splits", long.length === 2, JSON.stringify(long));

  // A rotated cut still cuts: same doorway, drawn at 45 degrees.
  const tilted = applyCuts([floor], [cutTester("rect", rot(300, 150, 45), 100, 100)]);
  check("a ROTATED cut cuts", tilted.length === 2, JSON.stringify(tilted));
}

console.log("\nthe ring level: two Ellipses, two crossed cuts");
{
  // Concentric rings r 379 / 482.5 px about (648,702) — the sketch's own
  // numbers — and the plus-shaped pair of bars that opens four doorways in each.
  const C = [648, 702];
  const ring = (r) => ellipsePoly(at(C[0] - r, C[1] - r), 2 * r, 2 * r);
  const bar = 110;                                  // px wide
  const cuts = [
    cutTester("rect", at(C[0] - bar / 2, C[1] - 1000), bar, 2000),   // vertical
    cutTester("rect", at(C[0] - 1000, C[1] - bar / 2), 2000, bar),   // horizontal
  ];
  const arcs = applyCuts([ring(379), ring(482.5)], cuts);
  check("two rings and a cross make eight arcs", arcs.length === 8, `${arcs.length} arcs`);

  const R = arcs.map((a) => a.map((p) => Math.hypot(p[0] - C[0] / 10, p[1] - C[1] / 10)));
  const inner = R.filter((rs) => rs[0] < 43).length;
  check("...four on each ring", inner === 4, `${inner} inner`);

  const half = bar / 20;                            // half the bar, in world units
  const gapOk = arcs.every((a) => a.every(([x, y]) =>
    Math.abs(x - C[0] / 10) > half - 0.3 || Math.abs(y - C[1] / 10) > half - 0.3));
  check("...and no terrain survives inside a doorway", gapOk);

  const closed = arcs.every((a) => a.length >= 8);
  check("...each arc is still a smooth chain", closed, JSON.stringify(arcs.map((a) => a.length)));
}

console.log(bad ? `\n→ FAIL ✗ (${bad} check(s))` : "\n→ PASS ✓  shapes read, cuts subtract");
process.exit(bad ? 1 : 0);
