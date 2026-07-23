// evolve-cat.mjs — Piece 11: the GENOME HARNESS for the evolutionary QR-art piece.
//
// This is the phenotype/fitness engine a genetic algorithm drives (see
// specs/11-evolve.md). The GA loop lives in a separate Workflow; this file is the
// deterministic renderer + scorer it invokes hundreds of times on machine-authored
// genomes. Two subcommands:
//
//   node evolve-cat.mjs render  <genome.json> <out.png>
//   node evolve-cat.mjs contact <a.png,b.png,...> <out.png> [labelA,labelB,...]
//
// DESIGN NOTES (reused technique from build-09/build-10, imported read-only from
// nearly-blank-lib.mjs — no existing build/lib/engine file is modified):
//   * INTACT-OR-ABSENT (build-10): each icon INSTANCE ends COMPLETE (100% of its
//     dark cells dark + its 1-module white halo clean) or ABSENT (dropped whole
//     before the final solve). A probe solve measures per-instance completeness,
//     drops the single worst imperfect instance WHOLE, re-solves, and repeats until
//     every survivor is perfect with headroom >= 2.
//   * FURNITURE GUARD (build-09 heroFuncHits): any icon whose dark OR halo cells
//     land on a function pattern (finder/timing/alignment/format) is rejected up
//     front — a mutilated glyph is the worst outcome.
//   * v10 BLOCK-AWARE SAFE MASK (build-10 safeMaskV10): v10-L has 4 blocks; the URL
//     dirties only block 0 (cols 48-56). A field cell is safe to pin white iff its
//     codeword is EC or lives in any block != 0, so the white ground never spends
//     block 0's scarce flip budget the icons compete for.
//   * THREE-TONE GRAY GROUND (build-04/08/10): gray ground surrenders the field to
//     noise rendered #3a3a3a; icons pure black, halos pure white pop off the gray.
//
// ROBUSTNESS CONTRACT (this is a GA fitness engine — it must never crash on a bad
// genome): invalid icons (off-grid, bad type/scale, on furniture) are skipped; a
// genome that cannot yield a scanning code still writes out.png (best effort) and a
// meta.json with valid:false, exiting 0 so the caller can score it. Only genuinely
// malformed input (missing file, unparseable JSON, bad CLI) exits nonzero.
//
// DETERMINISM: all randomness is seeded from genome.seed via mulberry32 — identical
// genome => identical PNG + meta. No Date.now / Math.random anywhere.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QRArt } from "./engine.mjs";
import { renderMatrix, writePNG, readPNG } from "./png.mjs";
import { scanRGBA, sameURL } from "./verify.mjs";
import { haloOf, block0Data, meterLine, flipSeedFor } from "./nearly-blank-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
const URL = "https://github.com/minigolf2000/cat-games";
const DEFAULT_VERSION = 10, DEFAULT_LEVEL = "L";

// Search budget. Kept deliberately small — the GA calls this hundreds of times, so
// per-genome wall time matters more than squeezing the last whiter field.
const FLIP_RESTARTS = 3;    // flip-seed rotations per mask in the intact-or-absent search
const NOISE_RESTARTS = 40;  // noise samples swept for a scanning + whitest field

