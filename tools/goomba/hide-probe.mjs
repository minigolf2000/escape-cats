import { makeRun, stepRun, SUB, RUN_MAX, initLevel } from "./draft/_sim.mjs";
import { P, buildLevel } from "./draft/in-and-out.mjs";
const L = initLevel(buildLevel());
const orbit = (f) => {
  const st = makeRun(L, []);
  st.p.x = f[0]; st.p.y = f[1]; st.v.x = f[2]; st.v.y = f[3];
  st.snap = { x: st.p.x, y: st.p.y, t: 0 };
  const pts = []; let n = 0;
  while (!st.result && st.t < RUN_MAX + 1) { stepRun(st, SUB); if (n++ % 4 === 0) pts.push([st.p.x, st.p.y]); }
  return pts;
};
const ann = orbit([64.8, 25.7, -110, 0]), car = orbit([64.8, 41.7, 90, 0]);
// The BARE run is a free ride too, and the cheapest one there is — a can on the
// no-band fall line is collected by doing nothing at all.
const bare = orbit([L.start[0], L.start[1], 20, 0]);
const near = (pts, x, y) => Math.min(...pts.map((p) => Math.hypot(p[0] - x, p[1] - y)));
const safe = (x, y) => Math.min(near(ann, x, y), near(car, x, y), near(bare, x, y));
const RMAX = P.rIn - 2.2;

// A coarse map of the inner circle: how far from BOTH free orbits, in units.
console.log("   inner circle — min distance to either free orbit (. <9.7 = free)\n");
let head = "      ";
for (let x = 32; x <= 98; x += 4) head += String(x).padStart(4);
console.log(head);
for (let y = 38; y <= 104; y += 4) {
  let row = String(y).padStart(4) + "  ";
  for (let x = 32; x <= 98; x += 4) {
    const r = Math.hypot(x - P.cx, y - P.cy);
    row += r > RMAX ? "   ·" : (safe(x, y) < 9.7 ? "   ." : String(Math.round(safe(x, y))).padStart(4));
  }
  console.log(row);
}
console.log("\n   · = outside the inner wall   . = on a free orbit\n");
// Candidates: every spot at least 9.7 from all three free rides, clustered.
const found = [];
for (let x = 28; x <= 102; x += 0.5) for (let y = 34; y <= 106; y += 0.5) {
  if (Math.hypot(x - P.cx, y - P.cy) > RMAX) continue;
  const s = safe(x, y);
  if (s >= 9.7) found.push([+x.toFixed(1), +y.toFixed(1), +s.toFixed(1)]);
}
const seen = [];
for (const f of found.sort((a, b) => b[2] - a[2]))
  if (!seen.some((g) => Math.hypot(g[0] - f[0], g[1] - f[1]) < 12)) seen.push(f);
console.log("  every distinct hiding place in the inner circle, best first:");
for (const [x, y, c] of seen) {
  const dir = `${y < 92 ? "up" : "down"}-${x > 52 ? "right" : "left"} of can 4`;
  console.log(`    (${x},${y})  clear ${c}   r${Math.hypot(x-P.cx,y-P.cy).toFixed(1)}  ${dir}`);
}
for (const c of [[93.7, 58.5], [52, 92]])
  console.log(`  today  (${c[0]},${c[1]})  conveyor ${near(ann,c[0],c[1]).toFixed(1)}  carousel ${near(car,c[0],c[1]).toFixed(1)}  bare ${near(bare,c[0],c[1]).toFixed(1)}`);
