// Tightness report for every single-band level: how many placements win, and how
// many distinct solution families. Few families = a real puzzle; many = a gesture.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const step = +(process.argv[2] || 10);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto('file:///home/user/cat-games/prototypes/goomba-rider.html');
await page.waitForFunction(() => window.__gr);

const out = await page.evaluate(step => {
  const { simulate, LEVELS, BAND_MAX } = window.__gr;
  return LEVELS.map((L, li) => {
    if (L.custom) return null;
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
        if (simulate(li, [[pts[i], pts[j]]]).result === 'win') wins.push([pts[i], pts[j]]);
      }
    const fams = [];
    for (const w of wins) {
      const mx = (w[0][0] + w[1][0]) / 2, my = (w[0][1] + w[1][1]) / 2;
      const ang = Math.atan2(w[1][1] - w[0][1], w[1][0] - w[0][0]);
      const a = ((ang % Math.PI) + Math.PI) % Math.PI;
      const f = fams.find(f => Math.hypot(f.mx - mx, f.my - my) < 18 &&
                               Math.abs(((f.a - a + Math.PI / 2) % Math.PI) - Math.PI / 2) < 0.5);
      if (f) f.n++; else fams.push({ mx, my, a, n: 1, sample: w });
    }
    return {
      name: L.name, budget: L.budget || 4, solBands: (L.solution || []).length,
      bare: simulate(li, []).result, tried, wins: wins.length, fams: fams.length,
      top: fams.sort((p, q) => q.n - p.n).slice(0, 3)
        .map(f => `n=${f.n}@[${f.mx.toFixed(0)},${f.my.toFixed(0)}]`),
    };
  });
}, step);

for (const [i, r] of out.entries()) {
  if (!r) continue;
  const oneBand = r.solBands === 1;
  console.log(`L${i + 1} ${r.name}  (sol bands: ${r.solBands})`);
  console.log(`   bare=${r.bare} · 1-band wins ${r.wins}/${r.tried} (${(100 * r.wins / r.tried).toFixed(1)}%) · families=${r.fams}` +
              (oneBand ? '' : '  ← multi-band level; 1-band wins should be 0'));
  if (r.top.length) console.log(`   top families: ${r.top.join('  ')}`);
}
await browser.close();