// ---------------------------------------------------------------------------
// GLYPHS. Procedural pixel-art at integer/half-integer scale. Base bitmaps are
// hand-tuned to READ at ~6-8 modules (prototyped + eyeballed at scale 16-24):
//   * paw — 4 toe beans in a shallow arc (outer two a row lower) directly on a
//     rounded main pad. Reads as a paw print.
//   * cat, TWO STYLES (genome "catStyle": "silhouette" | "face", default
//     silhouette). A flat-topped "two bumps on a wide body" silhouette reads as a
//     CROWN, so both styles lean on the cues crowns lack — a round head, a neck
//     pinch, and (silhouette) a tail, or (face) white eye cutouts:
//       - SILHOUETTE (~8w x 8t): round head whose CHEEKS are wider than the ear
//         span (two 1-gap ear caps), a clear NECK PINCH (head narrower than body),
//         a body trapezoid widening to a flat base, and a bold TAIL hooking up the
//         lower-right, held off the body by its halo gap. Solid fill.
//       - FACE (~6w x 6t): a round dark head filling the footprint, two corner
//         ear triangles (1-gap), and WHITE-CUTOUT eyes + mouth in the upper-middle
//         — an unmistakable creature face even at tiny size. The cutouts are
//         interior light cells; the 1-module halo band already REQUIRES every
//         light cell adjacent to dark to stay white, so they are pinned white and
//         gated by the same intact-or-absent completeness rule as the outer halo.
// A glyph returns { dark:Set<"dr,dc">, halo:Set<"dr,dc">, w, h } in LOCAL offsets
// (dark bbox top-left = 0,0; halo may carry -1 offsets and interior holes).
// ---------------------------------------------------------------------------
const PAW_BASE = [
  "..#.#..",
  "#.###.#",
  ".#####.",
  "#######",
  ".#####.",
];
// Sitting-cat silhouette: ears (r0), head top (r1), wide cheeks (r2), neck pinch
// (r3), widening body (r4-6), flat base (r7); tail hooks up the right (r4-6, c6-7).
const CAT_SILHOUETTE = [
  ".#.#....",
  ".###....",
  "#####...",
  "..##....",
  ".####..#",
  ".####.##",
  "#####.##",
  "######..",
];
// Cat face: corner ears (r0), solid head (r1-5), white eye holes (r2, c1 & c4),
// white mouth holes (r4, c2 & c3), round chin (r5).
const CAT_FACE = [
  "#....#",
  "######",
  "#.##.#",
  "######",
  "##..##",
  ".####.",
];
// Question mark (~5w x 8t): a classic pixel-font '?'. A rounded hook loop up top
// (r0-1, hollow centre), the curve sweeps down the right and back to a chunky
// 2-module central stem (r2-5), a 1-module light GAP (r6), then a 2-module dot
// (r7). Strokes are >=2 modules so the glyph survives the halo/intact rule and
// still reads as ? at base scale. The dot is a separate dark component but rides
// the same instance (kept or dropped whole by intact-or-absent).
const QMARK_BASE = [
  ".###.",
  "##.##",
  "...##",
  "..##.",
  ".##..",
  ".##..",
  ".....",
  ".##..",
];
// Keyhole (~5w x 7t): a SOLID blob — a round dark disc up top (r0-3, ~5 wide with
// rounded top corner) fused to a wedge/trapezoid that flares DOWN beneath it
// (r4-5 a 3-wide neck widening to a 5-wide base at r6). Crisp edge, solid
// interior (no cutouts), so it fills like a stamped keyhole silhouette.
const KEYHOLE_BASE = [
  ".###.",
  "#####",
  "#####",
  "#####",
  ".###.",
  "#####",
  "#####",
];

function parseBitmap(rows) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const cells = new Set();
  for (let r = 0; r < h; r++)
    for (let c = 0; c < rows[r].length; c++)
      if (rows[r][c] === "#") cells.add(r + "," + c);
  return { cells, w, h };
}

// Nearest-neighbour upscale by factor s (integer OR half-integer, e.g. 1.5). The
// spec's "round to grid" — deterministic, and it keeps the silhouette recognizable
// because sampling at cell centres never drops a whole feature row/column.
function scaleGlyph(base, s) {
  const { cells, w, h } = base;
  const ow = Math.max(1, Math.round(w * s)), oh = Math.max(1, Math.round(h * s));
  const dark = new Set();
  for (let or = 0; or < oh; or++)
    for (let oc = 0; oc < ow; oc++) {
      const br = Math.min(h - 1, Math.floor((or + 0.5) / s));
      const bc = Math.min(w - 1, Math.floor((oc + 0.5) / s));
      if (cells.has(br + "," + bc)) dark.add(or + "," + oc);
    }
  return { dark, w: ow, h: oh };
}

// 1-module Chebyshev halo band around the dark set, in offset space (excludes the
// dark cells themselves; may include -1 offsets).
function glyphHalo(dark) {
  const halo = new Set();
  for (const key of dark) {
    const [r, c] = key.split(",").map(Number);
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const k = (r + dr) + "," + (c + dc);
        if (!dark.has(k)) halo.add(k);
      }
  }
  return halo;
}

