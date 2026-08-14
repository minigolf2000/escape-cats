// Greedy beam search for a working band set. Doubles as "is this level solvable at all
// within a given band count?" — and the solution it finds is the one a clever player
// would find. Run it at counts 1–3 to hunt shortcuts before a player does.
// Usage: node solve.mjs <levelIdx> [maxBands] [candidatesPerStage]
import { LEVELS, BAND_MAX, simulate } from "./lib.mjs";

const li = +(process.argv[2] || 0);
const budget = process.argv[3] ? +process.argv[3] : 4;
const K = +(process.argv[4] || 4000);

const L = LEVELS[li], b = L.bounds;
let seed = 8675309;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
// A band only matters if she touches it, so seed candidates near her current path
// (or near an uncollected plant) instead of uniformly over the level.
const randBand = (traj) => {
  for (let tries = 0; tries < 40; tries++) {
    let cx, cy;
    const roll = rnd();
    if (roll < 0.6 && traj && traj.length) {
      const p = traj[(rnd() * traj.length) | 0];
      cx = p[0] + (rnd() * 2 - 1) * 16; cy = p[1] + (rnd() * 2 - 1) * 16;
    } else if (roll < 0.85 && L.plants.length) {
      const m = L.plants[(rnd() * L.plants.length) | 0];
      cx = m[0] + (rnd() * 2 - 1) * 26; cy = m[1] + (rnd() * 2 - 1) * 26;
    } else {
      cx = b.x0 + rnd() * (b.x1 - b.x0); cy = b.y0 + rnd() * (b.y1 - b.y0);
    }
    const ang = rnd() * 6.283, len = 8 + rnd() * (BAND_MAX - 10);
    const ax = cx - Math.cos(ang) * len / 2, ay = cy - Math.sin(ang) * len / 2;
    const bx = cx + Math.cos(ang) * len / 2, by = cy + Math.sin(ang) * len / 2;
    if (Math.min(ax, bx) < b.x0 - 6 || Math.max(ax, bx) > b.x1 + 6 ||
        Math.min(ay, by) < b.y0 - 6 || Math.max(ay, by) > b.y1 + 6) continue;
    return [[+ax.toFixed(1), +ay.toFixed(1)], [+bx.toFixed(1), +by.toFixed(1)]];
  }
  return null;
};
// score a run: winning dominates, then plants, then getting near the goal
const score = (set) => {
  const r = simulate(li, set);
  let best = 1e9, plants = 0;
  const got = L.plants.map(() => false);
  for (const p of r.traj) {
    const d = Math.hypot(p[0] - L.goal[0], p[1] - L.goal[1]);
    if (d < best) best = d;
    L.plants.forEach((m, i) => {
      if (!got[i] && Math.hypot(p[0] - m[0], p[1] - m[1]) < 8) { got[i] = true; plants++; }
    });
  }
  return { s: (r.result === "win" ? 1e6 : 0) + plants * 1000 - best, r: r.result, plants,
           near: +best.toFixed(1), traj: r.traj };
};

let beam = [{ set: [], ...score([]) }];
let found = false;
for (let stage = 1; stage <= budget && !found; stage++) {
  const cands = [];
  for (const entry of beam) {
    for (let k = 0; k < Math.ceil(K / beam.length); k++) {
      const nb = randBand(entry.traj);
      if (!nb) continue;
      const set = entry.set.concat([nb]);
      const sc = score(set);
      // allow sideways/slightly-worse moves: band 1 often only matters as a setup for band 2
      if (sc.s > entry.s - 40) cands.push({ set, ...sc });
    }
  }
  cands.sort((p, q) => q.s - p.s);
  const uniq = [], seen = new Map(); // keep the beam diverse across plants-counts
  for (const c of cands) {
    const key = c.plants + ":" + Math.round(c.near / 12);
    if ((seen.get(key) || 0) >= 2) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
    uniq.push(c);
    if (uniq.length >= 10) break;
  }
  if (!uniq.length) { console.log(`  stage ${stage}: no improvement found`); break; }
  beam = uniq;
  console.log(`  stage ${stage}: best=${beam[0].r} plants=${beam[0].plants} near=${beam[0].near}`);
  if (beam[0].r === "win") found = true;
}
console.log(`L${li + 1} within ${budget} band(s): ${found ? "✓ SOLVED" : "✗ no solution found"}`);
console.log("  bands: " + JSON.stringify(beam[0].set));
