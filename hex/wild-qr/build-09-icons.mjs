// build-09-icons.mjs — Piece 9: the icon pair (the smiley 🙂 and the Cool S).
//
// Run `node build-09-icons.mjs` to regenerate out/icon-* (deterministic).
//
// Two more nearly-blank designs, built on the SAME machinery as build-08's
// geometric series (see nearly-blank-lib.mjs, copied from piece 1): the block-
// aware white-pin split (safeMask), the clean-disc technique (discCells pinned
// white at high priority so the hero sits on immaculate paper), and the
// "dashes-not-nibbles" solver (solveDashed) that sacrifices WHOLE 2-3 module
// stroke segments rather than punching single-module holes.
//
// This file is standalone — it imports the shared lib but does NOT touch
// build-08 or its out/geometric-* outputs. Everything design-specific lives here.
//
// Shared with build-08: URL https://github.com/minigolf2000/cat-games, v6-L,
// urlCase "schemehost", verified with allowSchemeHostCase (jsQR @ scale 8 + 3).
// Gates: scale 8+3 scans, headroom >=2/block, stroke >=88% overall, hero 100%,
// whiteness >=68%, clean disc/halo speckle 0.
//
// Design 1 (smiley): a radius-9 face outline, solid 2x2 eyes, a radius-5 lower
//   arc smile, on a clean disc. HERO = eyes + smile + disc speckle 0 (the face
//   ring is a supporting stroke that may dash — the eyes and smile carry the
//   identity). Nudge-search picks the face center in the controllable left.
//
// Design 2 (Cool S): the '90s graffiti "universal S" drawn stroke-by-stroke per
//   spec 09 — 6 vertical bars in two ranks, a pointed crown, a pointed bottom,
//   and two PARALLEL waist diagonals that leave two deliberate OPEN ENDS. The
//   ENTIRE glyph is hero (100% — a single break kills it); a 2-module clean
//   white halo rings the whole glyph. Nudge/shrink search hunts a 100% placement.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QRArt } from "./engine.mjs";
import { renderMatrix, writePNG } from "./png.mjs";
import { verifyMatrix } from "./verify.mjs";
import {
  line, circleOutline, arcOutline, safeMask, block0Data,
  segmentStroke, solveDashed, meterLine, haloOf,
} from "./nearly-blank-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
const URL = "https://github.com/minigolf2000/cat-games";
const VERSION = 6, LEVEL = "L";
const S = QRArt.sizeOf(VERSION); // 41
const SEGLEN = 3;               // 2-3 module segments (chunk size before merge)
const FLIP_RESTARTS = 160;      // flip-seed rotations per mask (final run)
const NOISE_RESTARTS = 400;     // noise samples to whiten the free field
const PROBE_RESTARTS = 28;      // per-placement probe restarts in the nudge search
const BASE_NOISE = 12345;

const fp = QRArt.functionPatterns(VERSION);
const funcSet = fp.func;
const inB = (r, c) => r >= 0 && c >= 0 && r < S && c < S;

// ---------------------------------------------------------------------------
// A clean disc: every non-function module within `r` of the center, innermost
// first (build-01 technique), MINUS an optional exclude set (e.g. the face-ring
// stroke, so the ring is left free to be pinned dark by the stroke pass while
// the whole interior underneath it is pinned white). Extra cells may be appended.
// ---------------------------------------------------------------------------
function discAround(cy, cx, r, { exclude = null, extra = [] } = {}) {
  const cells = [];
  for (let rr = 0; rr < S; rr++)
    for (let cc = 0; cc < S; cc++) {
      const i = rr * S + cc;
      if (funcSet[i]) continue;
      if (exclude && exclude.has(i)) continue;
      const d2 = (rr - cy) * (rr - cy) + (cc - cx) * (cc - cx);
      if (d2 <= r * r) cells.push([i, d2]);
    }
  for (const [rr, cc] of extra) {
    if (!inB(rr, cc)) continue;
    const i = rr * S + cc;
    if (funcSet[i] || (exclude && exclude.has(i))) continue;
    cells.push([i, (rr - cy) * (rr - cy) + (cc - cx) * (cc - cx)]);
  }
  const seen = new Set();
  cells.sort((a, b) => a[1] - b[1]);
  const out = [];
  for (const [i] of cells) { if (seen.has(i)) continue; seen.add(i); out.push(i); }
  return out;
}

