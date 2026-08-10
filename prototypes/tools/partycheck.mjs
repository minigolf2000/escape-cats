// Verify the party suite in ../goomba-party-levels.json against the real sim.
// For every level: bare run must FAIL, solution must WIN, and the minimum
// band count must equal the player count — k=1 checked exhaustively on a
// grid, k=2..N-1 hunted with random sampling PLUS the beam-search solver
// (random sampling misses coordinated multi-band cheats; a directed search
// does not). Also reports finger-slop robustness and ride telemetry.
//
// Usage: node partycheck.mjs [idPrefix] [--fast] [--cards]
//   --fast   coarser grid + smaller samples (dev iteration)
//   --cards  writes a ride-card PNG per level into ../party-cards/
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { openGame, injectLevels, verifyLevel, robustness, rideCard } from './partylib.mjs';

const SRC = new URL('../goomba-party-levels.json', import.meta.url).pathname;
const REPORT = new URL('../party-report.json', import.meta.url).pathname;
const CARDS = new URL('../party-cards/', import.meta.url).pathname;
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const fast = process.argv.includes('--fast');
const cards = process.argv.includes('--cards');
const prefix = args[0] || '';

const suite = JSON.parse(readFileSync(SRC, 'utf8')).filter(L => L.meta.id.startsWith(prefix));
if (cards) mkdirSync(CARDS, { recursive: true });

const { browser, page } = await openGame();
const base = await injectLevels(page, suite);
const report = [];
let allOK = true;
for (let i = 0; i < suite.length; i++) {
  const li = base + i, L = suite[i];
  const t0 = Date.now();
  const v = await verifyLevel(page, li, fast
    ? { gridStep: 12, samples2: 4000, samples3: 3000, cheatK: 1800, cheatSeeds: [1, 2] }
    : { gridStep: 10, samples2: 12000, samples3: 9000, cheatK: 3000, cheatSeeds: [1, 2, 3] });
  const rob = await robustness(page, li, 60, 3);
  const card = await rideCard(page, li, cards ? `${CARDS}${L.meta.id}.png` : null, L.name);
  const cheatKs = Object.keys(v.cheats);
  // poppers must FIRE on the winning run. (Piñatas are exempt: honest kick
  // chains don't survive stage normalization — documented open problem.)
  const needEvents = L.pops?.length ? L.meta.players : 0;
  const minHonest = v.k[1].win === 0 && !cheatKs.length &&
    Object.values(v.k).every(o => o.win === 0 || o.exhaustive === undefined);
  const ok = v.bare.result !== 'win' && v.solution?.result === 'win' &&
    v.solution.n === L.meta.players && v.k[1].win === 0 && !cheatKs.length &&
    (!v.k[2] || v.k[2].win === 0) && (!v.k[3] || v.k[3].win === 0) &&
    v.solution.lens.every(l => l <= 58) && card.events >= needEvents;
  allOK = allOK && ok;
  const row = { id: L.meta.id, name: L.name, players: L.meta.players, ok,
    bare: v.bare.result, solution: v.solution ? `${v.solution.n} bands -> ${v.solution.result}` : 'MISSING',
    k1: `${v.k[1].win}/${v.k[1].of}`, k2: v.k[2] ? `${v.k[2].win}/${v.k[2].of}` : '-',
    k3: v.k[3] ? `${v.k[3].win}/${v.k[3].of}` : '-',
    beamCheats: cheatKs.length ? v.cheats : null,
    slop3: rob ? `${rob.pct}%` : '-',
    ride: card, secs: +((Date.now() - t0) / 1000).toFixed(0) };
  report.push(row);
  console.log(`${ok ? '✓' : '✗'} ${row.id.padEnd(14)} bare=${row.bare} sol=${row.solution} ` +
    `k1=${row.k1} k2=${row.k2} k3=${row.k3}${cheatKs.length ? ' BEAM-CHEAT@k=' + cheatKs : ''} ` +
    `slop=${row.slop3} air=${card.airPct}% ev=${card.events} t=${card.t}s (${row.secs}s)`);
}
await browser.close();
writeFileSync(REPORT, JSON.stringify(report, null, 1));
console.log(`${allOK ? 'ALL PASS' : 'FAILURES ABOVE'} — report -> ${REPORT}`);
process.exit(allOK ? 0 : 1);
