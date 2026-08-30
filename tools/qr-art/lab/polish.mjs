/*
 * Focused local search around one finished genome.
 *
 * The GA finds the design; this finds the best DRAW of it. Mask, flip
 * tie-break seed, error budget and half-module nudges do not change what the
 * picture is, only how cleanly the code grants it — and the last defects to
 * survive a GA run are always in that layer, because a mutation big enough to
 * reach them is big enough to break something else first.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { QR } from "./engine.mjs";
import { evaluate } from "./solve.mjs";
import { writeMatrixPNG } from "./evolve.mjs";
import { scanCheck } from "./scan-check.mjs";

const argv = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean)
  .map((s) => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ") || "1"]));

const cards = JSON.parse(readFileSync(argv.cards || "review2/cards.json", "utf8"));
const seedCard = cards.find((c) => c.name === argv.pick) || cards[0];
const url = argv.url || "https://youtu.be/VIVIegSt81k";
const out = argv.out || "polish";
mkdirSync(out, { recursive: true });

const base = seedCard.genome;
const around = (v, lo, hi, step) => {
  const s = [];
  for (let x = v - step * 2; x <= v + step * 2 + 1e-9; x += step)
    if (x >= lo && x <= hi) s.push(+x.toFixed(2));
  return s;
};

const axes = {
  R: around(base.R, 8, 21, 0.5),
  squash: around(base.squash, 0.85, 1.5, 0.05),
  cx: around(base.cx, 17, 24, 0.5),
  cy: around(base.cy, 17, 24, 0.5),
  ty: around(base.ty, -3, 3, 1),
  halo: [1, 2, 3],
  ring: [0, 1],
  margin: around(base.margin, 0.2, 0.95, 0.05),
  marginCap: around(base.marginCap, 0.3, 1.0, 0.05),
  ground: ["dense", "rings", "halo"],
  font: ["t5", "s5"],
  lineSpace: [1, 2, 3],
  letterSpace: [1, 2],
  flipSeed: [0, 17, 101, 523, 1229, 4001, 9173],
};

// Coordinate descent: sweep one axis at a time, keep the best, repeat until a
// full sweep changes nothing. Cheap, and it cannot wander off the design.
let best = { g: { ...base }, e: evaluate(base, url) };
for (let pass = 0; pass < 6; pass++) {
  let moved = false;
  for (const [k, values] of Object.entries(axes)) {
    for (const v of values) {
      if (best.g[k] === v) continue;
      const g = { ...best.g, [k]: v };
      if (g.marginCap < g.margin) continue;
      const e = evaluate(g, url);
      if (e.fitness > best.e.fitness) { best = { g, e }; moved = true; }
    }
  }
  process.stdout.write(`pass ${pass}  fitness ${best.e.fitness.toFixed(1)}  ` +
    `miss ${best.e.metrics.glyphMiss}/${best.e.metrics.haloMiss}/${best.e.metrics.fieldMiss} ` +
    `edge ${best.e.metrics.edgeMiss} run ${best.e.metrics.edgeRun} ` +
    `spread ${best.e.metrics.spread} ground ${best.e.metrics.ground} hr ${best.e.metrics.headroom}\n`);
  if (!moved) break;
}

const g = best.g;
writeMatrixPNG(`${out}/final.png`, best.e.matrix, g.version, 16, 4);
writeMatrixPNG(`${out}/final-small.png`, best.e.matrix, g.version, 6, 4);
writeFileSync(`${out}/final.svg`, QR.toSVG(best.e.matrix, g.version, { scale: 16, quiet: 4 }));
const check = scanCheck(best.e.matrix, g.version, url);
writeFileSync(`${out}/final.json`, JSON.stringify({
  url, from: seedCard.name, genome: g, mask: best.e.mask,
  metrics: best.e.metrics, scan: check,
}, null, 2));
console.log(JSON.stringify({ genome: g, metrics: best.e.metrics, scan: check }, null, 1));
