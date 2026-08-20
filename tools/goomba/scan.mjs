// Sweep one band placement across the level and report the outcome at each position —
// THE question while designing: "where does this band work, and how forgiving is it?"
// The band is vertical (a wall) or horizontal (a shelf/catch), swept along its
// perpendicular; already-placed bands are held fixed.
//
// Usage: node scan.mjs <levelIdx> v <spanLo> <spanHi> ['[fixed bands JSON]'] [sweepLo sweepHi]
//        node scan.mjs <levelIdx> h <spanLo> <spanHi> ['[fixed bands JSON]'] [sweepLo sweepHi]
//   v: sweeps a wall  [[x,spanLo],[x,spanHi]]  over x
//   h: sweeps a shelf [[spanLo,y],[spanHi,y]]  over y
// Example — where can Cat's Cradle's lane-1 wall go, given the other three?
//   node scan.mjs 3 v 14 40 '[[[-6,4],[22,20]],[[15,40],[15,80]],[[98,66],[98,116]]]'
// It only sweeps axis-aligned bands; for a tilted one, or for "how much room has
// this band got in every direction at once", use slack.mjs.
import { LEVELS, simulate } from "./lib.mjs";

const li = +(process.argv[2] || 0);
const orient = process.argv[3] || "v";
const spanLo = +process.argv[4], spanHi = +process.argv[5];
const fixed = process.argv[6] ? JSON.parse(process.argv[6]) : [];
if (!(spanHi > spanLo)) {
  console.error("need spanLo < spanHi (the band’s fixed axis, world units)");
  process.exit(1);
}

const L = LEVELS[li], b = L.bounds;
const from = process.argv[7] ? +process.argv[7] : orient === "v" ? b.x0 : b.y0;
const to = process.argv[8] ? +process.argv[8] : orient === "v" ? b.x1 : b.y1;
const rows = [];
for (let s = Math.ceil(from); s <= to; s += 2) {
  const band = orient === "v" ? [[s, spanLo], [s, spanHi]] : [[spanLo, s], [spanHi, s]];
  const r = simulate(li, [...fixed, band]);
  // count cans along the trajectory so near-misses are visible
  const got = L.cans.map(() => false);
  for (const p of r.traj)
    L.cans.forEach((m, i) => {
      if (!got[i] && Math.hypot(p[0] - m[0], p[1] - m[1]) < 8) got[i] = true;
    });
  const end = r.traj.length ? r.traj[r.traj.length - 1] : L.start;
  rows.push({ s, result: r.result, t: r.t, cans: got.filter(Boolean).length,
              nCans: L.cans.length, end: [Math.round(end[0]), Math.round(end[1])] });
}

let streak = null; // collapse runs of identical outcomes so win windows pop out
const flush = () => { if (streak) console.log(
  `  ${orient}=${String(streak.a).padStart(4)}..${String(streak.b).padEnd(4)} ${streak.result.padEnd(7)}` +
  ` cans=${streak.cans}/${streak.nCans}  end=(${streak.end})`); };
for (const r of rows) {
  const key = r.result + "/" + r.cans;
  if (streak && streak.key === key) { streak.b = r.s; continue; }
  flush();
  streak = { key, a: r.s, b: r.s, ...r };
}
flush();
const wins = rows.filter((r) => r.result === "win").map((r) => r.s);
console.log(wins.length ? `WIN at ${orient}=${wins.join(",")}` : "no winning position in the sweep");
