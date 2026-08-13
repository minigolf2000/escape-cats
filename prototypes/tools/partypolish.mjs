// Polish pass: hill-climb every baked solution for finger-slop tolerance.
// The solver optimizes for winning, not for surviving party thumbs — this
// nudges each winning set toward the fattest part of its solution basin.
// Usage: node partypolish.mjs [idPrefix]
import { readFileSync, writeFileSync } from 'node:fs';
import { openGame, injectLevels, robustify } from './partylib.mjs';

const SRC = new URL('../goomba-party-levels.json', import.meta.url).pathname;
const prefix = process.argv[2] || '';
const suite = JSON.parse(readFileSync(SRC, 'utf8'));

const { browser, page } = await openGame();
const base = await injectLevels(page, suite);
for (let i = 0; i < suite.length; i++) {
  const L = suite[i];
  if (!L.meta.id.startsWith(prefix) || !L.solution) continue;
  const r = await robustify(page, base + i, L.solution);
  console.log(`${L.meta.id}: slop ${r.slop}%${r.improved ? ' (improved)' : ''}`);
  if (r.improved) L.solution = r.set;
}
await browser.close();
writeFileSync(SRC, JSON.stringify(suite, null, 1));
console.log('polished ->', SRC);
