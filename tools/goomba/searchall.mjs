// Tightness report for every level: how many single-band placements win, and how
// many distinct solution families. A multi-band level should have ZERO 1-band wins.
// Usage: node searchall.mjs [gridStep]
import { LEVELS, BAND_MAX, simulate } from "./lib.mjs";

const step = +(process.argv[2] || 10);
LEVELS.forEach((L, li) => {
  const b = L.bounds, pts = [];
  for (let x = b.x0; x <= b.x1; x += step)
    for (let y = b.y0; y <= b.y1; y += step) pts.push([x, y]);
  const wins = [];
  let tried = 0;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const len = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
      if (len < 6 || len > BAND_MAX) continue;
      tried++;
      if (simulate(li, [[pts[i], pts[j]]]).result === "win") wins.push([pts[i], pts[j]]);
    }
  const fams = [];
  for (const w of wins) {
    const mx = (w[0][0] + w[1][0]) / 2, my = (w[0][1] + w[1][1]) / 2;
    const ang = Math.atan2(w[1][1] - w[0][1], w[1][0] - w[0][0]);
    const a = ((ang % Math.PI) + Math.PI) % Math.PI;
    const f = fams.find((f) => Math.hypot(f.mx - mx, f.my - my) < 18 &&
                              Math.abs(((f.a - a + Math.PI / 2) % Math.PI) - Math.PI / 2) < 0.5);
    if (f) f.n++; else fams.push({ mx, my, a, n: 1 });
  }
  const solBands = (L.solution || []).length;
  console.log(`L${li + 1} ${L.name}  (sol bands: ${solBands})`);
  console.log(`   bare=${simulate(li, []).result} · 1-band wins ${wins.length}/${tried} (${((100 * wins.length) / tried).toFixed(1)}%) · families=${fams.length}` +
              (solBands === 1 ? "" : "  ← multi-band level; 1-band wins should be 0"));
  const top = fams.sort((p, q) => q.n - p.n).slice(0, 3)
    .map((f) => `n=${f.n}@[${f.mx.toFixed(0)},${f.my.toFixed(0)}]`);
  if (top.length) console.log(`   top families: ${top.join("  ")}`);
});
