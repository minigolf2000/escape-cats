// "Is there ANYWHERE a can could go that k bands can't reach?" — the tool that
// answers the design question `minbands.mjs` can't: not "how many bands does
// this level need", but "could a different collectible placement make it need
// one more". Run it before you spend a day nudging a can around.
//
// It beam-searches for WINNING band sets at k and at k+1 bands, paints every
// winning trajectory onto a grid, and reports the cells the k+1 runs reach that
// no k run does. Those cells — and only those — are where a new can forces a
// (k+1)th band. An empty list is a real answer: the level's silhouette cannot
// carry another gate, and the fix has to be geometry (a broken floor, a
// popper, a fence), not collectible placement. That is how level 1 was settled;
// DESIGNING.md carries the finding.
//
// Usage: node reach.mjs <levelIdx> [k] [--drop-can <i>] [--near x,y]
//   k           band budget to beat (default 3 — "can I force a 4th?")
//   --drop-can  remove can i first: you are asking where to put THAT can, so
//               the level must be searched without it
//   --near      rank the surviving cells by distance from this point
import { LEVELS, BAND_MAX, simulate, initLevel } from "./lib.mjs";

const li = +(process.argv[2] || 0);
const K = process.argv[3] && !process.argv[3].startsWith("--") ? +process.argv[3] : 3;
const dropArg = process.argv.indexOf("--drop-can");
const nearArg = process.argv.indexOf("--near");
const near = nearArg > 0 ? process.argv[nearArg + 1].split(",").map(Number) : null;

const SEEDS = [8675309, 1234567, 99887766, 42424242, 7777777, 31415926, 271828, 161803];
const CELL = 3;      // grid resolution, world units
const GRAZE = 9.7;   // can pickup radius (CAN_R + R): touching this = collected
const RES = 7;       // how close a (k+1) run must come to call a cell reachable

if (dropArg > 0) {
  const i = +process.argv[dropArg + 1];
  const L = LEVELS[li];
  L.cans = L.cans.filter((_, j) => j !== i);
  initLevel(L); // bounds are derived from the cans too
  console.log(`(searching without can ${i}; ${L.cans.length} left)`);
}

/** Beam search that keeps EVERY winner it meets, not just the first. */
function winners(budget, seed) {
  const L = LEVELS[li], b = L.bounds, found = [];
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const randBand = (traj) => {
    for (let t = 0; t < 40; t++) {
      let cx, cy;
      const roll = rnd();
      if (roll < 0.55 && traj?.length) {
        const p = traj[(rnd() * traj.length) | 0];
        cx = p[0] + (rnd() * 2 - 1) * 16; cy = p[1] + (rnd() * 2 - 1) * 16;
      } else if (roll < 0.75 && L.cans.length) {
        const m = L.cans[(rnd() * L.cans.length) | 0];
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
  const score = (set) => {
    const r = simulate(li, set);
    let best = 1e9, cans = 0;
    const got = L.cans.map(() => false);
    for (const p of r.traj) {
      const d = Math.hypot(p[0] - L.goal[0], p[1] - L.goal[1]);
      if (d < best) best = d;
      L.cans.forEach((m, i) => {
        if (!got[i] && Math.hypot(p[0] - m[0], p[1] - m[1]) < 8) { got[i] = true; cans++; }
      });
    }
    if (r.result === "win") found.push(r.traj);
    return { s: (r.result === "win" ? 1e6 : 0) + cans * 1000 - best, cans, near: best, traj: r.traj };
  };
  let beam = [{ set: [], ...score([]) }];
  for (let stage = 1; stage <= budget; stage++) {
    const cands = [];
    for (const e of beam)
      for (let n = 0; n < Math.ceil(2500 / beam.length); n++) {
        const nb = randBand(e.traj);
        if (!nb) continue;
        const set = e.set.concat([nb]);
        const sc = score(set);
        if (sc.s > e.s - 40) cands.push({ set, ...sc });
      }
    cands.sort((p, q) => q.s - p.s);
    const uniq = [], seen = new Map();
    for (const c of cands) {
      const key = c.cans + ":" + Math.round(c.near / 10);
      if ((seen.get(key) || 0) >= 3) continue;
      seen.set(key, (seen.get(key) || 0) + 1);
      uniq.push(c);
      if (uniq.length >= 12) break;
    }
    if (!uniq.length) break;
    beam = uniq;
  }
  return found;
}

const collect = (budget) => SEEDS.flatMap((s) => winners(budget, s));
const lo = collect(K), hi = collect(K + 1);
console.log(`L${li + 1} ${LEVELS[li].name}`);
console.log(`  winning runs found: ${lo.length} at ${K} band(s), ${hi.length} at ${K + 1}`);
if (!hi.length) {
  console.log(`  → no ${K + 1}-band winner found at all; nothing to compare.`);
  process.exit(0);
}

const touches = (runs, x, y, r) =>
  runs.some((t) => t.some((p) => Math.hypot(p[0] - x, p[1] - y) < r));

const b = LEVELS[li].bounds, cells = [];
for (let x = b.x0; x <= b.x1; x += CELL)
  for (let y = b.y0; y <= b.y1; y += CELL) {
    if (touches(lo, x, y, GRAZE + 1)) continue; // a k-band winner grazes it → useless
    if (!touches(hi, x, y, RES)) continue;      // no k+1 winner goes there → impossible
    cells.push([x, y]);
  }

console.log(`  cells only ${K + 1} bands reach: ${cells.length}`);
if (!cells.length) {
  console.log(`  → NO can placement can force a ${K + 1}th band on this silhouette.`);
  console.log(`     Needs geometry, not a collectible: break the floor, tilt it away`);
  console.log(`     from the plant, fence it, or add a popper to erase state.`);
} else {
  if (near) cells.sort((p, q) =>
    Math.hypot(p[0] - near[0], p[1] - near[1]) - Math.hypot(q[0] - near[0], q[1] - near[1]));
  console.log(`  ${near ? `nearest ${near}` : "sample"}: ${JSON.stringify(cells.slice(0, 30))}`);
}
