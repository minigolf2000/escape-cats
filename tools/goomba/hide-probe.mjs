import { makeRun, stepRun, SUB, RUN_MAX, initLevel } from "./draft/_sim.mjs";
import { P, buildLevel } from "./draft/in-and-out.mjs";
// `key=value` on the command line overrides a param, so the map can be drawn
// for a CANDIDATE geometry — the hiding places move when the free ride does.
const over = {};
for (const a of process.argv.slice(2)) {
  const [k, v] = a.split("=");
  if (k in P) over[k] = v !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
}
if (Object.keys(over).length) { console.log("  overrides:", JSON.stringify(over)); console.log(""); }
const L = initLevel(buildLevel({ ...P, ...over }));
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
// How close to the EXACT middle can a can legally get? The middle itself is on
// the bare drop line, so the answer is a ring around it, not the point.
let best = 1e9, at = null;
for (let x = 55; x <= 78; x += 0.1) for (let y = 58; y <= 84; y += 0.1) {
  if (safe(x, y) < 9.7) continue;
  const d = Math.hypot(x - P.cx, y - P.cy);
  if (d < best) { best = d; at = [+x.toFixed(1), +y.toFixed(1)]; }
}
console.log(`  closest legal point to the exact middle: (${at[0]},${at[1]})  ${best.toFixed(1)} from it`);
for (const c of [[74.5,70.2],[76,70.2],[78,70.2],[80,70.2],[78,66],[50,70]])
  console.log(`    (${c[0]},${c[1]})  r${Math.hypot(c[0]-P.cx,c[1]-P.cy).toFixed(1)} from middle   conveyor ${near(ann,c[0],c[1]).toFixed(1)}  carousel ${near(car,c[0],c[1]).toFixed(1)}  bare ${near(bare,c[0],c[1]).toFixed(1)}`);
