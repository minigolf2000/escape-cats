// Goomba Rider level verifier: every level must FAIL with no bands and WIN with its solution.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const FILE = 'file:///home/user/cat-games/prototypes/goomba-rider.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
await page.goto(FILE);
await page.waitForFunction(() => window.__gr);

const n = await page.evaluate(() => window.__gr.LEVELS.length);
let allOk = true;
for (let i = 0; i < n; i++) {
  const empty = await page.evaluate(i => window.__gr.simulate(i, []), i);
  const sol = await page.evaluate(i => {
    const s = window.__gr.LEVELS[i].solution;
    return window.__gr.simulate(i, s);
  }, i);
  const lens = await page.evaluate(i =>
    window.__gr.LEVELS[i].solution.map(([a, b]) => +Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(1)), i);
  const okEmpty = empty.result !== 'win';
  const okSol = sol.result === 'win';
  const okLen = lens.every(l => l <= 58);
  if (!okEmpty || !okSol || !okLen) allOk = false;
  console.log(`L${i + 1}: no-bands=${empty.result}@${empty.t}s ${okEmpty ? 'OK' : '!! should fail'} | solution=${sol.result}@${sol.t}s ${okSol ? 'OK' : '!! should win'} | band lens=${lens.join(',')}`);
  if (!okSol || process.env.TRAJ) {
    const tr = sol.traj.filter((_, j) => j % 6 === 0).map(p => p.join(',')).join(' ');
    console.log(`  sol traj: ${tr}`);
  }
  if (!okEmpty) {
    const tr = empty.traj.filter((_, j) => j % 6 === 0).map(p => p.join(',')).join(' ');
    console.log(`  empty traj: ${tr}`);
  }
}
console.log(allOk ? 'ALL LEVELS PASS' : 'FAILURES ABOVE');
await browser.close();
process.exit(allOk ? 0 : 1);
