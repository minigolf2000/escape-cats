// Level solution search: brute-force single-band placements over a grid to answer
//   - does a solution exist at all?
//   - how MANY distinct solution families (1 = tight puzzle, many = mush)?
//   - is the intended solution the findable one?
// Usage: node search.mjs <levelIdx> [gridStep]
import { LEVELS, BAND_MAX, simulate } from "./lib.mjs";

const li = +(process.argv[2] || 0);
const step = +(process.argv[3] || 9);

const L = LEVELS[li], b = L.bounds;
const pts = [];
for (let x = b.x0; x <= b.x1; x += step)
  for (let y = b.y0; y <= b.y1; y += step) pts.push([x, y]);
const wins = [];
let tried = 0;
for (let i = 0; i < pts.length; i++) {
  for (let j = i + 1; j < pts.length; j++) {
    const len = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
    if (len < 6 || len > BAND_MAX) continue;
    tried++;
    if (simulate(li, [[pts[i], pts[j]]]).result === "win") wins.push([pts[i], pts[j]]);
  }
}
// cluster winners by midpoint so "families" means genuinely different ideas
const fams = [];
for (const w of wins) {
  const mx = (w[0][0] + w[1][0]) / 2, my = (w[0][1] + w[1][1]) / 2;
  const ang = Math.atan2(w[1][1] - w[0][1], w[1][0] - w[0][0]);
  const a = ((ang % Math.PI) + Math.PI) % Math.PI;
  let f = fams.find((f) => Math.hypot(f.mx - mx, f.my - my) < 18 &&
                          Math.abs(((f.a - a + Math.PI / 2) % Math.PI) - Math.PI / 2) < 0.5);
  if (f) { f.n++; f.mx = (f.mx * (f.n - 1) + mx) / f.n; f.my = (f.my * (f.n - 1) + my) / f.n; }
  else fams.push({ mx, my, a, n: 1, sample: w });
}
fams.sort((p, q) => q.n - p.n);

console.log(`L${li + 1} ${L.name}`);
console.log(`  bounds ${JSON.stringify(b)} · ${pts.length} grid pts · ${tried} placements tried`);
console.log(`  bare=${simulate(li, []).result} · intended solution=${
  L.solution && L.solution.length === 1 ? simulate(li, L.solution).result : "n/a (multi-band)"}`);
console.log(`  winning placements: ${wins.length}  (${((100 * wins.length) / tried).toFixed(1)}% of legal bands)`);
console.log(`  solution families (${fams.length}):`);
for (const f of fams.slice(0, 8))
  console.log(`    n=${String(f.n).padStart(4)} mid=[${f.mx.toFixed(0)},${f.my.toFixed(0)}] angle=${(f.a * 180 / Math.PI).toFixed(0)}° e.g. ${JSON.stringify(f.sample.map((p) => p.map((v) => +v.toFixed(0))))}`);
