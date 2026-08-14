// How many bands does a level ACTUALLY need? Exhaustive for k=1, randomized for k=2,3.
// A level with budget N is only honest if the minimum is N — otherwise players get benched.
// Usage: node minbands.mjs [levelIdx...]   (default: all)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const GAME_URL = new URL('../goomba-rider.html', import.meta.url).href;

const want = process.argv.slice(2).map(Number);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto(GAME_URL);
await page.waitForFunction(() => window.__gr);

const idxs = want.length ? want
  : await page.evaluate(() => window.__gr.LEVELS.map((L, i) => L.custom ? -1 : i).filter(i => i >= 0));

for (const li of idxs) {
  const r = await page.evaluate(li => {
    const { simulate, LEVELS, BAND_MAX } = window.__gr;
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

    const res = { name: L.name, legal: legal.length, k: {} };
    res.k[0] = simulate(li, []).result === 'win' ? { win: 1, of: 1, eg: [] } : { win: 0, of: 1 };
    // k=1 exhaustive
    let w1 = 0, eg1 = null;
    for (const bd of legal) if (simulate(li, [bd]).result === 'win') { w1++; eg1 = eg1 || bd; }
    res.k[1] = { win: w1, of: legal.length, eg: eg1 ? [eg1] : null };
    // k=2, k=3 randomized
    for (const k of [2, 3]) {
      if (k > (L.budget || 4)) break;
      const N = k === 2 ? 30000 : 20000;
      let w = 0, eg = null;
      for (let t = 0; t < N; t++) {
        const set = []; for (let m = 0; m < k; m++) set.push(pick());
        if (simulate(li, set).result === 'win') { w++; eg = eg || set; }
      }
      res.k[k] = { win: w, of: N, eg };
    }
    res.intended = L.solution && L.solution.length
      ? { n: L.solution.length, result: simulate(li, L.solution).result } : null;
    res.budget = L.budget || 4;
    return res;
  }, li);

  const found = [0, 1, 2, 3].find(k => r.k[k] && r.k[k].win > 0);
  console.log(`L${li + 1} ${r.name}  budget=${r.budget} intended=${r.intended ? r.intended.n + ' bands → ' + r.intended.result : 'none'}`);
  for (const k of [0, 1, 2, 3]) {
    if (!r.k[k]) continue;
    const v = r.k[k];
    console.log(`   ${k} band(s): ${v.win}/${v.of} win${k === 1 ? ' (exhaustive)' : k >= 2 ? ' (random sample)' : ''}` +
                (v.eg && v.win ? `  e.g. ${JSON.stringify(v.eg.map(bd => bd.map(p => p.map(n => +n.toFixed(0)))))}` : ''));
  }
  // The verdict combines two bounds. Lower: k=0/1 are exhaustive (so "no win" is
  // proof); k=2/3 are random samples (so "no win" only means "none found"). Upper:
  // the intended solution winning proves min ≤ its band count. When the bracket
  // pinches — nothing exhaustive below, intended at the budget wins — the minimum
  // IS the budget even if the random samples missed every needle.
  const upper = r.intended && r.intended.result === 'win' ? r.intended.n : Infinity;
  const lower = found !== undefined ? found : 2; // 0 and 1 are exhaustive
  const min = Math.min(found !== undefined ? found : Infinity, upper);
  console.log(`   → minimum bands needed: ${min === Infinity ? '>3' : found === undefined && min > lower ? `${lower}<n≤${min}` : min}` +
              (min === r.budget ? (found === undefined ? `  ✓ no smaller set found, and the ${r.budget}-band solution wins` : '  ✓ matches budget')
               : `  ✗ budget says ${r.budget}`));
}
await browser.close();