// Collect the module indices of every drawn path (non-function, in-bounds).
function pathModules(paths) {
  const set = new Set();
  for (const p of paths)
    for (const [r, c] of p.pts) {
      if (!inB(r, c)) continue;
      const i = r * S + c;
      if (!funcSet[i]) set.add(i);
    }
  return set;
}

// ---------------------------------------------------------------------------
// Design 1 — the smiley. Face center controllable-left (nudge +-2). The face
// ring is a supporting stroke (may dash); eyes + smile are hero.
// ---------------------------------------------------------------------------
function designSmiley(center) {
  const [CY, CX] = center;
  const FACE_R = 9, SMILE_R = 5, DISC_R = 9;
  const paths = [];

  // Face: 1-module circle outline (supporting stroke → may dash to dashes).
  const ring = circleOutline(CY, CX, FACE_R);
  paths.push({ pts: ring, hero: false, prio: 1 });

  // Eyes: solid 2x2 dots in the upper third, symmetric about the center column.
  // Centers ~ (CY-4.5, CX-3.5) and (CY-4.5, CX+3.5) → e.g. default (14.5,11.5)/
  // (14.5,18.5), matching spec's ~(15,11.5)/(15,18.5).
  const eye = (er, ec) => paths.push({
    pts: [[er, ec], [er, ec + 1], [er + 1, ec], [er + 1, ec + 1]], hero: true, prio: 0,
  });
  eye(CY - 5, CX - 4); // left  eye, cols {CX-4,CX-3}
  eye(CY - 5, CX + 3); // right eye, cols {CX+3,CX+4}

  // Smile: lower part of a radius-5 circle concentric with the face, ~120°, from
  // ~8 o'clock to ~4 o'clock. In circleOutline's convention angle 0 = 3 o'clock,
  // 90 = 6 o'clock (bottom), 180 = 9 o'clock; so [30,150] is the lower arc with
  // both endpoints BELOW horizontal (no up-curl).
  const smile = arcOutline(CY, CX, SMILE_R, 30, 150);
  paths.push({ pts: smile, hero: true, prio: 0 });

  // Clean disc over the WHOLE face interior (radius 9), minus the ring cells so
  // the ring stays a dark stroke while everything under it is immaculate white.
  const ringSet = new Set(ring.map(([r, c]) => r * S + c).filter((i) => !funcSet[i]));
  return {
    name: "smiley", center, paths,
    heroTest: () => false, // hero carried by the eye/smile flags
    heroDesc: `the two 2x2 eyes + the radius-${SMILE_R} smile arc + zero-speckle disc r${DISC_R} (face center (${CY},${CX}))`,
    discCellsFn: () => discAround(CY, CX, DISC_R, { exclude: ringSet }),
    discDesc: `clean disc r${DISC_R} over the full face interior (ring excluded)`,
  };
}

