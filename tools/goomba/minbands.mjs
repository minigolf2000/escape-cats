// How many bands does a level ACTUALLY need? Exhaustive for k=1, randomized for k=2,3.
// The party rule locks every level to 4 placed bands; a level is only honest if its
// true minimum matches what its design claims to need.
// Usage: node minbands.mjs [levelIdx...]   (default: all)
import { LEVELS, BAND_MAX, simulate } from "./lib.mjs";

const want = process.argv.slice(2).map(Number);
const idxs = want.length ? want : LEVELS.map((_, i) => i);

for (const li of idxs) {
  const L = LEVELS[li], b = L.bounds;
  const step = 10, pts = [];
  for (let x = b.x0; x <= b.x1; x += step)
    for (let y = b.y0; y <= b.y1; y += step) pts.push([x, y]);
  const legal = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const len = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
      if (len >= 6 && len <= BAND_MAX) legal.push([pts[i], pts[j]]);
    }
  // deterministic PRNG so runs are comparable
  let seed = 20260728;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = () => legal[(rnd() * legal.length) | 0];

  const k = {};
  k[0] = simulate(li, []).result === "win" ? { win: 1, of: 1 } : { win: 0, of: 1 };
  // k=1 exhaustive
  let w1 = 0, eg1 = null;
  for (const bd of legal) if (simulate(li, [bd]).result === "win") { w1++; eg1 = eg1 || bd; }
  k[1] = { win: w1, of: legal.length, eg: eg1 ? [eg1] : null };
  // k=2, k=3 randomized
  for (const kk of [2, 3]) {
    const N = kk === 2 ? 30000 : 20000;
    let w = 0, eg = null;
    for (let t = 0; t < N; t++) {
      const set = []; for (let m = 0; m < kk; m++) set.push(pick());
      if (simulate(li, set).result === "win") { w++; eg = eg || set; }
    }
    k[kk] = { win: w, of: N, eg };
  }
  const intended = L.solution && L.solution.length
    ? { n: L.solution.length, result: simulate(li, L.solution).result } : null;

  const found = [0, 1, 2, 3].find((kk) => k[kk] && k[kk].win > 0);
  console.log(`L${li + 1} ${L.name}  intended=${intended ? intended.n + " bands → " + intended.result : "none"}`);
  for (const kk of [0, 1, 2, 3]) {
    if (!k[kk]) continue;
    const v = k[kk];
    console.log(`   ${kk} band(s): ${v.win}/${v.of} win${kk === 1 ? " (exhaustive)" : kk >= 2 ? " (random sample)" : ""}` +
                (v.eg && v.win ? `  e.g. ${JSON.stringify(v.eg.map((bd) => bd.map((p) => p.map((n) => +n.toFixed(0)))))}` : ""));
  }
  // The verdict combines two bounds. Lower: k=0/1 are exhaustive (so "no win" is
  // proof); k=2/3 are random samples (so "no win" only means "none found"). Upper:
  // the intended solution winning proves min ≤ its band count.
  const upper = intended && intended.result === "win" ? intended.n : Infinity;
  const lower = found !== undefined ? found : 2; // 0 and 1 are exhaustive
  const min = Math.min(found !== undefined ? found : Infinity, upper);
  console.log(`   → minimum bands needed: ${min === Infinity ? ">3" : found === undefined && min > lower ? `${lower}<n≤${min}` : min}` +
              (found === undefined && min < Infinity ? `  (no smaller set found; the ${min}-band solution wins)` : ""));
}
