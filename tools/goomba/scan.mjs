// Sweep one band placement across the level and report the outcome at each position —
// THE question while designing: "where does this band work, and how forgiving is it?"
// The band is vertical (a wall) or horizontal (a shelf/catch), swept along its
// perpendicular; already-placed bands are held fixed.
//
// Usage: node scan.mjs <levelIdx> v <spanLo> <spanHi> ['[fixed bands JSON]'] [sweepLo sweepHi]
//        node scan.mjs <levelIdx> h <spanLo> <spanHi> ['[fixed bands JSON]'] [sweepLo sweepHi]
//   v: sweeps a wall  [[x,spanLo],[x,spanHi]]  over x
//   h: sweeps a shelf [[spanLo,y],[spanHi,y]]  over y
// Example — where can a lane-0 wall go in The Popper Grid, given the other three?
//   node scan.mjs 7 v 34 60 '[[[10,68],[10,94]],[[86,102],[86,128]],[[26,136],[26,162]]]'
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
  // count plants along the trajectory so near-misses are visible
  const got = L.plants.map(() => false);
  for (const p of r.traj)
    L.plants.forEach((m, i) => {
      if (!got[i] && Math.hypot(p[0] - m[0], p[1] - m[1]) < 8) got[i] = true;
    });
  const end = r.traj.length ? r.traj[r.traj.length - 1] : L.start;
  rows.push({ s, result: r.result, t: r.t, plants: got.filter(Boolean).length,
              nPlants: L.plants.length, end: [Math.round(end[0]), Math.round(end[1])] });
}

let streak = null; // collapse runs of identical outcomes so win windows pop out
const flush = () => { if (streak) console.log(
  `  ${orient}=${String(streak.a).padStart(4)}..${String(streak.b).padEnd(4)} ${streak.result.padEnd(7)}` +
  ` plants=${streak.plants}/${streak.nPlants}  end=(${streak.end})`); };
for (const r of rows) {
  const key = r.result + "/" + r.plants;
  if (streak && streak.key === key) { streak.b = r.s; continue; }
  flush();
  streak = { key, a: r.s, b: r.s, ...r };
}
flush();
const wins = rows.filter((r) => r.result === "win").map((r) => r.s);
console.log(wins.length ? `WIN at ${orient}=${wins.join(",")}` : "no winning position in the sweep");