// ---------------------------------------------------------------------------
// Design 2 — the Cool S. Exact stroke set from spec 09 in a local 25x13 grid
// (r,c offsets), mapped by g(lr,lc) = [row0+lr, col0+lc]. All strokes 1 module.
// `shrink` (0..2) trims each vertical's height off the WAIST side symmetrically
// (vt1 = 10-shrink, vb0 = 14+shrink) — the allowed fallback. Because both waist
// diagonals keep identical (dr,dc) deltas at every shrink, they stay exactly
// parallel and the crown/point/waist joins stay connected; only the two
// deliberate open ends (top-right vertical bottom, bottom-left vertical top)
// remain open, as the authentic glyph requires.
// ---------------------------------------------------------------------------
function designCoolS({ row0, col0, shrink = 0 }) {
  const g = (lr, lc) => [row0 + lr, col0 + lc];
  const seg = (a, b) => { const pts = []; line(a[0], a[1], b[0], b[1], (r, c) => pts.push([r, c])); return pts; };

  const vt0 = 5, vt1 = 10 - shrink;      // top-rank vertical rows
  const vb0 = 14 + shrink, vb1 = 19;     // bottom-rank vertical rows
  const apex = 0, pApex = 24;            // crown / bottom-point apex rows

  const paths = [];
  const H = (pts) => paths.push({ pts, hero: true, prio: 0 }); // ENTIRE glyph is hero

  // Crown (pointed top): (vt0,0)->(apex,6)->(vt0,12).
  H(seg(g(vt0, 0), g(apex, 6)));
  H(seg(g(apex, 6), g(vt0, 12)));
  // Top-rank verticals at cols 0, 6, 12.
  H(seg(g(vt0, 0), g(vt1, 0)));
  H(seg(g(vt0, 6), g(vt1, 6)));
  H(seg(g(vt0, 12), g(vt1, 12)));
  // Waist: two PARALLEL diagonals. (vt1,0)->(vb0,6) and (vt1,6)->(vb0,12).
  // (vt1,12) and (vb0,0) are left OPEN — do not join them.
  H(seg(g(vt1, 0), g(vb0, 6)));
  H(seg(g(vt1, 6), g(vb0, 12)));
  // Bottom-rank verticals at cols 0, 6, 12.
  H(seg(g(vb0, 0), g(vb1, 0)));
  H(seg(g(vb0, 6), g(vb1, 6)));
  H(seg(g(vb0, 12), g(vb1, 12)));
  // Bottom point: (vb1,0)->(pApex,6)->(vb1,12).
  H(seg(g(vb1, 0), g(pApex, 6)));
  H(seg(g(pApex, 6), g(vb1, 12)));

  const glyph = pathModules(paths);
  return {
    name: "cool-s", center: [row0 + 12, col0 + 6], paths,
    shrink, row0, col0,
    heroTest: () => false, // every path is flagged hero already
    heroDesc: `the ENTIRE Cool S glyph (row0 ${row0}, col0 ${col0}${shrink ? `, shrink ${shrink}` : ""}) + 2-module clean halo speckle 0`,
    // 2-module white halo band around the whole glyph (build-01 clean gate).
    discCellsFn: () => haloOf(glyph, S, funcSet, 2).filter((i) => !glyph.has(i)),
    discDesc: "2-module white halo band around the whole glyph",
  };
}

// ---------------------------------------------------------------------------
// Runner: build segments from paths, run the dashed solver, whiten, verify.
// (Mirrors build-08's path branch; neither icon design uses the blob path.)
// ---------------------------------------------------------------------------
function buildDesign(prep, design, safe, b0, restarts) {
  const claimed = new Set();
  const segments = [];
  for (const p of design.paths) {
    const segs = segmentStroke(p.pts, S, SEGLEN, claimed, funcSet);
    for (const s of segs) {
      const cr = s.mods.reduce((a, i) => a + ((i / S) | 0), 0) / s.mods.length;
      const cc = s.mods.reduce((a, i) => a + (i % S), 0) / s.mods.length;
      s.hero = p.hero || design.heroTest(cr, cc);
      s.prio = p.prio ?? 0;
      segments.push(s);
    }
  }
  const discCells = design.discCellsFn ? design.discCellsFn() : [];
  const discSet = new Set(discCells);
  const inSeg = new Set();
  for (const s of segments) for (const i of s.mods) inSeg.add(i);
  const fieldWhiteSafe = [];
  for (let i = 0; i < S * S; i++) {
    if (funcSet[i] || inSeg.has(i) || discSet.has(i) || !safe[i]) continue;
    fieldWhiteSafe.push(i);
  }
  const solved = solveDashed(prep, {
    S, segments, fieldWhiteSafe, center: design.center, funcSet, discCells,
    flipRestarts: restarts, baseNoise: BASE_NOISE,
  });
  return { segments, fieldWhiteSafe, discCells, solved };
}

