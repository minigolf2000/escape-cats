// Dense trajectory trace, for placing level geometry against where she actually flies.
// Usage: node trace.mjs <levelIdx> ['[[[ax,ay],[bx,by]],...]']  (bands JSON, optional)
import { LEVELS, simulate } from "./lib.mjs";

const li = +(process.argv[2] || 0);
const bands = process.argv[3] ? JSON.parse(process.argv[3]) : [];
const L = LEVELS[li];
const r = simulate(li, bands);

console.log(`L${li + 1} ${L.name} → ${r.result} @${r.t}s`);
console.log(`  start ${JSON.stringify(L.start)} goal ${JSON.stringify(L.goal)} bounds ${JSON.stringify(L.bounds)}`);
if (L.pops.length) console.log(`  poppers ${JSON.stringify(L.pops.map((p) => [p.x, p.y, p.deg, p.spd]))}`);
console.log("  path (30fps samples, x,y):");
const t = r.traj;
for (let i = 0; i < t.length; i += 2) {
  const row = t.slice(i, i + 2).map((p) => `(${p[0].toFixed(0).padStart(4)},${p[1].toFixed(0).padStart(4)})`).join(" ");
  console.log(`    t=${(i / 30).toFixed(2)}s  ${row}`);
}
