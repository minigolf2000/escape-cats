/*
 * Gather the best of every lineage into one folder for the judge: one PNG per
 * candidate at a size a human (or another model) can actually read, plus a
 * card of the numbers that matter.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { QR } from "./engine.mjs";
import { evaluate } from "./solve.mjs";
import { writeMatrixPNG } from "./evolve.mjs";
import { scanCheck } from "./scan-check.mjs";

const runs = process.argv[2] || "runs";
const out = process.argv[3] || "review";
const perRun = +(process.argv[4] || 3);
mkdirSync(out, { recursive: true });

const cards = [];
for (const dir of readdirSync(runs)) {
  const man = `${runs}/${dir}/manifest.json`;
  if (!existsSync(man)) continue;
  const m = JSON.parse(readFileSync(man, "utf8"));
  for (const r of m.results.slice(0, perRun)) {
    const e = evaluate(r.genome, m.url);
    if (e.fitness < 0) continue;
    const name = `${dir}-${r.name.split("-").pop()}`;
    writeMatrixPNG(`${out}/${name}.png`, e.matrix, r.genome.version, 16, 4);
    writeFileSync(`${out}/${name}.svg`, QR.toSVG(e.matrix, r.genome.version, { scale: 16, quiet: 4 }));
    const check = scanCheck(e.matrix, r.genome.version, m.url);
    cards.push({
      name, mode: m.mode, fitness: +e.fitness.toFixed(1),
      version: r.genome.version, level: r.genome.level, mask: e.mask,
      font: r.genome.font, R: r.genome.R, squash: r.genome.squash,
      pointy: r.genome.pointy, ground: r.genome.ground, ring: r.genome.ring,
      outline: r.genome.outline, urlCase: r.genome.urlCase,
      area: e.metrics.fieldArea, ink: e.metrics.inkArea,
      glyphMiss: e.metrics.glyphMiss, haloMiss: e.metrics.haloMiss,
      fieldMiss: e.metrics.fieldMiss, edgeMiss: e.metrics.edgeMiss,
      timingCross: e.metrics.intrusionTiming, holes: e.metrics.intrusionHard,
      groundDark: e.metrics.ground,
      headroom: e.metrics.headroom, scans: check.validate,
      jsqr: Object.values(check.jsqr).every((v) => v === "ok") ? "all ok" : check.jsqr,
      genome: r.genome,
    });
  }
}
cards.sort((a, b) => b.fitness - a.fitness);
writeFileSync(`${out}/cards.json`, JSON.stringify(cards, null, 2));
for (const c of cards)
  console.log(`${c.name.padEnd(16)} ${String(c.fitness).padStart(7)}  ${c.mode.padEnd(6)} v${c.version}${c.level} ${String(c.font).padEnd(3)} R${c.R} sq${c.squash} ground=${c.ground} area=${c.area} ink=${c.ink} miss=${c.glyphMiss}/${c.haloMiss}/${c.fieldMiss} edge=${c.edgeMiss} tim=${c.timingCross} holes=${c.holes} hr=${c.headroom} ${c.scans ? "scans" : "FAILS"}`);