// Pre-solve TARGET matrix: function patterns pre-seeded + every drawn stroke
// dark (hero and supporting). This is the ideal drawing the solver aims at.
function targetMatrix(design) {
  const m = new Uint8Array(fp.base);
  for (const p of design.paths)
    for (const [r, c] of p.pts) {
      if (!inB(r, c)) continue;
      const i = r * S + c;
      if (!funcSet[i]) m[i] = 1;
    }
  return m;
}

// Count intended HERO modules that land on FUNCTION cells. segmentStroke
// silently drops function cells, so such a placement would draw an incomplete
// hero glyph while the surviving-segment metric still reads 100% — a degenerate
// win the search must never take. Any hero-func collision disqualifies a
// placement outright (dominant negative term in the key below).
function heroFuncHits(design) {
  const hitset = new Set();
  for (const p of design.paths) {
    if (!(p.hero || design.heroTest(0, 0))) continue; // hero paths only
    if (!p.hero) continue;
    for (const [r, c] of p.pts) {
      if (!inB(r, c)) continue;
      const i = r * S + c;
      if (funcSet[i]) hitset.add(i);
    }
  }
  return hitset.size;
}

// Nudge/shrink search: probe each candidate design cheaply, keep the one that
// solves cleanest. Selection key (most → least significant): NO hero cell on a
// function pattern (a mutilated glyph is the worst outcome), then clean disc/halo
// speckle 0, then hero 100%, then stroke%, then whiteness. Returns the winner.
function chooseDesign(prep, candidates, safe, b0) {
  let bestD = candidates[0], bestKey = -Infinity, bestProbe = null;
  for (const d of candidates) {
    const hf = heroFuncHits(d);
    const { solved } = buildDesign(prep, d, safe, b0, PROBE_RESTARTS);
    if (!solved.best) continue;
    const m = solved.best.m;
    const key = -hf * 1e15 - m.discDark * 1e12 + m.heroSat * 1e9 + m.strokeSat * 1e3 + m.whiteness;
    if (key > bestKey) { bestKey = key; bestD = d; bestProbe = m; bestD._heroFuncHits = hf; }
  }
  return { design: bestD, probe: bestProbe, heroFuncHits: bestD._heroFuncHits ?? 0 };
}

// ---------------------------------------------------------------------------
// Full solve for a chosen design: search masks x flip restarts, then whiten.
// ---------------------------------------------------------------------------
function run(prep, design, safe, b0) {
  const { segments, solved } = buildDesign(prep, design, safe, b0, FLIP_RESTARTS);
  const best = solved.best;
  if (!best) throw new Error(`${design.name}: no config met headroom>=2`);

  const sacrificed = best.sacrificed;
  const io = solved.buildIO(solved.heroOrder, best.keptOuter, sacrificed);
  let bestNoise = BASE_NOISE, bestWhite = -1, bestMatrix = null, bestM = null;
  for (let n = 0; n < NOISE_RESTARTS; n++) {
    const seed = (1000 + n * 7919) >>> 0;
    const res = solved.runSolve(io, best.mask, best.flipSeed, seed);
    const m = solved.measure(res.matrix, sacrificed);
    if (m.whiteness > bestWhite) { bestWhite = m.whiteness; bestNoise = seed; bestMatrix = res.matrix; bestM = m; }
  }
  const matrix = bestMatrix, m = bestM;

  const v = verifyMatrix(matrix, VERSION, URL, { allowSchemeHostCase: true });
  const perBlock = v.perBlock;
  const minHead = Math.min(...perBlock.map((b) => b.capacity - b.errorsUsed));

  writePNG(path.join(OUT, `icon-${design.name}.png`), renderMatrix(matrix, VERSION, { scale: 8, quiet: 4 }));
  fs.writeFileSync(path.join(OUT, `icon-${design.name}.svg`), QRArt.toSVG(matrix, VERSION, { scale: 8, quiet: 4 }));

  // Where did dashes fall? Classify dropped segments by block-0(frozen) vs safe.
  const dropped = m.droppedSegs;
  let dropFrozen = 0, dropSafe = 0;
  for (const d of dropped) {
    const anyFrozen = d.mods.some((i) => b0[i]);
    if (anyFrozen) dropFrozen++; else dropSafe++;
  }
  return {
    name: design.name, matrix, m, perBlock, minHead,
    mask: best.mask, flipSeed: best.flipSeed, noiseSeed: bestNoise,
    segments, dropped, dropFrozen, dropSafe,
    heroDesc: design.heroDesc, discDesc: design.discDesc, decoded: v.validate.text,
    center: design.center, design,
    targetMatrix: targetMatrix(design),
  };
}

