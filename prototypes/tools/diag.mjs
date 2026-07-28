// Diagnose the failure mode of jittered runs on one level.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const li = +(process.argv[2] || 1); // 0-based level index

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file:///home/user/cat-games/prototypes/goomba-rider.html');
await page.waitForFunction(() => window.__gr);
const out = await page.evaluate((li) => {
  const { simulate, LEVELS } = window.__gr;
  const sol = LEVELS[li].solution;
  let seed = 999; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const fails = [];
  let wins = 0;
  for (let t = 0; t < 40; t++) {
    const jit = sol.map(([a, b]) => [
      [a[0] + (rnd() * 2 - 1) * 3, a[1] + (rnd() * 2 - 1) * 3],
      [b[0] + (rnd() * 2 - 1) * 3, b[1] + (rnd() * 2 - 1) * 3],
    ]);
    const r = simulate(li, jit);
    if (r.result === 'win') wins++;
    else fails.push({
      result: r.result, t: r.t,
      bands: jit.map(p => p.map(q => q.map(v => +v.toFixed(1)))),
      tail: r.traj.slice(-8),
    });
  }
  return { wins, fails: fails.slice(0, 6) };
}, li);
console.log(`L${li + 1}: ${out.wins}/40 win`);
for (const f of out.fails)
  console.log(`  ${f.result}@${f.t}s bands=${JSON.stringify(f.bands)} tail=${f.tail.map(p => p.join(',')).join(' ')}`);
await browser.close();