const BASES = {
  paw: parseBitmap(PAW_BASE),
  catSilhouette: parseBitmap(CAT_SILHOUETTE),
  catFace: parseBitmap(CAT_FACE),
  qmark: parseBitmap(QMARK_BASE),
  keyhole: parseBitmap(KEYHOLE_BASE),
};
const ALLOWED_SCALES = new Set([1, 1.5]);
const glyphCache = new Map();
// catStyle only matters for type "cat" ("silhouette" | "face"); ignored for paw.
function glyphOf(type, scale, catStyle = "silhouette") {
  let base;
  if (type === "paw") base = BASES.paw;
  else if (type === "cat") base = catStyle === "face" ? BASES.catFace : BASES.catSilhouette;
  else if (type === "qmark") base = BASES.qmark;
  else if (type === "keyhole") base = BASES.keyhole;
  else return null;
  const key = type + (type === "cat" ? "/" + (catStyle === "face" ? "face" : "silhouette") : "") + "@" + scale;
  if (glyphCache.has(key)) return glyphCache.get(key);
  const g = scaleGlyph(base, scale);
  g.halo = glyphHalo(g.dark);
  glyphCache.set(key, g);
  return g;
}

// ---------------------------------------------------------------------------
// v10-aware block-aware safe mask (build-10 safeMaskV10, verbatim technique). A
// cell is safe to pin white iff its codeword is EC or belongs to a data block
// other than block 0. Recomputed from prep.lay.inter (no constant ported).
// ---------------------------------------------------------------------------
function safeMaskV10(prep, S) {
  const lay = prep.lay;
  const safe = new Uint8Array(S * S);
  for (let mi = 0; mi < S * S; mi++) {
    const bit = lay.moduleToBit[mi];
    if (bit < 0 || bit >= lay.totalCw * 8) { safe[mi] = 1; continue; } // remainder bits
    const info = lay.inter[bit >> 3];
    safe[mi] = info.isEC || info.block !== 0 ? 1 : 0;
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Rasterize one genome icon to an instance, or return { skip:reason } if invalid.
// An instance = { type, r, c, scale, center, mods:Set<int>, halo:Set<int> }.
// Furniture guard: dark OR halo touching a function module => skip.
// Off-grid: any dark cell out of bounds => skip. Bad type/scale => skip.
// ---------------------------------------------------------------------------
function rasterizeIcon(icon, S, funcSet, idx, inB, catStyle) {
  if (!icon || typeof icon !== "object") return { skip: "not-an-object" };
  const { type } = icon;
  const scale = icon.scale;
  const r0 = icon.r, c0 = icon.c;
  if (type !== "cat" && type !== "paw" && type !== "qmark" && type !== "keyhole") return { skip: "bad-type" };
  if (!ALLOWED_SCALES.has(scale)) return { skip: "bad-scale" };
  if (!Number.isInteger(r0) || !Number.isInteger(c0)) return { skip: "bad-coord" };
  const g = glyphOf(type, scale, catStyle);
  if (!g) return { skip: "bad-type" };

  const mods = new Set();
  for (const key of g.dark) {
    const [dr, dc] = key.split(",").map(Number);
    const r = r0 + dr, c = c0 + dc;
    if (!inB(r, c)) return { skip: "off-grid" };       // any dark cell off-grid: reject whole icon
    const i = idx(r, c);
    if (funcSet[i]) return { skip: "on-furniture" };    // furniture guard (dark)
    mods.add(i);
  }
  const halo = new Set();
  for (const key of g.halo) {
    const [dr, dc] = key.split(",").map(Number);
    const r = r0 + dr, c = c0 + dc;
    if (!inB(r, c)) continue;                            // halo may clip the edge — fine
    const i = idx(r, c);
    if (funcSet[i]) return { skip: "halo-on-furniture" };// furniture guard (halo)
    if (mods.has(i)) continue;
    halo.add(i);
  }
  if (mods.size === 0) return { skip: "empty" };
  const center = [r0 + Math.floor(g.h / 2), c0 + Math.floor(g.w / 2)];
  return { type, r: r0, c: c0, scale, center, mods, halo };
}

// ---------------------------------------------------------------------------
// The intact-or-absent solver (adapted from build-10 solveWall, trimmed to this
// harness: no heroes/protect/soft zones — a GA genome is a flat icon list). Probe-
// solves, drops the worst imperfect instance whole, re-solves, until every survivor
// is COMPLETE (all mods dark + halo light) with headroom >= 2. Searches the given
// masks x flip restarts; keeps the config with the most survivors then whitest.
// minKeep = 0 so a hopeless genome degrades to an empty (icon-free) code rather
// than throwing — the caller still gets a scannable best-effort render + score.
// ---------------------------------------------------------------------------
function solveIcons(prep, instances, safe, S, funcSet, { masks, toned, baseNoise }) {
  const idx = (r, c) => r * S + c;
  const inB = (r, c) => r >= 0 && c >= 0 && r < S && c < S;
  const cdist = (ins) => (ins.center[0] - (S >> 1)) ** 2 + (ins.center[1] - (S >> 1)) ** 2;
  // Central-first ordering: the middle of the composition claims rank priority.
  const order = instances.slice().sort((a, b) => cdist(a) - cdist(b));

  const buildIO = (active) => {
    const ord = [], target = new Uint8Array(S * S), seq = new Int32Array(S * S).fill(-1);
    const push = (i, dark) => { if (seq[i] !== -1) return; ord.push(i); target[i] = dark ? 1 : 0; seq[i] = ord.length; };
    const keptStrokes = new Set();
    for (const ins of active) for (const i of ins.mods) keptStrokes.add(i);
    // pass 1: strokes dark + required halos white, central-first (order).
    for (const ins of active) {
      for (const i of ins.mods) push(i, true);
      for (const i of ins.halo) if (!keptStrokes.has(i)) push(i, false);
    }
    // pass 2: white ground on safe cells (skipped entirely for the gray/toned
    // ground, which surrenders the field to #3a3a3a noise). Central-first so the
    // scarce flip budget whitens near the icons; the frozen right columns stay grain.
    if (!toned) {
      const field = [];
      for (let i = 0; i < S * S; i++) {
        if (funcSet[i] || !safe[i] || seq[i] !== -1) continue;
        field.push(i);
      }
      field.sort((a, b) => {
        const ar = (a / S) | 0, ac = a % S, br = (b / S) | 0, bc = b % S;
        return ((ar - (S >> 1)) ** 2 + (ac - (S >> 1)) ** 2) - ((br - (S >> 1)) ** 2 + (bc - (S >> 1)) ** 2);
      });
      for (const i of field) push(i, false);
    }
    return { order: ord, target, seq };
  };

  const runSolve = (io, mask, flipSeed, noiseSeed) => QRArt.solveArt(prep, {
    order: io.order, target: io.target, seq: io.seq, mask,
    margin: 0.5, marginCap: 0.8, noiseRng: QRArt.mulberry32(noiseSeed >>> 0), flipSeed,
  });

  const insScore = (m, ins) => {
    let dk = 0; for (const i of ins.mods) if (m[i] === 1) dk++;
    let lt = 0; for (const i of ins.halo) if (m[i] === 0) lt++;
    const strokeSat = ins.mods.size ? dk / ins.mods.size : 1;
    const haloSat = ins.halo.size ? lt / ins.halo.size : 1;
    return { strokeSat, haloSat, complete: strokeSat >= 0.9999 && haloSat >= 0.9999, score: strokeSat + haloSat };
  };
  const whitenessOf = (m) => {
    let t = 0, l = 0;
    for (let i = 0; i < S * S; i++) { if (funcSet[i]) continue; t++; if (m[i] === 0) l++; }
    return t ? l / t : 1;
  };

  let best = null;
  for (const mask of masks) {
    for (let t = 0; t < FLIP_RESTARTS; t++) {
      const flipSeed = flipSeedFor(t);
      let active = order.slice();
      let matrix = null, guard = 0;
      while (guard++ < instances.length + 4) {
        const io = buildIO(active);
        const res = runSolve(io, mask, flipSeed, baseNoise);
        matrix = res.matrix;
        const scored = active.map((ins) => ({ ins, ...insScore(matrix, ins) }));
        const imperfect = scored.filter((s) => !s.complete);
        const headroomOK = res.headroom >= 2;
        if (imperfect.length === 0 && headroomOK) break; // converged
        // drop the worst imperfect (lowest score); if all complete but headroom<2,
        // drop the least-central instance to relieve budget.
        let victim = null;
        if (imperfect.length > 0) victim = imperfect.sort((a, b) => a.score - b.score)[0].ins;
        else if (!headroomOK && active.length) victim = scored.sort((a, b) => cdist(b.ins) - cdist(a.ins))[0].ins;
        if (!victim) break;                              // nothing left to drop (active empty)
        active = active.filter((ins) => ins !== victim);
      }
      // require every survivor perfect (an empty survivor list is legal — kept 0).
      const finalScored = active.map((ins) => ({ ins, ...insScore(matrix, ins) }));
      if (finalScored.some((s) => !s.complete)) continue;
      const kept = active.length, white = whitenessOf(matrix);
      const key = kept * 1000 + white * 100;             // most kept, then whitest
      if (!best || key > best.key) best = { key, mask, flipSeed, active, kept, white };
    }
  }
  return { best, buildIO, runSolve, whitenessOf };
}

// ---------------------------------------------------------------------------
// Three-tone rasteriser (build-10). Function patterns + kept-icon cells => pure
// black; surrendered-noise dark cells => gray #3a3a3a (the ground); light => white.
// jsQR thresholds gray as dark against white, so the toned image still scans, and
// the black icons + white halos pop off the gray.
// ---------------------------------------------------------------------------
const GRAY = [0x3a, 0x3a, 0x3a];
function renderToned(m, shapeMask, S, funcSet, { scale = 8, quiet = 4 } = {}) {
  const dim = (S + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      const i = r * S + c;
      if (!m[i]) continue;
      const col = (funcSet[i] || shapeMask.has(i)) ? [0, 0, 0] : GRAY;
      const x0 = (c + quiet) * scale, y0 = (r + quiet) * scale;
      for (let y = 0; y < scale; y++)
        for (let x = 0; x < scale; x++) {
          const o = ((y0 + y) * dim + (x0 + x)) * 4;
          data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2];
        }
    }
  return { data, width: dim, height: dim };
}

// ---------------------------------------------------------------------------
// render subcommand. Reads a genome, produces out.png (best effort) + a meta.json
// alongside it. NEVER throws on a bad genome — returns the meta object.
// ---------------------------------------------------------------------------
function renderGenome(genome, outPath) {
  const version = genome.version ?? DEFAULT_VERSION;
  const level = genome.level ?? DEFAULT_LEVEL;
  const S = QRArt.sizeOf(version);
  const fp = QRArt.functionPatterns(version);
  const funcSet = fp.func;
  const idx = (r, c) => r * S + c;
  const inB = (r, c) => r >= 0 && c >= 0 && r < S && c < S;

  const seed = (Number.isFinite(genome.seed) ? genome.seed : 0) >>> 0;
  const toned = (genome.ground ?? "gray") === "gray";
  const catStyle = genome.catStyle === "face" ? "face" : "silhouette"; // default silhouette
  const maskReq = genome.mask;
  const masks = (maskReq === "auto" || maskReq === undefined || maskReq === null)
    ? [0, 1, 2, 3, 4, 5, 6, 7]
    : [Number(maskReq) & 7];

  const prep = QRArt.prepareArt(URL, version, level, "schemehost");
  const safe = safeMaskV10(prep, S);

  // Rasterize + furniture-guard. Skipped icons are logged but never abort the run.
  const iconList = Array.isArray(genome.icons) ? genome.icons : [];
  const placed = [];
  for (const icon of iconList) {
    const ins = rasterizeIcon(icon, S, funcSet, idx, inB, catStyle);
    if (ins.skip) continue;
    placed.push(ins);
  }

  // Solve intact-or-absent. A totally hopeless icon set degrades to kept 0.
  const noiseSeq = QRArt.mulberry32(seed ^ 0x1e3779b9);
  const baseNoise = (Math.floor(noiseSeq() * 0xffffffff)) >>> 0;
  const { best, buildIO, runSolve, whitenessOf } = solveIcons(
    prep, placed, safe, S, funcSet, { masks, toned, baseNoise }
  );

  let matrix, kept = [], usedMask = masks[0];
  if (best) {
    kept = best.active;
    usedMask = best.mask;
    const shapeSet = new Set();
    for (const ins of kept) for (const i of ins.mods) shapeSet.add(i);
    // Noise sweep. The pins & flips are noise-invariant (noiseRng XORs only the
    // free null-space), so completeness/headroom are identical across seeds and only
    // the grain field moves. That means whiteness is the cheap discriminator: sample
    // NOISE_RESTARTS fields, rank by whiteness, then jsQR-verify in that order and
    // take the FIRST that scans at scale 8 AND 3 (grain rarely breaks a scan, so
    // this usually hits on the whitest — far cheaper than scanning every sample).
    const io = buildIO(kept);
    const samples = [];
    for (let n = 0; n < NOISE_RESTARTS; n++) {
      const sd = (Math.floor(noiseSeq() * 0xffffffff)) >>> 0;
      const res = runSolve(io, best.mask, best.flipSeed, sd);
      samples.push({ m: res.matrix, white: whitenessOf(res.matrix) });
    }
    samples.sort((a, b) => b.white - a.white);
    const scans = (m) => {
      const i8 = toned ? renderToned(m, shapeSet, S, funcSet, { scale: 8, quiet: 4 }) : renderMatrix(m, version, { scale: 8, quiet: 4 });
      if (!sameURL(scanRGBA(i8), URL)) return false;
      const i3 = toned ? renderToned(m, shapeSet, S, funcSet, { scale: 3, quiet: 4 }) : renderMatrix(m, version, { scale: 3, quiet: 4 });
      return sameURL(scanRGBA(i3), URL);
    };
    matrix = null;
    for (const s of samples) { if (scans(s.m)) { matrix = s.m; break; } }
    // Fall back to the whitest sample even if none scanned (meta records valid:false).
    if (!matrix) matrix = samples.length ? samples[0].m : runSolve(io, best.mask, best.flipSeed, baseNoise).matrix;
  } else {
    // Utterly unsolvable even empty (should never happen) — emit the plain code.
    const std = QRArt.encodeStandard(URL, { version, level });
    matrix = std.matrix;
    usedMask = std.mask;
  }

  const shapeMask = new Set();
  for (const ins of kept) for (const i of ins.mods) shapeMask.add(i);

  // Final render + honest scan verification at scale 8 AND 3.
  const img8 = toned ? renderToned(matrix, shapeMask, S, funcSet, { scale: 8, quiet: 4 })
    : renderMatrix(matrix, version, { scale: 8, quiet: 4 });
  const img3 = toned ? renderToned(matrix, shapeMask, S, funcSet, { scale: 3, quiet: 4 })
    : renderMatrix(matrix, version, { scale: 3, quiet: 4 });
  const s8 = sameURL(scanRGBA(img8), URL);
  const s3 = sameURL(scanRGBA(img3), URL);
  const valid = s8 && s3;

  // Always write the PNG (best effort), even when it does not scan.
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writePNG(outPath, img8);

  // Per-block headroom via the engine's own decode (tone-agnostic).
  const v = QRArt.validate(matrix, version);
  let minHeadroom = 0;
  if (v.ok && Array.isArray(v.perBlock)) {
    minHeadroom = Math.min(...v.perBlock.map((b) => b.capacity - b.errors));
  }
  let wh = 0;
  { let t = 0, l = 0; for (let i = 0; i < S * S; i++) { if (funcSet[i]) continue; t++; if (matrix[i] === 0) l++; } wh = t ? l / t : 1; }

  const iconCounts = { cat: 0, paw: 0, qmark: 0, keyhole: 0 };
  for (const ins of kept) iconCounts[ins.type]++;

  const meta = {
    valid,
    scans: { s8, s3 },
    placed: placed.length,
    kept: kept.length,
    dropped: placed.length - kept.length,
    whiteness: Number(wh.toFixed(4)),
    minHeadroom,
    iconCounts,
    mask: usedMask,
    seed,
  };
  fs.writeFileSync(outPath + ".meta.json", JSON.stringify(meta, null, 2) + "\n");
  return { meta, perBlock: v.ok ? v.perBlock : null };
}

// ---------------------------------------------------------------------------
// glyph subcommand — an isolation preview of ONE glyph (the exact bitmap the GA
// places), centered on white at a big pixel magnification. For eyeballing that
// paw/cat read at tiny module counts; not part of the fitness path.
// ---------------------------------------------------------------------------
function renderGlyphIso(type, style, px = 16) {
  const g = glyphOf(type, 1, style); // base (scale-1) bitmap magnified px per module
  if (!g) throw new Error(`glyph: unknown type ${type}`);
  const pad = 2, gw = g.w + pad * 2, gh = g.h + pad * 2, W = gw * px, H = gh * px;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (const key of g.dark) {
    const [r, c] = key.split(",").map(Number);
    const x0 = (c + pad) * px, y0 = (r + pad) * px;
    for (let y = 0; y < px; y++)
      for (let x = 0; x < px; x++) { const o = ((y0 + y) * W + (x0 + x)) * 4; data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; }
  }
  return { data, width: W, height: H };
}

// ---------------------------------------------------------------------------
// contact subcommand. Grid contact sheet of a generation's PNGs (for judges).
// Reads each PNG, blits into a padded grid, optional labels underneath.
// ---------------------------------------------------------------------------
function miniFont() {
  return {
    A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"],
    C: ["011", "100", "100", "100", "011"], D: ["110", "101", "101", "101", "110"],
    E: ["111", "100", "110", "100", "111"], F: ["111", "100", "110", "100", "100"],
    G: ["011", "100", "101", "101", "011"], H: ["101", "101", "111", "101", "101"],
    I: ["111", "010", "010", "010", "111"], J: ["001", "001", "001", "101", "010"],
    K: ["101", "110", "100", "110", "101"], L: ["100", "100", "100", "100", "111"],
    M: ["101", "111", "111", "101", "101"], N: ["101", "111", "111", "111", "101"],
    O: ["111", "101", "101", "101", "111"], P: ["110", "101", "110", "100", "100"],
    R: ["110", "101", "110", "101", "101"], S: ["011", "100", "010", "001", "110"],
    T: ["111", "010", "010", "010", "010"], U: ["101", "101", "101", "101", "111"],
    V: ["101", "101", "101", "101", "010"], W: ["101", "101", "111", "111", "101"],
    Y: ["101", "101", "010", "010", "010"], Z: ["111", "001", "010", "100", "111"],
    "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
    "2": ["110", "001", "010", "100", "111"], "3": ["110", "001", "010", "001", "110"],
    "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "110", "001", "110"],
    "6": ["011", "100", "110", "101", "010"], "7": ["111", "001", "010", "010", "010"],
    "8": ["010", "101", "010", "101", "010"], "9": ["010", "101", "011", "001", "110"],
    "-": ["000", "000", "111", "000", "000"], "_": ["000", "000", "000", "000", "111"],
    ".": ["000", "000", "000", "000", "010"], " ": ["000", "000", "000", "000", "000"],
  };
}
function drawText(put, F, text, x0, y0, sc) {
  let x = x0;
  for (const ch of String(text).toUpperCase()) {
    const g = F[ch] || F[" "];
    for (let ry = 0; ry < 5; ry++)
      for (let rx = 0; rx < 3; rx++)
        if (g[ry][rx] === "1")
          for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) put(x + rx * sc + dx, y0 + ry * sc + dy, [20, 20, 20]);
    x += 3 * sc + sc;
  }
}
function contactSheet(pngPaths, outPath, labels) {
  const imgs = pngPaths.map((p) => { try { return readPNG(p); } catch { return null; } });
  const valid = imgs.filter(Boolean);
  if (!valid.length) throw new Error("contact: no readable PNGs");
  const cellW = Math.max(...valid.map((i) => i.width));
  const cellH = Math.max(...valid.map((i) => i.height));
  const n = imgs.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const pad = 16, labelH = labels ? 18 : 4, gap = 16;
  const W = pad * 2 + cols * cellW + (cols - 1) * gap;
  const H = pad * 2 + rows * (cellH + labelH) + (rows - 1) * gap;
  const data = new Uint8ClampedArray(W * H * 4).fill(245);
  const put = (x, y, col) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255; };
  const blit = (img, x0, y0) => { for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const s = (y * img.width + x) * 4; put(x0 + x, y0 + y, [img.data[s], img.data[s + 1], img.data[s + 2]]); } };
  const F = miniFont();
  imgs.forEach((img, k) => {
    const cr = Math.floor(k / cols), cc = k % cols;
    const x0 = pad + cc * (cellW + gap), y0 = pad + cr * (cellH + labelH + gap);
    if (img) blit(img, x0 + ((cellW - img.width) >> 1), y0);
    if (labels) drawText(put, F, labels[k] ?? `#${k}`, x0 + 2, y0 + cellH + 4, 2);
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writePNG(outPath, { data, width: W, height: H });
  return { W, H, n };
}

// ---------------------------------------------------------------------------
// CLI. Malformed input (missing file, unparseable JSON, bad usage) exits nonzero;
// a bad-but-parseable genome degrades gracefully and exits 0.
// ---------------------------------------------------------------------------
function usage() {
  process.stderr.write(
    "usage:\n" +
    "  node evolve-cat.mjs render  <genome.json> <out.png>\n" +
    "  node evolve-cat.mjs contact <a.png,b.png,...> <out.png> [labelA,labelB,...]\n" +
    "  node evolve-cat.mjs glyph   <cat|paw|qmark|keyhole> <silhouette|face|-> <out.png> [px=16]\n"
  );
}

function main() {
  const [, , cmd, arg1, arg2, arg3] = process.argv;
  if (cmd === "render") {
    if (!arg1 || !arg2) { usage(); process.exit(2); }
    let raw;
    try { raw = fs.readFileSync(arg1, "utf8"); }
    catch (e) { process.stderr.write(`render: cannot read genome ${arg1}: ${e.message}\n`); process.exit(2); }
    let genome;
    try { genome = JSON.parse(raw); }
    catch (e) { process.stderr.write(`render: genome ${arg1} is not valid JSON: ${e.message}\n`); process.exit(2); }
    if (!genome || typeof genome !== "object") { process.stderr.write("render: genome must be a JSON object\n"); process.exit(2); }
    let out;
    try { out = renderGenome(genome, path.resolve(arg2)); }
    catch (e) {
      // Last-resort graceful degradation: unexpected engine error still yields a
      // meta.json (valid:false) so the GA can score the genome, and we exit 0.
      process.stderr.write(`render: solve failed, writing valid:false meta: ${e.stack || e.message}\n`);
      const meta = {
        valid: false, scans: { s8: false, s3: false },
        placed: Array.isArray(genome.icons) ? genome.icons.length : 0, kept: 0,
        dropped: Array.isArray(genome.icons) ? genome.icons.length : 0,
        whiteness: 0, minHeadroom: 0, iconCounts: { cat: 0, paw: 0, qmark: 0, keyhole: 0 },
        mask: genome.mask === "auto" || genome.mask == null ? -1 : (Number(genome.mask) & 7),
        seed: (Number.isFinite(genome.seed) ? genome.seed : 0) >>> 0,
      };
      try { fs.mkdirSync(path.dirname(path.resolve(arg2)), { recursive: true }); fs.writeFileSync(path.resolve(arg2) + ".meta.json", JSON.stringify(meta, null, 2) + "\n"); } catch { /* ignore */ }
      process.stdout.write(JSON.stringify(meta) + "\n");
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(out.meta) + "\n");
    process.exit(0);
  } else if (cmd === "contact") {
    if (!arg1 || !arg2) { usage(); process.exit(2); }
    const pngPaths = arg1.split(",").map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
    const labels = arg3 ? arg3.split(",").map((s) => s.trim()) : null;
    try { const r = contactSheet(pngPaths, path.resolve(arg2), labels); process.stdout.write(`contact: ${r.n} cells -> ${arg2} (${r.W}x${r.H})\n`); }
    catch (e) { process.stderr.write(`contact: ${e.message}\n`); process.exit(2); }
    process.exit(0);
  } else if (cmd === "glyph") {
    const type = arg1, style = arg2, out = arg3, px = process.argv[6] ? Number(process.argv[6]) : 16;
    if ((type !== "cat" && type !== "paw" && type !== "qmark" && type !== "keyhole") || !out) { usage(); process.exit(2); }
    try {
      const img = renderGlyphIso(type, style === "face" ? "face" : "silhouette", px);
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      writePNG(path.resolve(out), img);
      process.stdout.write(`glyph: ${type}/${style} -> ${out} (${img.width}x${img.height})\n`);
    } catch (e) { process.stderr.write(`glyph: ${e.message}\n`); process.exit(2); }
    process.exit(0);
  } else {
    usage();
    process.exit(2);
  }
}

main();
