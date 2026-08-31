// HOW FAR CAN ANYTHING HIDE FROM THE FREE RIDE?
//
// On a level built out of popper loops, the loop carries her for nothing once
// she is in it — so a watering can only costs a band if it sits further from
// that orbit than her pickup reach, `CAN_R + R` = 9.7. DESIGNING.md says a
// collectible on the line she would fly anyway is a chime, not a constraint;
// this measures the chime.
//
// It answers the question the sim cannot: not "did this run collect it" but
// "does a placement exist anywhere in this room that would not". Sweep every
// reachable point, take the distance to the traced orbit, and the MAXIMUM is
// the room's whole budget for hiding something.
//
// The answer for In and Out was the level's shape, not a tuning note: the
// annulus tops out at 6.5 against a 9.7 reach, so no can placed anywhere in
// that tube can ever be earned. A tube narrower than the pickup radius cannot
// hold a constraint.
//
//   node orbit-probe.mjs
import { makeRun, stepRun, SUB, RUN_MAX, initLevel } from "./draft/_sim.mjs";
import { P, buildLevel } from "./draft/in-and-out.mjs";
const L = initLevel(buildLevel());
const orbit = (from) => {
  const st = makeRun(L, []);
  st.p.x = from[0]; st.p.y = from[1]; st.v.x = from[2]; st.v.y = from[3];
  st.snap = { x: st.p.x, y: st.p.y, t: 0 };
  const pts = []; let n = 0;
  while (!st.result && st.t < RUN_MAX + 1) { stepRun(st, SUB); if (n++ % 4 === 0) pts.push([st.p.x, st.p.y]); }
  return pts;
};
const ann = orbit([64.8, 25.7, -110, 0]);      // the conveyor, one lap+
const car = orbit([64.8, 41.7, 90, 0]);        // the carousel
const near = (pts, x, y) => Math.min(...pts.map((p) => Math.hypot(p[0] - x, p[1] - y)));
const R = 2.2, REACH = 9.7;

for (const [name, pts, lo, hi] of [["annulus", ann, P.rIn + R, P.rOut - R], ["inner", car, 0, P.rIn - R]]) {
  let best = 0, at = null;
  for (let r = lo; r <= hi; r += 0.25)
    for (let d = 0; d < 360; d += 1) {
      const x = P.cx + r * Math.cos(d * Math.PI / 180), y = P.cy + r * Math.sin(d * Math.PI / 180);
      const m = near(pts, x, y);
      if (m > best) { best = m; at = [+x.toFixed(1), +y.toFixed(1), +r.toFixed(1), d]; }
    }
  console.log(`${name.padEnd(8)} furthest any reachable point gets from the free orbit: ${best.toFixed(1)}  (needs > ${REACH})  at (${at[0]},${at[1]}) r${at[2]} @${at[3]}`);
}
console.log("");
for (const [i, c] of L.cans.entries())
  console.log(`  can ${i + 1} (${c[0]},${c[1]})  annulus orbit ${near(ann, c[0], c[1]).toFixed(1)}   carousel orbit ${near(car, c[0], c[1]).toFixed(1)}`);
