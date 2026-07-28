// Greedy beam search for a working band set. Doubles as "is this level solvable at all
// within its budget?" — and the solution it finds is the one a clever player would find.
// Usage: node solve.mjs <levelIdx> [budget] [candidatesPerStage]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const li = +(process.argv[2] || 0);
const budgetArg = process.argv[3] ? +process.argv[3] : null;
const K = +(process.argv[4] || 4000);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto('file:///home/user/cat-games/prototypes/goomba-rider.html');
await page.waitForFunction(() => window.__gr);

const out = await page.evaluate(({ li, budgetArg, K }) => {
  const { simulate, LEVELS, BAND_MAX } = window.__gr;
  const L = LEVELS[li], b = L.bounds;
  const budget = budgetArg || L.budget || 4;
  let seed = 8675309;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // A band only matters if she touches it, so seed candidates near her current path
  // (or near an uncollected mouse) instead of uniformly over the level.
  const randBand = traj => {
    for (let tries = 0; tries < 40; tries++) {
      let cx, cy;
      const roll = rnd();
      if (roll < 0.6 && traj && traj.length) {
        const p = traj[(rnd() * traj.length) | 0];
        cx = p[0] + (rnd() * 2 - 1) * 16; cy = p[1] + (rnd() * 2 - 1) * 16;
      } else if (roll < 0.85 && L.mice.length) {
        const m = L.mice[(rnd() * L.mice.length) | 0];
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
  // score a run: winning dominates, then mice, then getting near the goal
  const score = set => {
    const r = simulate(li, set);
    const st = r.traj.length ? r.traj[r.traj.length - 1] : L.start;
    let best = 1e9, mice = 0;
    const got = L.mice.map(() => false);
    for (const p of r.traj) {
      const d = Math.hypot(p[0] - L.goal[0], p[1] - L.goal[1]);
      if (d < best) best = d;
      L.mice.forEach((m, i) => {
        if (!got[i] && Math.hypot(p[0] - m[0], p[1] - m[1]) < 8) { got[i] = true; mice++; }
      });
    }
    return { s: (r.result === 'win' ? 1e6 : 0) + mice * 1000 - best, r: r.result, mice,
             near: +best.toFixed(1), traj: r.traj };
  };

  let beam = [{ set: [], ...score([]) }];
  const log = [];
  for (let stage = 1; stage <= budget; stage++) {
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
    const uniq = [], seen = new Map();   // keep the beam diverse across mice-counts
    for (const c of cands) {
      const key = c.mice + ':' + Math.round(c.near / 12);
      if ((seen.get(key) || 0) >= 2) continue;
      seen.set(key, (seen.get(key) || 0) + 1);
      uniq.push(c);
      if (uniq.length >= 10) break;
    }
    if (!uniq.length) { log.push(`stage ${stage}: no improvement found`); break; }
    beam = uniq;
    log.push(`stage ${stage}: best=${beam[0].r} mice=${beam[0].mice} near=${beam[0].near}`);
    if (beam[0].r === 'win') return { found: true, best: beam[0], log, budget };
  }
  return { found: beam[0].r === 'win', best: beam[0], log, budget };
}, { li, budgetArg, K });

console.log(`L${li + 1} budget=${out.budget}`);
for (const l of out.log) console.log('  ' + l);
console.log(out.found ? '  ✓ SOLVED' : '  ✗ no solution found');
console.log("  bands: " + JSON.stringify(out.best.set));
await browser.close();
