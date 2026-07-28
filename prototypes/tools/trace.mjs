// Dense trajectory trace, for placing level geometry against where she actually flies.
// Usage: node trace.mjs <levelIdx> ['[[[ax,ay],[bx,by]],...]']  (bands JSON, optional)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const li = +(process.argv[2] || 0);
const bands = process.argv[3] ? JSON.parse(process.argv[3]) : [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto('file:///home/user/cat-games/prototypes/goomba-rider.html');
await page.waitForFunction(() => window.__gr);

const r = await page.evaluate(({ li, bands }) => {
  const L = window.__gr.LEVELS[li];
  return { r: window.__gr.simulate(li, bands), name: L.name, bounds: L.bounds,
           pops: L.pops, goal: L.goal, start: L.start };
}, { li, bands });

console.log(`L${li + 1} ${r.name} → ${r.r.result} @${r.r.t}s`);
console.log(`  start ${JSON.stringify(r.start)} goal ${JSON.stringify(r.goal)} bounds ${JSON.stringify(r.bounds)}`);
if (r.pops.length) console.log(`  poppers ${JSON.stringify(r.pops.map(p => [p.x, p.y, p.deg, p.spd]))}`);
console.log('  path (30fps samples, x,y):');
const t = r.r.traj;
for (let i = 0; i < t.length; i += 2) {
  const row = t.slice(i, i + 2).map(p => `(${p[0].toFixed(0).padStart(4)},${p[1].toFixed(0).padStart(4)})`).join(' ');
  console.log(`    t=${(i / 30).toFixed(2)}s  ${row}`);
}
await browser.close();
