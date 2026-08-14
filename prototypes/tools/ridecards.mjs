// Render one "ride card" PNG per level: the level plus her actual traced trajectory.
// The shape of the ride is the fun, so these are what get reviewed.
// Usage: node ridecards.mjs [outDir] [levelIdx...]   (default: every built-in level)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const GAME_URL = new URL('../goomba-rider.html', import.meta.url).href;

const outDir = process.argv[2] || '.';
const only = process.argv.slice(3).map(Number);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 460, height: 760 } });
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto(GAME_URL);
await page.waitForFunction(() => window.__gr);
await page.evaluate(() => window.__gr.skipTitle());

const n = await page.evaluate(() => window.__gr.LEVELS.filter(L => !L.custom).length);
const idxs = only.length ? only : Array.from({ length: n }, (_, i) => i);
const stats = [];
for (const i of idxs) {
  const s = await page.evaluate(i => window.__gr.rideCard(i), i);
  await page.waitForTimeout(60);
  await page.screenshot({ path: `${outDir}/ride-L${i + 1}.png` });
  stats.push({ level: i + 1, ...s });
}
console.log(JSON.stringify(stats, null, 1));
await browser.close();
