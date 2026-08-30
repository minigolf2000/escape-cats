/*
 * The genetic algorithm. Population of genomes -> studio solver -> multiplicative
 * fitness -> tournament + uniform crossover + per-gene mutation.
 *
 * Run one mode per process:
 *   node evolve.mjs --mode both  --gens 60 --pop 64 --out runs/both
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { QR } from "./engine.mjs";
import { DEFAULT_GENOME, FONTS, hexRadiusAt, renderDesign, textWidth } from "./design.mjs";
import { evaluate, sameURL } from "./solve.mjs";
import { writePNG } from "./png.mjs";

export const URL_DEFAULT = "https://youtu.be/VIVIegSt81k";

const argv = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ") || "1"])
);

// ---------------- gene space ----------------
const CHOICE = (...v) => ({ kind: "choice", values: v });
const INT = (lo, hi) => ({ kind: "int", lo, hi });
const HALF = (lo, hi) => ({ kind: "half", lo, hi });   // multiples of 0.5
const REAL = (lo, hi, step) => ({ kind: "real", lo, hi, step });

const GENES = {
  version: CHOICE(5, 6, 7),
  level: CHOICE("L", "M", "Q"),
  urlCase: CHOICE("schemehost", "none"),
  font: CHOICE("t5", "s5", "b6", "b7"),
  letterSpace: INT(1, 2),
  lineSpace: INT(1, 3),
  cx: HALF(16, 25), cy: HALF(16, 25),
  R: REAL(8, 21, 0.5),
  squash: REAL(0.85, 1.7, 0.05),
  pointy: CHOICE(0, 1),
  tx: INT(-4, 4), ty: INT(-4, 4),
  halo: INT(0, 2),
  outline: INT(0, 2), outlineGap: INT(0, 3),
  ring: INT(0, 2),
  ground: CHOICE("dense", "rings", "halo"),
  ringPeriod: INT(3, 6), haloBand: INT(2, 8),
  spokes: CHOICE(0, 1),
  innerR: REAL(0, 14, 0.5),
  margin: REAL(0.2, 0.9, 0.05),
  marginCap: REAL(0.3, 1.0, 0.05),
  flipSeed: INT(0, 9999),
};

// Genes each mode is allowed to move. A gene left out keeps its seed value.
const ACTIVE = {
  both: ["version", "level", "urlCase", "font", "letterSpace", "lineSpace", "cx", "cy", "R",
    "squash", "pointy", "tx", "ty", "halo", "outline", "outlineGap", "ring",
    "ground", "ringPeriod", "haloBand", "margin", "marginCap", "flipSeed"],
  shapes: ["version", "level", "urlCase", "cx", "cy", "R", "squash", "pointy", "outline",
    "outlineGap", "ring", "spokes", "innerR", "ground", "ringPeriod", "haloBand",
    "margin", "marginCap", "flipSeed"],
  text: ["version", "level", "urlCase", "font", "letterSpace", "lineSpace", "cx", "cy",
    "tx", "ty", "halo", "margin", "marginCap", "flipSeed"],
};

function rnd(rng, gene) {
  switch (gene.kind) {
    case "choice": return gene.values[(rng() * gene.values.length) | 0];
    case "int": return gene.lo + ((rng() * (gene.hi - gene.lo + 1)) | 0);
    case "half": return gene.lo + Math.round(rng() * (gene.hi - gene.lo) * 2) / 2;
    case "real": {
      const n = Math.round((gene.hi - gene.lo) / gene.step);
      return +(gene.lo + ((rng() * (n + 1)) | 0) * gene.step).toFixed(3);
    }
  }
}

function nudge(rng, gene, cur) {
  if (gene.kind === "choice") return rnd(rng, gene);
  const span = gene.kind === "int" ? 1 : gene.kind === "half" ? 0.5 : gene.step;
  const steps = 1 + ((rng() * 3) | 0);
  let v = cur + (rng() < 0.5 ? -1 : 1) * span * steps;
  v = Math.max(gene.lo, Math.min(gene.hi, v));
  return gene.kind === "int" ? Math.round(v) : +v.toFixed(3);
}

// ---------------- population ----------------
function seedGenome(mode) {
  const g = { ...DEFAULT_GENOME, mode };
  if (mode === "shapes") g.words = "";
  if (mode === "text") { g.R = 0; g.ring = 0; g.outline = 0; }
  return g;
}

function mutate(rng, g, mode, rate) {
  const out = { ...g };
  for (const k of ACTIVE[mode]) {
    if (rng() > rate) continue;
    out[k] = rng() < 0.35 ? rnd(rng, GENES[k]) : nudge(rng, GENES[k], out[k]);
  }
  if (out.marginCap < out.margin) out.marginCap = out.margin;
  return out;
}

function cross(rng, a, b, mode) {
  const out = { ...a };
  for (const k of ACTIVE[mode]) out[k] = rng() < 0.5 ? a[k] : b[k];
  if (out.marginCap < out.margin) out.marginCap = out.margin;
  return out;
}

// A cheap repair pass beats a wasted evaluation: centre the hexagon on the
// text block and grow it until the words actually fit inside the shape.
function repair(g) {
  if (g.mode === "text") return g;
  const lines = (g.words || "").split("|").filter(Boolean);
  if (!lines.length) return g;
  // Grow the hexagon until every letter — and the white halo each letter needs
  // to stay off the noise — is genuinely inside it. Measured cell by cell
  // against the real boundary, because the binding corner is the outer edge of
  // the widest line, not anything you can derive from the block's bounding box.
  const pad = Math.max(1, g.halo) + (g.outline ? g.outline + g.outlineGap : 0);
  let need = 0;
  for (const [r, c] of renderDesign(g).glyphCells)
    for (let dr = -pad; dr <= pad; dr++)
      for (let dc = -pad; dc <= pad; dc++)
        need = Math.max(need, hexRadiusAt(g, r + dr, c + dc));
  if (g.R < need) g.R = Math.min(22, Math.ceil(need * 2) / 2);
  // A finder ring or alignment square inside the white field is a hole nothing
  // can close, so shrink until the shape clears them. (Timing strips are left
  // alone: those read as a dashed rule, and the fitness prices them cheaply.)
  for (let i = 0; i < 16 && g.R > 6; i++) {
    if (renderDesign(g).intrusionHard === 0) break;
    g.R = +(g.R - 0.5).toFixed(1);
  }
  return g;
}

// ---------------- run ----------------
export function run({ mode = "both", pop = 64, gens = 60, seed = 7, url = URL_DEFAULT,
  out = null, rate = 0.25, keep = 8, log = () => {} }) {
  const rng = QR.mulberry32(seed);
  const cache = new Map();
  const score = (g) => {
    const key = JSON.stringify(g);
    let v = cache.get(key);
    if (!v) { v = evaluate(g, url); cache.set(key, v); }
    return v;
  };

  let population = [];
  for (let i = 0; i < pop; i++) {
    let g = seedGenome(mode);
    if (i > 0) g = mutate(rng, g, mode, 0.9);
    population.push(repair(g));
  }

  let hall = [];
  for (let gen = 0; gen < gens; gen++) {
    const scored = population.map((g) => ({ g, e: score(g) }))
      .sort((a, b) => b.e.fitness - a.e.fitness);
    hall = [...hall, ...scored].sort((a, b) => b.e.fitness - a.e.fitness);
    // one entry per distinct look
    const seen = new Set();
    hall = hall.filter(({ g }) => {
      const k = [g.version, g.level, g.font, g.R, g.squash, g.pointy, g.cx, g.cy,
        g.tx, g.ty, g.outline, g.ring, g.spokes, g.innerR, g.ground, g.letterSpace, g.lineSpace].join("|");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, keep * 4);

    log(`gen ${String(gen).padStart(3)}  best ${scored[0].e.fitness.toFixed(1)}  ` +
      `area ${scored[0].e.metrics.fieldArea} ink ${scored[0].e.metrics.inkArea} ` +
      `miss ${scored[0].e.metrics.glyphMiss}/${scored[0].e.metrics.haloMiss}/${scored[0].e.metrics.fieldMiss} ` +
      `hr ${scored[0].e.metrics.headroom}`);

    const next = scored.slice(0, 4).map((s) => s.g);
    const pick = () => {
      let bestOne = null;
      for (let t = 0; t < 3; t++) {
        const cand = scored[(rng() * scored.length) | 0];
        if (!bestOne || cand.e.fitness > bestOne.e.fitness) bestOne = cand;
      }
      return bestOne.g;
    };
    while (next.length < pop) {
      const child = rng() < 0.75 ? cross(rng, pick(), pick(), mode) : { ...pick() };
      next.push(repair(mutate(rng, child, mode, rate)));
    }
    population = next;
  }

  const finals = hall.slice(0, keep);
  if (out) {
    mkdirSync(out, { recursive: true });
    const manifest = finals.map(({ g, e }, i) => {
      const res = e.res;
      const v = QR.validate(res.matrix, g.version, {});
      const name = `${mode}-${String(i).padStart(2, "0")}`;
      writeMatrixPNG(`${out}/${name}.png`, res.matrix, g.version, 14, 4);
      writeFileSync(`${out}/${name}.svg`, QR.toSVG(res.matrix, g.version, { scale: 14, quiet: 4 }));
      return {
        name, fitness: +e.fitness.toFixed(2), mask: e.mask, genome: g,
        metrics: e.metrics, headroom: res.headroom, freeDim: res.freeDim,
        ground: e.metrics.ground, edgeMiss: e.metrics.edgeMiss,
        scans: v.ok && sameURL(v.text, url), decoded: v.text,
      };
    });
    writeFileSync(`${out}/manifest.json`, JSON.stringify({ url, mode, pop, gens, seed, results: manifest }, null, 2));
  }
  return finals;
}

export function writeMatrixPNG(path, matrix, version, scale, quiet, opts = {}) {
  const { dark = [0, 0, 0], light = [255, 255, 255] } = opts;
  const size = QR.sizeOf(version);
  const dim = (size + quiet * 2) * scale;
  writePNG(path, dim, dim, (x, y) => {
    const r = ((y / scale) | 0) - quiet, c = ((x / scale) | 0) - quiet;
    const on = r >= 0 && r < size && c >= 0 && c < size && matrix[r * size + c] === 1;
    return on ? dark : light;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = argv.mode || "both";
  run({
    mode,
    pop: +(argv.pop || 64), gens: +(argv.gens || 60), seed: +(argv.seed || 7),
    url: argv.url || URL_DEFAULT,
    out: argv.out || `runs/${mode}`,
    log: (s) => process.stdout.write(s + "\n"),
  });
}