// ---------------------------------------------------------------------------
// Contact sheet: for BOTH designs, pre-solve TARGET next to the SOLVED result.
// Two rows (smiley, cool-s); each row is [TARGET | SOLVED], labelled.
// ---------------------------------------------------------------------------
function contactSheet(results) {
  const SCALE = 6, QUIET = 4;
  const rowsData = results.map((r) => ({
    name: r.name,
    target: renderMatrix(r.targetMatrix, VERSION, { scale: SCALE, quiet: QUIET }),
    solved: renderMatrix(r.matrix, VERSION, { scale: SCALE, quiet: QUIET }),
  }));
  const tw = rowsData[0].target.width, th = rowsData[0].target.height;
  const pad = 14, labelH = 20, gap = 16, rowGap = 22;
  const W = pad * 2 + tw * 2 + gap;
  const H = pad * 2 + rowsData.length * (th + labelH) + (rowsData.length - 1) * rowGap;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const put = (x, y, col) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
  };
  const blit = (img, x0, y0) => {
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const s = (y * img.width + x) * 4;
        put(x0 + x, y0 + y, [img.data[s], img.data[s + 1], img.data[s + 2]]);
      }
  };
  const glyphs = miniFont();
  rowsData.forEach((row, ri) => {
    const oy = pad + ri * (th + labelH + rowGap);
    drawText(put, glyphs, `${row.name} TARGET`, pad + 2, oy, 2);
    drawText(put, glyphs, `${row.name} SOLVED`, pad + tw + gap + 2, oy, 2);
    blit(row.target, pad, oy + labelH);
    blit(row.solved, pad + tw + gap, oy + labelH);
  });
  writePNG(path.join(OUT, "icons-contact.png"), { data, width: W, height: H });
}

// minimal 3x5 font for contact labels (superset of build-08's).
function miniFont() {
  return {
    A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"],
    C: ["011", "100", "100", "100", "011"], D: ["110", "101", "101", "101", "110"],
    E: ["111", "100", "110", "100", "111"], G: ["011", "100", "101", "101", "011"],
    H: ["101", "101", "111", "101", "101"], I: ["111", "010", "010", "010", "111"],
    L: ["100", "100", "100", "100", "111"], M: ["101", "111", "111", "101", "101"],
    N: ["101", "111", "111", "111", "101"], O: ["111", "101", "101", "101", "111"],
    P: ["110", "101", "110", "100", "100"], R: ["110", "101", "110", "101", "101"],
    S: ["011", "100", "010", "001", "110"], T: ["111", "010", "010", "010", "010"],
    U: ["101", "101", "101", "101", "111"], V: ["101", "101", "101", "101", "010"],
    W: ["101", "101", "111", "111", "101"], Y: ["101", "101", "010", "010", "010"],
    "-": ["000", "000", "111", "000", "000"], " ": ["000", "000", "000", "000", "000"],
  };
}
function drawText(put, F, text, x0, y0, sc) {
  let x = x0;
  for (const ch of text.toUpperCase()) {
    const g = F[ch] || F[" "];
    for (let ry = 0; ry < 5; ry++)
      for (let rx = 0; rx < 3; rx++)
        if (g[ry][rx] === "1")
          for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++)
            put(x + rx * sc + dx, y0 + ry * sc + dy, [20, 20, 20]);
    x += (3 * sc) + sc;
  }
}

function pct(x) { return (x * 100).toFixed(1) + "%"; }

