// Robustness: partial solutions must fail; jittered solutions should mostly still win.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file:///home/user/cat-games/prototypes/goomba-rider.html');
await page.waitForFunction(() => window.__gr);

const res = await page.evaluate(() => {
  const out = [];
  const { simulate, LEVELS } = window.__gr;
  // deterministic pseudo-random jitter
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  LEVELS.forEach((L, i) => {
    const sol = L.solution;
    // partial solutions: drop each band in turn (only if >1 band)
    const partials = [];
    if (sol.length > 1)
      for (let k = 0; k < sol.length; k++)
        partials.push(simulate(i, sol.filter((_, j) => j !== k)).result);
    // jitter: 30 trials, each endpoint nudged up to ±3 units
    let wins = 0;
    const J = 3, N = 30;
    for (let t = 0; t < N; t++) {
      const jit = sol.map(([a, b]) => [
        [a[0] + (rnd() * 2 - 1) * J, a[1] + (rnd() * 2 - 1) * J],
        [b[0] + (rnd() * 2 - 1) * J, b[1] + (rnd() * 2 - 1) * J],
      ]);
      if (simulate(i, jit).result === 'win') wins++;
    }
    out.push({ lvl: i + 1, partials, jitterWins: wins, trials: N });
  });
  return out;
});

for (const r of res) {
  const partOk = r.partials.every(p => p !== 'win');
  console.log(`L${r.lvl}: partial-solutions=[${r.partials.join(', ') || 'n/a'}] ${partOk ? 'OK' : '!! a band is not needed'} | jitter ±3u: ${r.jitterWins}/${r.trials} win`);
}
await browser.close();
