/*
 * Export the chosen designs into ../ as committed artwork: a PNG, an SVG, and
 * the recipe that made them. The recipe is the point — a genome plus the URL
 * reproduces the code exactly, so the artwork is never a dead end.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { QR } from "./engine.mjs";
import { evaluate } from "./solve.mjs";
import { writeMatrixPNG } from "./evolve.mjs";
import { scanCheck } from "./scan-check.mjs";
import { checkLink } from "./check-link.mjs";

const URL_DEFAULT = "https://youtu.be/JDO-JIjoIlk";

export function exportDesign(genome, url, path, { scale = 20, quiet = 4, note = "" } = {}) {
  const e = evaluate(genome, url);
  if (e.fitness < 0) throw new Error(`${path}: does not pass the gates`);
  const check = scanCheck(e.matrix, genome.version, url);
  const jsqr = Object.values(check.jsqr);
  if (!check.validate || (jsqr.length && !jsqr.every((v) => v === "ok")))
    throw new Error(`${path}: failed verification ${JSON.stringify(check)}`);
  writeMatrixPNG(`${path}.png`, e.matrix, genome.version, scale, quiet);
  writeFileSync(`${path}.svg`, QR.toSVG(e.matrix, genome.version, { scale, quiet }));
  writeFileSync(`${path}.json`, JSON.stringify({
    note, url, genome, mask: e.mask,
    modules: QR.sizeOf(genome.version), quiet,
    metrics: e.metrics, verified: check,
  }, null, 2) + "\n");
  return { e, check };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.QR_URL || URL_DEFAULT;
  // A code that scans perfectly and points at a 404 is still broken, and that
  // is the one thing none of the other checks here was looking at.
  const link = await checkLink(url);
  console.log(`${link.live ? "live" : "DEAD"} ${url}${link.title ? ` — ${link.title}` : ""} ${JSON.stringify(link.checks)}`);
  if (!link.live && !process.env.QR_SKIP_LINK_CHECK)
    throw new Error(`${url} does not resolve — set QR_SKIP_LINK_CHECK=1 to export anyway`);
  const jobs = [
    ["final-jdo/final.json", "../hexflex-qr",
      "HEX HEX FLEX inside a flat-top hexagon — the shipped design."],
    ["polish-A/final.json", "../hexflex-qr-dense",
      "Same design with the whole ground pushed dark instead of a band."],
    ["polish-S/final.json", "../hexflex-hexagon",
      "Shape only: the hexagon with no words in it."],
  ];
  for (const [src, out, note] of jobs) {
    let genome;
    try { genome = JSON.parse(readFileSync(src, "utf8")).genome; }
    catch { console.log(`skip ${out} (no ${src})`); continue; }
    const { e, check } = exportDesign(genome, url, out, { note });
    console.log(`${out.padEnd(24)} v${genome.version}${genome.level} ` +
      `miss ${e.metrics.misses} edge ${e.metrics.edgeMiss}/run ${e.metrics.edgeRun} ` +
      `spread ${e.metrics.spread} headroom ${check.headroom} — jsQR ${Object.values(check.jsqr).every((v) => v === "ok") ? "all ok" : "FAILED"}`);
  }
}
