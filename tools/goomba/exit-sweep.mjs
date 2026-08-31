// WHY SHE CANNOT GET OUT THE BOTTOM, and which fix actually moves it.
//
//   node exit-sweep.mjs
//
// At the foot of a ring the flow is HORIZONTAL and the doorway is vertical, so
// she has to turn her direction inside the hole. This sweeps one band over the
// whole board and counts how often she makes it past the outer south door,
// under each candidate change. Two results are worth keeping:
//
//   * WIDENING THE DOOR BARELY HELPS. 2.6x wider buys 4% -> 6%; 4.3x buys 5%.
//     The hole was never the constraint.
//   * THE TWO STATIONS FLANKING THE BOTTOM ARE THE WHOLE THING. Remove them, or
//     drop their fire speed below ~62, and it goes 4% -> 81%.
//
// And the sting: `gets out` and `bare run` flip TOGETHER, at every setting
// tried. The thing that stops her leaving IS the thing that keeps her in, so
// the annulus cannot be both a trap and escapable. That is a shape decision,
// not a number to tune.
import { makeRun, stepRun, snapBand, SUB, RUN_MAX, initLevel } from "./draft/_sim.mjs";
import { P, buildLevel } from "./draft/in-and-out.mjs";

const run = (L, from, band) => {
  const b = band && snapBand(L, { ax: band[0][0], ay: band[0][1], bx: band[1][0], by: band[1][1] });
  const st = makeRun(L, b ? [b] : []);
  st.p.x = from[0]; st.p.y = from[1]; st.v.x = from[2]; st.v.y = from[3];
  st.snap = { x: st.p.x, y: st.p.y, t: 0 };
  const outY = P.cy + Math.sqrt(P.rOut ** 2 - ((P.gapS ?? P.gap) ** 2));
  let out = false;
  while (!st.result && st.t < RUN_MAX + 1) { stepRun(st, SUB); if (st.p.y > outY) out = true; }
  return { out, result: st.result };
};

const rate = (over, from) => {
  const L = initLevel(buildLevel({ ...P, ...over }));
  let n = 0, hit = 0;
  for (let cx = 22; cx <= 108; cx += 12)
    for (let cy = 24; cy <= 120; cy += 12)
      for (const a of [0, 60, 120]) {
        const dx = Math.cos((a * Math.PI) / 180) * 15, dy = Math.sin((a * Math.PI) / 180) * 15;
        n++;
        if (run(L, from, [[cx - dx, cy - dy], [cx + dx, cy + dy]]).out) hit++;
      }
  return { pct: (100 * hit / n).toFixed(0), bare: run(L, from, null).result };
};

const CONV = [64.8, 25.7, -110, 0];
console.log("                          from the conveyor: gets out | bare run");
for (const [label, over] of [
  ["as it stands (bottom stations at 145)", {}],
  ["bottom stations at 72", { aSlowS: 35, aSpdS: 72 }],
  ["bottom stations at 68", { aSlowS: 35, aSpdS: 68 }],
  ["bottom stations at 64", { aSlowS: 35, aSpdS: 64 }],
  ["bottom stations at 75", { aSlowS: 35, aSpdS: 75 }],
]) {
  const r = rate(over, CONV);
  console.log(`  ${label.padEnd(38)} ${String(r.pct + "%").padStart(4)}   ${r.bare}`);
}
