// Build the party suite: generate every level, find a solution with the beam
// solver (real sim), and bake the result into ../goomba-party-levels.json.
// Levels that fail to solve are reported and left out (fix the template!).
// Usage: node partybuild.mjs [familyPrefix]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { openGame, injectLevels, solve } from './partylib.mjs';
import { generateSuite } from './partygen.mjs';

const outFlag = process.argv.indexOf('--out');
const OUT = outFlag > 0 ? process.argv[outFlag + 1]
  : new URL('../goomba-party-levels.json', import.meta.url).pathname;
const prefix = process.argv.filter((a, i) => i >= 2 && !a.startsWith('--') && process.argv[i - 1] !== '--out')[0];
const suite = generateSuite(prefix);
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];

const { browser, page } = await openGame();
const base = await injectLevels(page, suite);
const done = [];
// container restarts kill long builds — checkpoint after every level
const checkpoint = () => {
  const ids = new Set(done.map(L => L.meta.id));
  const merged = prev.filter(p => !ids.has(p.meta.id)).concat(done)
    .sort((a, b) => a.meta.id.localeCompare(b.meta.id) || a.meta.players - b.meta.players);
  writeFileSync(OUT, JSON.stringify(merged, null, 1));
};
for (let i = 0; i < suite.length; i++) {
  const li = base + i, L = suite[i];
  // reuse a previous solution if it still wins (keeps hand-tuned ones stable)
  const old = prev.find(p => p.meta.id === L.meta.id);
  if (old?.solution) {
    const r = await page.evaluate(({ li, set }) => window.__gr.simulate(li, set).result,
      { li, set: old.solution });
    if (r === 'win') { L.solution = old.solution; done.push(L); checkpoint(); console.log(`${L.meta.id}: kept previous solution`); continue; }
  }
  let s = null;
  for (const [K, rounds, seed] of [[3500, 2, 11], [6000, 3, 77], [9000, 4, 1213], [9000, 4, 31337], [12000, 5, 999331]]) {
    s = await solve(page, li, L.budget, K, seed, rounds);
    if (s.found) break;
  }
  if (!s.found) { console.log(`${L.meta.id}: UNSOLVED (${s.result} near=${s.near})`); continue; }
  L.solution = s.set.map(bd => bd.map(p => p.map(n => +n.toFixed(1))));
  done.push(L);
  checkpoint();
  console.log(`${L.meta.id}: solved (${L.solution.length} bands)`);
}
await browser.close();

// merge: replace regenerated ids, keep everything else
const ids = new Set(done.map(L => L.meta.id));
const merged = prev.filter(p => !ids.has(p.meta.id)).concat(done)
  .sort((a, b) => a.meta.id.localeCompare(b.meta.id) || a.meta.players - b.meta.players);
writeFileSync(OUT, JSON.stringify(merged, null, 1));
console.log(`wrote ${merged.length} levels -> ${OUT}`);