// ---------------------------------------------------------------------------
function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const prep = QRArt.prepareArt(URL, VERSION, LEVEL, "schemehost");
  const safe = safeMask(prep, S);
  const b0 = block0Data(prep, S);

  // --- Smiley: nudge the face center +-2 in the controllable left. ---
  process.stderr.write("choosing smiley center...\n");
  const NUDGE = [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, 1], [-1, 1], [1, -1]];
  const smileyCands = NUDGE.map(([dy, dx]) => designSmiley([19 + dy, 15 + dx]));
  const smiley = chooseDesign(prep, smileyCands, safe, b0).design;

  // --- Cool S: nudge placement +-2, and if 100% hero is out of reach at the best
  //     placement, allow the spec's fallback of shrinking each vertical by up to 2
  //     modules. We search shrink 0 first (exact spec geometry) and escalate only
  //     if the probe can't reach 100% hero — nudge/shrink BEFORE sacrificing any
  //     stroke, exactly as the spec demands. ---
  process.stderr.write("choosing cool-s placement...\n");
  const placeNudge = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, 1], [1, -1], [-1, -1], [1, 1], [0, 2], [2, 0]];
  let coolS = null, coolBestKey = -Infinity;
  for (const shrink of [0, 1, 2]) {
    const cands = placeNudge.map(([dy, dx]) => designCoolS({ row0: 8 + dy, col0: 7 + dx, shrink }));
    const { design, probe, heroFuncHits: hf } = chooseDesign(prep, cands, safe, b0);
    process.stderr.write(`  shrink ${shrink}: placement col0 ${design.col0} row0 ${design.row0}, heroFuncHits ${hf}, probe hero ${probe ? pct(probe.heroSat) : "n/a"}, disc ${probe ? probe.discDark : "?"}\n`);
    if (probe && hf === 0 && probe.heroSat >= 0.9999 && probe.discDark === 0) { coolS = design; break; }
    // fallback: keep the best-scoring clean-placement design seen so far
    const key = probe ? (-hf * 1e15 - probe.discDark * 1e12 + probe.heroSat) : -Infinity;
    if (key > coolBestKey) { coolBestKey = key; coolS = design; }
  }

  const designs = [smiley, coolS];
  const results = [];
  for (const d of designs) {
    process.stderr.write(`solving ${d.name}...\n`);
    results.push(run(prep, d, safe, b0));
  }
  contactSheet(results);

  // ---- Report ----
  const lines = [];
  lines.push("# Piece 9 — icon pair (the smiley & the Cool S) — build report");
  lines.push("");
  lines.push("Generated by `node build-09-icons.mjs` (deterministic; re-run to regenerate).");
  lines.push("");
  lines.push("Shared: URL `" + URL + "`, v6-L, urlCase \"schemehost\", verified with");
  lines.push("`allowSchemeHostCase` (jsQR @ scale 8 + 3). All strokes 1 module wide.");
  lines.push("Gates: stroke >=88% overall AND 100% in the hero zone; whiteness >=68%;");
  lines.push("headroom >=2/block; clean disc/halo speckle 0; misses land as whole dropped");
  lines.push("2-3 module segments (dashes), never single-module holes.");
  lines.push("");
  for (const r of results) {
    const strokePass = r.m.strokeSat >= 0.88;
    const heroPass = r.m.heroSat >= 0.9999;
    const whitePass = r.m.whiteness >= 0.68;
    const headPass = r.minHead >= 2;
    const discPass = r.m.discDark === 0;
    lines.push(`## ${r.name}`);
    lines.push("");
    lines.push(`- Hero zone: ${r.heroDesc}`);
    if (r.name === "cool-s") lines.push(`- Placement chosen by nudge/shrink search: row0 ${r.design.row0}, col0 ${r.design.col0}, shrink ${r.design.shrink} (verticals at cols ${r.design.col0}, ${r.design.col0 + 6}, ${r.design.col0 + 12}; timing col 6 avoided)`);
    else lines.push(`- Placement chosen by nudge search: face center ${JSON.stringify(r.center)}`);
    lines.push(`- Mask **${r.mask}**, flipSeed ${r.flipSeed}, noiseSeed ${r.noiseSeed} (search: 8 masks x ${FLIP_RESTARTS} flip restarts, then ${NOISE_RESTARTS} noise samples)`);
    lines.push(`- Stroke satisfaction (overall): **${r.m.strokeSatN}/${r.m.strokeTot} = ${pct(r.m.strokeSat)}** ${strokePass ? "PASS" : "**below 88% — see dashes**"}`);
    lines.push(`- Hero-zone satisfaction: **${r.m.heroSatN}/${r.m.heroTot} = ${pct(r.m.heroSat)}** ${heroPass ? "PASS (100%)" : "**FAIL — not 100%**"}`);
    lines.push(`- Whiteness (non-function light): **${pct(r.m.whiteness)}** (${r.m.nfLight}/${r.m.nfTot}); need >=68%: ${whitePass ? "PASS" : "**FAIL**"}`);
    const discLabel = r.name === "cool-s" ? "Clean halo" : "Clean disc";
    lines.push(`- ${discLabel} (${r.discDesc}): **${r.m.discDark} speckle** of ${r.m.discTot} cells ${discPass ? "— **PASS (immaculate)**" : "— **FAIL**"}`);
    lines.push(`- Per-block meter:`);
    lines.push(`  ${meterLine(r.perBlock)}`);
    lines.push(`  min headroom = ${r.minHead} (need >=2): ${headPass ? "PASS" : "**FAIL**"}`);
    lines.push(`- Dashes (budget-driven): ${r.dropped.length} segment(s) dropped — ${r.dropFrozen} touching frozen block-0 (URL) cells, ${r.dropSafe} elsewhere.` +
      (r.m.gapDark ? ` Gap strays (dark inside a dropped gap): ${r.m.gapDark}/${r.m.gapTot}.` : ` No stray darks inside dropped gaps.`));
    if (r.dropped.length) {
      const where = r.dropped.slice(0, 8).map((d) => {
        const cr = Math.round(d.mods.reduce((a, i) => a + ((i / S) | 0), 0) / d.mods.length);
        const cc = Math.round(d.mods.reduce((a, i) => a + (i % S), 0) / d.mods.length);
        return `(${cr},${cc})x${d.len}`;
      }).join(", ");
      lines.push(`  dropped-segment centroids: ${where}${r.dropped.length > 8 ? ", …" : ""}`);
    }
    lines.push(`- Decoded (case remix, same URL): \`${r.decoded}\``);
    lines.push(`- Files: out/icon-${r.name}.png, out/icon-${r.name}.svg`);
    lines.push("");
  }
  lines.push("## Contact sheet");
  lines.push("- out/icons-contact.png — each design's PRE-SOLVE target next to its SOLVED result.");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- **Smiley** — the face RING is a supporting stroke (may dash into an intentional");
  lines.push("  dash rhythm); the two solid 2x2 eyes and the radius-5 lower-arc smile are HERO");
  lines.push("  (100%) and sit on a build-01 clean disc (speckle 0). The smile spans ~120°");
  lines.push("  (8 o'clock → 4 o'clock) with both ends below horizontal — no up-curl.");
  lines.push("- **Cool S** — the '90s universal S, drawn stroke-by-stroke per spec 09: six");
  lines.push("  vertical bars in two ranks, a pointed crown and pointed bottom, and two");
  lines.push("  PARALLEL waist diagonals (identical dr/dc deltas → identical Bresenham");
  lines.push("  staircases) that leave the two characteristic OPEN ENDS (top-right vertical");
  lines.push("  bottom + bottom-left vertical top — never joined). The ENTIRE glyph is hero");
  lines.push("  (a single break kills the icon); a 2-module clean white halo rings it. The");
  lines.push("  verticals are placed off the timing column (col 6).");
  const report = lines.join("\n");
  fs.writeFileSync(path.join(OUT, "icons-report.md"), report);
  console.log(report);
}

main();
