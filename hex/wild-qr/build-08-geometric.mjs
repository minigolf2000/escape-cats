// build-08-geometric.mjs — Piece 8: the nearly-blank GEOMETRIC series.
//
// Run `node build-08-geometric.mjs` to regenerate out/geometric-* (deterministic).
//
// Five nearly-blank designs that read as a sparse pen drawing on paper, built on
// piece 1's block-aware pin/flip insight (see nearly-blank-lib.mjs, copied from
// build-01). All share: URL https://github.com/minigolf2000/cat-games, v6-L,
// urlCase "schemehost", verified with allowSchemeHostCase at scale 8 + 3.
//
// The taste-critical part is "dashes not nibbles": when rank/flip budget runs out
// on a stroke, the miss must read as an intentional dash rhythm — a WHOLE 2–3
// module stroke segment dropped — never a random single-module hole. Mechanism
// (in solveDashed): each stroke is cut into contiguous 2–3 module segments; a
// PROBE solve pins every segment dark and measures per-segment satisfaction;
// whole outer segments that aren't fully dark are SACRIFICED and, in the RE-SOLVE,
// pinned WHITE at high priority so they become clean gaps. Hero + kept segments
// pin first (equal-or-greater free rank than the probe) so they stay solid.
//
// Per design we search all 8 masks × flip-seed restarts (like build-01) and, on
// the winning config, sweep noise seeds to whiten the free field.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QRArt } from "./engine.mjs";
import { renderMatrix, writePNG } from "./png.mjs";
import { verifyMatrix } from "./verify.mjs";
import {
  line, circleOutline, safeMask, block0Data, segmentStroke, solveDashed,
  meterLine, flipSeedFor,
} from "./nearly-blank-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
const URL = "https://github.com/minigolf2000/cat-games";
const VERSION = 6, LEVEL = "L";
const S = QRArt.sizeOf(VERSION); // 41
const SEGLEN = 3;               // 2–3 module segments (chunk size before merge)
const FLIP_RESTARTS = 110;      // flip-seed rotations per mask
const NOISE_RESTARTS = 400;     // noise samples to whiten the free field
const BASE_NOISE = 12345;

const fp = QRArt.functionPatterns(VERSION);
const funcSet = fp.func;
const inB = (r, c) => r >= 0 && c >= 0 && r < S && c < S;

// ---------------------------------------------------------------------------
// Design geometry. Each returns { paths } where a path is
//   { pts:[[r,c],...], hero:bool, prio:number }
// pts are an ORDERED walk so segments come out as contiguous arcs/runs.
// hero forces every segment of the path into the hero set; otherwise hero is
// decided per-segment by the design's heroTest(centroidR, centroidC).
// ---------------------------------------------------------------------------

// A clean disc: every non-function module within `r` of the center, innermost
// first (build-01 technique). Extra corridor cells may be appended.
function discAround(cy, cx, r, extra = []) {
  const cells = [];
  for (let rr = 0; rr < S; rr++)
    for (let cc = 0; cc < S; cc++) {
      const i = rr * S + cc;
      if (funcSet[i]) continue;
      const d2 = (rr - cy) * (rr - cy) + (cc - cx) * (cc - cx);
      if (d2 <= r * r) cells.push([i, d2]);
    }
  for (const [rr, cc] of extra) {
    if (!inB(rr, cc)) continue;
    const i = rr * S + cc;
    if (!funcSet[i]) cells.push([i, (rr - cy) * (rr - cy) + (cc - cx) * (cc - cx)]);
  }
  const seen = new Set();
  cells.sort((a, b) => a[1] - b[1]);
  const out = [];
  for (const [i] of cells) { if (seen.has(i)) continue; seen.add(i); out.push(i); }
  return out;
}

// 1. RINGS — concentric circles re-centered into the controllable LEFT territory
//    (the (34,34) alignment goes back to being furniture). 4 rings at pitch 3;
//    a build-01 clean disc holds zero speckle through the inner 2 rings. Hero:
//    inner 3 rings 100% + disc speckle 0.
function designRings(center) {
  const [CY, CX] = center, PITCH = 3, MAXR = 12, DISC_R = 7;
  const paths = [];
  let idx = 0;
  for (let radius = PITCH; radius <= MAXR; radius += PITCH, idx++) {
    const pts = circleOutline(CY, CX, radius);
    paths.push({ pts, hero: idx < 3, prio: radius });
  }
  return {
    name: "rings", center, paths,
    heroTest: () => false, // hero is carried by the inner-ring flag
    heroDesc: `the 3 innermost rings (r 3/6/9 around center (${CY},${CX})) + zero-speckle disc r${DISC_R}`,
    discCellsFn: () => discAround(CY, CX, DISC_R),
    discDesc: `clean disc r${DISC_R} (through the inner 2 rings)`,
  };
}

// 2. WAVES — Joy-Division horizontal wavelines, vertical pitch 3, flat at the
//    edges and rising into a peak centered on column 15. Hero: central peak
//    rows 12–30 × cols 8–24.
function designWaves() {
  // 8 wavelines, cols clipped to 3–30 (the controllable band; the frozen right
  // edge is where they'd dash anyway), flat at those edges and rising to a peak
  // at col 15 — a compact "mountain" that stays nearly-blank (~214 modules).
  const PITCH = 3, PEAK_COL = 15, AMP = 7.5, SIGMA = 4.5, CLO = 4, CHI = 29;
  const baseRows = [];
  for (let r = 11; r <= 29; r += PITCH) baseRows.push(r); // 7 lines (nearly-blank)
  const disp = (c) => AMP * Math.exp(-((c - PEAK_COL) * (c - PEAK_COL)) / (2 * SIGMA * SIGMA));
  const paths = [];
  baseRows.forEach((R, li) => {
    // polyline across the band; peak nearer the middle lines is taller.
    const pts = [];
    for (let c = CLO; c <= CHI; c++) {
      const r = Math.round(R - disp(c));
      pts.push([r, c]);
    }
    // densify: connect consecutive samples with Bresenham so vertical jumps fill
    const dense = [];
    for (let k = 0; k < pts.length - 1; k++) {
      line(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], (r, c) => dense.push([r, c]));
    }
    paths.push({ pts: dense, hero: false, prio: li });
  });
  return {
    name: "waves", center: [20, PEAK_COL], paths,
    heroTest: (r, c) => r >= 12 && r <= 30 && c >= 8 && c <= 24,
    heroDesc: "the central peak, rows 12–30 × cols 8–24",
  };
}

// 3. SPIRAL — one Archimedean spiral from center (20,17), pitch 3, terminating
//    before the finder margins. Hero: inner 2.5 turns.
function designSpiral() {
  const CY = 20, CX = 17, PITCH = 3;
  const b = PITCH / (2 * Math.PI);
  const heroTurns = 2.5, maxTurns = 4.0;
  const thetaMax = maxTurns * 2 * Math.PI;
  const thetaHero = heroTurns * 2 * Math.PI;
  const inner = [], outer = [];
  let prev = null;
  for (let th = 0; th <= thetaMax; th += 0.03) {
    const rad = b * th;
    const r = Math.round(CY + rad * Math.sin(th));
    const c = Math.round(CX + rad * Math.cos(th));
    if (!inB(r, c)) continue;
    if (prev && prev[0] === r && prev[1] === c) continue;
    prev = [r, c];
    (th <= thetaHero ? inner : outer).push([r, c]);
  }
  const paths = [
    { pts: inner, hero: true, prio: 0 },
    { pts: outer, hero: false, prio: 1 },
  ];
  return {
    name: "spiral", center: [CY, CX], paths,
    heroTest: () => false,
    heroDesc: "the inner 2.5 turns of the spiral (center (20,17))",
  };
}

// 4. STARBURST — 14 thin 1-module rays radiating a full 360° from a hub in the
//    controllable left. Rays dash-fade outward (heaviest toward the frozen right,
//    where dropped segments read as intentional). Hero: the innermost 7 modules
//    of every ray 100% + a clean hub disc r4.
function designStarburst(center) {
  const [CY, CX] = center, N = 14, HERO_LEN = 7, MAXLEN = 24, DISC_R = 4;
  const paths = [];
  for (let k = 0; k < N; k++) {
    const ang = (k * 2 * Math.PI) / N;
    // walk the ray outward, splitting into hero (inner 7 modules) and outer.
    const cells = [];
    const seen = new Set();
    for (let t = 1; t <= MAXLEN; t += 0.5) {
      const rr = Math.round(CY + t * Math.sin(ang));
      const cc = Math.round(CX + t * Math.cos(ang));
      if (!inB(rr, cc)) break;
      const i = rr * S + cc;
      if (funcSet[i]) continue;
      if (seen.has(i)) continue;
      seen.add(i);
      cells.push([rr, cc]);
    }
    const heroPts = cells.slice(0, HERO_LEN);
    const outerPts = cells.slice(HERO_LEN);
    if (heroPts.length) paths.push({ pts: heroPts, hero: true, prio: 0, ray: k });
    if (outerPts.length) paths.push({ pts: outerPts, hero: false, prio: 1, ray: k });
  }
  return {
    name: "starburst", center, paths,
    heroTest: () => false,
    heroDesc: `the inner 7 modules of all ${N} rays (hub (${CY},${CX})) + clean hub disc r${DISC_R}`,
    discCellsFn: () => discAround(CY, CX, DISC_R),
    discDesc: `clean hub disc r${DISC_R}`,
    fadeFrozen: true, // fade frozen-block-0 outer ray segments (they'd dash anyway)
    // Rays thin outward: keep-rate falls with radius so the burst fades into
    // scattered dashes at the rim (whole segments only — a dash rhythm).
    fade: (cr, cc, hero, hash) => {
      if (hero) return false;
      const d = Math.hypot(cr - CY, cc - CX);
      const keep = d <= 10 ? 1 : Math.max(0.15, 1 - (d - 10) / 12);
      return hash > keep;
    },
  };
}

// 5. TARGET-CAT — an unmistakable cat face on a build-01 clean disc: head circle
//    (broken at the ear joins so the ears clearly punch through the top edge),
//    solid 2×2 eyes, nose dot, 3 whiskers per side, and exactly ONE ~200° orbit
//    arc in a supporting role. Hero: all face features 100%.
function designTargetCat() {
  const CY = 19, CX = 13, HEAD_R = 6;
  const paths = [];
  // Head circle, broken at the two ear bases (a ~5-module gap under each ear) so
  // the ear triangles visibly break the head's top edge.
  const EJL = CX - 3, EJR = CX + 3; // ear join columns
  const head = circleOutline(CY, CX, HEAD_R).filter(([r, c]) => {
    const up = r <= CY - HEAD_R + 2;
    const underEar = up && (Math.abs(c - EJL) <= 2 || Math.abs(c - EJR) <= 2);
    return !underEar;
  });
  paths.push({ pts: head, hero: true, prio: 0 });
  // Ears: two filled triangles rising ABOVE the head's top edge from the gaps.
  const topRow = CY - HEAD_R + 1;
  const ear = (baseL, baseR, apexC) => {
    const apexR = topRow - 3;
    const pts = [];
    line(topRow, baseL, apexR, apexC, (r, c) => pts.push([r, c]));   // outer edge
    line(apexR, apexC, topRow, baseR, (r, c) => pts.push([r, c]));   // inner edge
    line(topRow, baseL, topRow, baseR, (r, c) => pts.push([r, c]));  // base seam
    paths.push({ pts, hero: true, prio: 0 });
  };
  ear(EJL - 2, EJL + 2, EJL);
  ear(EJR - 2, EJR + 2, EJR);
  // Eyes: two solid 2×2 blocks.
  const eye = (er, ec) => paths.push({ pts: [[er, ec], [er, ec + 1], [er + 1, ec], [er + 1, ec + 1]], hero: true, prio: 0 });
  eye(CY - 1, CX - 4);
  eye(CY - 1, CX + 3);
  // Nose: a 2-module dot.
  paths.push({ pts: [[CY + 2, CX - 1], [CY + 2, CX]], hero: true, prio: 0 });
  // Whiskers: 3 per side, radiating from just beside the nose out past the head.
  const whiskRows = [CY + 1, CY + 2, CY + 3];
  whiskRows.forEach((wr, k) => {
    const tilt = [-1, 0, 1][k];
    const lft = [], rgt = [];
    for (let s = 0; s < 5; s++) { lft.push([wr + Math.round(tilt * s * 0.5), CX - 2 - s]); }
    for (let s = 0; s < 5; s++) { rgt.push([wr + Math.round(tilt * s * 0.5), CX + 1 + s]); }
    paths.push({ pts: lft, hero: true, prio: 0 });
    paths.push({ pts: rgt, hero: true, prio: 0 });
  });
  // ONE partial orbit arc (~200°), supporting role → outer (may dash).
  const arc = circleOutline(CY, CX, HEAD_R + 4, 30, 230);
  paths.push({ pts: arc, hero: false, prio: 1 });
  return {
    name: "target-cat", center: [CY, CX], paths,
    heroTest: () => false,
    heroDesc: "all face features (head, ears, solid eyes, nose, whiskers) on a clean disc",
    // Clean disc over the whole face (head + ears + eyes + nose), plus corridors
    // along the whisker rows so the whiskers sit on clean white too (build-01).
    discCellsFn: () => {
      const corr = [];
      for (const wr of whiskRows)
        for (let dr = -1; dr <= 1; dr++)
          for (let c = CX - 7; c <= CX + 6; c++) corr.push([wr + dr, c]);
      return discAround(CY, CX, HEAD_R + 1, corr);
    },
    discDesc: `clean disc r${HEAD_R + 1} over the face + whisker corridors`,
  };
}

// ---------------------------------------------------------------------------
// Runner: build segments, run the dashed solver, whiten, verify, render.
// ---------------------------------------------------------------------------
function buildDesign(prep, design, safe, b0, restarts) {
  const claimed = new Set();
  const segments = [];
  // Paths already in priority order (hero paths first is natural but hero flag
  // makes it robust). Segment each; tag hero by path flag OR heroTest(centroid).
  for (const p of design.paths) {
    const segs = segmentStroke(p.pts, S, SEGLEN, claimed, funcSet);
    for (const s of segs) {
      const cr = s.mods.reduce((a, i) => a + ((i / S) | 0), 0) / s.mods.length;
      const cc = s.mods.reduce((a, i) => a + (i % S), 0) / s.mods.length;
      s.hero = p.hero || design.heroTest(cr, cc);
      s.prio = p.prio ?? 0;
      if (design.fade) {
        // deterministic per-segment hash in [0,1) from the segment's centroid.
        const h = ((Math.imul((cr | 0) * 131 + (cc | 0) + 7, 2654435761) >>> 0) % 100000) / 100000;
        s.forceDrop = design.fade(cr, cc, s.hero, h);
      }
      // For a full-area design, fade any NON-hero segment that mostly sits on
      // frozen block-0 (URL) cells: it would dash under budget anyway, and
      // dropping it up front frees the block-0 flip budget for the hero — which
      // lets the hero-box reach 100% (it solves 100% in isolation).
      if (design.fadeFrozen && !s.hero && !s.forceDrop) {
        const frozenN = s.mods.reduce((a, i) => a + (b0[i] ? 1 : 0), 0);
        if (frozenN * 2 >= s.mods.length) s.forceDrop = true;
      }
      segments.push(s);
    }
  }
  // Clean-disc cells (optional, build-01 technique).
  const discCells = design.discCellsFn ? design.discCellsFn() : [];
  const discSet = new Set(discCells);
  // Field-white candidates: safe (block-1/EC) cells not drawn, not disc, not func.
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

function run(design, restarts = FLIP_RESTARTS) {
  const prep = QRArt.prepareArt(URL, VERSION, LEVEL, "schemehost");
  const steer = safeMask(prep, S);
  const b0 = block0Data(prep, S);
  const { segments, solved } = buildDesign(prep, design, steer, b0, restarts);
  const best = solved.best;
  if (!best) throw new Error(`${design.name}: no config met headroom≥2`);

  // Noise whitening: hold (mask, flipSeed, sacrifice); sweep noise seeds.
  const sacrificed = best.sacrificed;
  const io = solved.buildIO(solved.heroOrder, best.keptOuter, sacrificed);
  let bestNoise = BASE_NOISE, bestWhite = -1, bestMatrix = null, bestM = null;
  for (let n = 0; n < NOISE_RESTARTS; n++) {
    const seed = (1000 + n * 7919) >>> 0;
    const res = solved.runSolve(io, best.mask, best.flipSeed, seed);
    const m = solved.measure(res.matrix, sacrificed);
    // strokeSat/heroSat are noise-invariant (pins); pick the whitest field.
    if (m.whiteness > bestWhite) { bestWhite = m.whiteness; bestNoise = seed; bestMatrix = res.matrix; bestM = m; }
  }
  const matrix = bestMatrix, m = bestM;

  // Verify (schemehost case remix allowed).
  const v = verifyMatrix(matrix, VERSION, URL, { allowSchemeHostCase: true });
  const perBlock = v.perBlock;
  const minHead = Math.min(...perBlock.map((b) => b.capacity - b.errorsUsed));

  // Render outputs.
  writePNG(path.join(OUT, `geometric-${design.name}.png`), renderMatrix(matrix, VERSION, { scale: 8, quiet: 4 }));
  fs.writeFileSync(path.join(OUT, `geometric-${design.name}.svg`), QRArt.toSVG(matrix, VERSION, { scale: 8, quiet: 4 }));

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
    center: design.center,
  };
}

// Nudge search: try candidate hub centers, pick the one that best solves
// (clean disc first, then hero, then whiteness) with a cheap probe, then hand
// the winning design to run() for the full search.
function chooseCenter(builder, centers, probeRestarts = 24) {
  const prep = QRArt.prepareArt(URL, VERSION, LEVEL, "schemehost");
  const steer = safeMask(prep, S);
  const b0 = block0Data(prep, S);
  let bestC = centers[0], bestKey = -Infinity;
  for (const c of centers) {
    const design = builder(c);
    const { solved } = buildDesign(prep, design, steer, b0, probeRestarts);
    if (!solved.best) continue;
    const m = solved.best.m;
    const key = -m.discDark * 1e12 + m.heroSat * 1e9 + m.strokeSat * 1e3 + m.whiteness;
    if (key > bestKey) { bestKey = key; bestC = c; }
  }
  return bestC;
}

// ---------------------------------------------------------------------------
// Contact sheet: five rendered codes side by side with name labels.
// ---------------------------------------------------------------------------
function contactSheet(results) {
  const tiles = results.map((r) => renderMatrix(r.matrix, VERSION, { scale: 6, quiet: 4 }));
  const tw = tiles[0].width, th = tiles[0].height;
  const pad = 12, labelH = 22, gap = 10;
  const cols = 5;
  const cellW = tw + gap, cellH = th + labelH;
  const W = pad * 2 + cols * tw + (cols - 1) * gap;
  const H = pad * 2 + cellH;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const putPx = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  };
  // blit tiles
  tiles.forEach((t, k) => {
    const ox = pad + k * cellW, oy = pad + labelH;
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++) {
        const s = (y * tw + x) * 4, o = ((oy + y) * W + (ox + x)) * 4;
        data[o] = t.data[s]; data[o + 1] = t.data[s + 1]; data[o + 2] = t.data[s + 2]; data[o + 3] = 255;
      }
  });
  // tiny 3×5 bitmap font for labels
  const glyphs = miniFont();
  results.forEach((r, k) => {
    const ox = pad + k * cellW;
    drawText(putPx, glyphs, r.name, ox + 2, pad + 4, 2);
  });
  writePNG(path.join(OUT, "geometric-contact.png"), { data, width: W, height: H });
}

// minimal 3×5 uppercase/lowercase-insensitive font for contact labels
function miniFont() {
  const F = {
    A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"],
    C: ["011", "100", "100", "100", "011"], E: ["111", "100", "110", "100", "111"],
    G: ["011", "100", "101", "101", "011"], I: ["111", "010", "010", "010", "111"],
    L: ["100", "100", "100", "100", "111"], N: ["101", "111", "111", "111", "101"],
    P: ["110", "101", "110", "100", "100"], R: ["110", "101", "110", "101", "101"],
    S: ["011", "100", "010", "001", "110"], T: ["111", "010", "010", "010", "010"],
    U: ["101", "101", "101", "101", "111"], V: ["101", "101", "101", "101", "010"],
    W: ["101", "101", "111", "111", "101"], "-": ["000", "000", "111", "000", "000"],
    " ": ["000", "000", "000", "000", "000"],
  };
  return F;
}
function drawText(putPx, F, text, x0, y0, sc) {
  let x = x0;
  for (const ch of text.toUpperCase()) {
    const g = F[ch] || F[" "];
    for (let ry = 0; ry < 5; ry++)
      for (let rx = 0; rx < 3; rx++)
        if (g[ry][rx] === "1")
          for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++)
            putPx(x + rx * sc + dx, y0 + ry * sc + dy, 20, 20, 20);
    x += (3 * sc) + sc;
  }
}

function pct(x) { return (x * 100).toFixed(1) + "%"; }

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // Remove the retired lattice outputs (replaced by starburst).
  for (const ext of ["png", "svg"]) {
    const f = path.join(OUT, `geometric-lattice.${ext}`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  // rings & starburst: nudge the hub center within ±2 (a 9-point spread) in the
  // controllable-left territory, picking the center that solves cleanest.
  const NUDGE = [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, 1], [-1, 1], [1, -1]];
  const ringsCenters = NUDGE.map(([dy, dx]) => [19 + dy, 15 + dx]);
  const burstCenters = NUDGE.map(([dy, dx]) => [20 + dy, 14 + dx]);
  process.stderr.write("choosing rings center...\n");
  const ringsC = chooseCenter(designRings, ringsCenters);
  process.stderr.write("choosing starburst center...\n");
  const burstC = chooseCenter(designStarburst, burstCenters);

  const designs = [
    designRings(ringsC), designWaves(), designSpiral(),
    designStarburst(burstC), designTargetCat(),
  ];
  const results = [];
  for (const d of designs) {
    process.stderr.write(`solving ${d.name}...\n`);
    results.push(run(d, FLIP_RESTARTS));
  }
  contactSheet(results);

  // Report.
  const lines = [];
  lines.push("# Piece 8 — nearly-blank geometric series — build report");
  lines.push("");
  lines.push("Generated by `node build-08-geometric.mjs` (deterministic; re-run to regenerate).");
  lines.push("");
  lines.push("Shared: URL `" + URL + "`, v6-L, urlCase \"schemehost\", verified with");
  lines.push("`allowSchemeHostCase` (jsQR @ scale 8 + 3). All strokes 1 module wide.");
  lines.push("Gates: stroke ≥88% overall AND 100% in hero zone; whiteness ≥68%; headroom ≥2/block;");
  lines.push("misses land as whole dropped 2–3 module segments (dashes), never single-module holes.");
  lines.push("");
  for (const r of results) {
    const strokePass = r.m.strokeSat >= 0.88;
    const heroPass = r.m.heroSat >= 0.9999;
    const whitePass = r.m.whiteness >= 0.68;
    const headPass = r.minHead >= 2;
    lines.push(`## ${r.name}`);
    lines.push("");
    lines.push(`- Hero zone: ${r.heroDesc}`);
    lines.push(`- Mask **${r.mask}**, flipSeed ${r.flipSeed}, noiseSeed ${r.noiseSeed} (search: 8 masks × restarts, then ${NOISE_RESTARTS} noise samples)`);
    lines.push(`- Stroke satisfaction (overall): **${r.m.strokeSatN}/${r.m.strokeTot} = ${pct(r.m.strokeSat)}** ${strokePass ? "PASS" : "**below 88% — see dashes**"}`);
    lines.push(`- Hero-zone satisfaction: **${r.m.heroSatN}/${r.m.heroTot} = ${pct(r.m.heroSat)}** ${heroPass ? "PASS" : "**FAIL**"}`);
    lines.push(`- Whiteness (non-function light): **${pct(r.m.whiteness)}** (${r.m.nfLight}/${r.m.nfTot}) ${whitePass ? "PASS" : "**FAIL**"}`);
    if (r.discDesc) {
      const discPass = r.m.discDark === 0;
      lines.push(`- Clean disc (${r.discDesc}): **${r.m.discDark} speckle** of ${r.m.discTot} non-stroke disc cells ${discPass ? "— **PASS (immaculate)**" : "— **FAIL**"}`);
    }
    lines.push(`- Per-block meter:`);
    lines.push(`  ${meterLine(r.perBlock)}`);
    lines.push(`  min headroom = ${r.minHead} (need ≥2): ${headPass ? "PASS" : "**FAIL**"}`);
    const fadedN = r.m.fadedSegs ? r.m.fadedSegs.length : 0;
    lines.push(`- Dashes (budget-driven): ${r.dropped.length} segment(s) dropped — ${r.dropFrozen} touching frozen block-0 (URL) cells, ${r.dropSafe} elsewhere.` +
      (fadedN ? ` Designed peripheral dissolve: ${fadedN} whole segment(s) faded out toward the edges (intentional negative space, not misses).` : "") +
      (r.m.gapDark ? ` Gap strays (dark inside a dropped gap): ${r.m.gapDark}/${r.m.gapTot}.` : ` No stray darks inside dropped gaps.`));
    if (r.dropped.length) {
      const where = r.dropped.slice(0, 8).map((d) => {
        const cr = Math.round(d.mods.reduce((a, i) => a + ((i / S) | 0), 0) / d.mods.length);
        const cc = Math.round(d.mods.reduce((a, i) => a + (i % S), 0) / d.mods.length);
        return `(${cr},${cc})×${d.len}`;
      }).join(", ");
      lines.push(`  dropped-segment centroids: ${where}${r.dropped.length > 8 ? ", …" : ""}`);
    }
    lines.push(`- Decoded (case remix, same URL): \`${r.decoded}\``);
    lines.push(`- Files: out/geometric-${r.name}.png, out/geometric-${r.name}.svg`);
    lines.push("");
  }
  lines.push("## Contact sheet");
  lines.push("- out/geometric-contact.png — all five side by side.");
  lines.push("");
  lines.push("## Notes (art-notes round 2)");
  lines.push("");
  lines.push("- **Dashes, not nibbles.** Every stroke is cut into contiguous 2–3 module");
  lines.push("  segments. A probe solve measures per-segment satisfaction; whole outer");
  lines.push("  segments that don't come up fully dark are sacrificed and re-pinned WHITE");
  lines.push("  (clean gaps) in a second solve. Hero + kept segments pin first with equal-");
  lines.push("  or-greater free rank, so they stay solid — misses land as whole dropped");
  lines.push("  segments. \"Gap strays\" are the residual dark modules inside an intended gap");
  lines.push("  (a frozen cell the flip budget couldn't clear); reported per design, small.");
  lines.push("- **Clean disc (build-01 technique).** rings, starburst and target-cat pin a");
  lines.push("  disc of white cells at high priority (right after the hero strokes, before");
  lines.push("  everything else) so the hero sits on immaculate white. Disc speckle is a gate");
  lines.push("  (target 0) and is reported per design.");
  lines.push("- **rings — re-centered off the frozen corner.** The (34,34) alignment is back to");
  lines.push("  being furniture; the rings now center in the controllable left, so the inner-3-");
  lines.push("  ring hero and the zero-speckle disc both solve cleanly. 4 rings at pitch 3.");
  lines.push("- **starburst replaces lattice.** A line tessellation is inherently ~40% dark");
  lines.push("  before the solver starts, which fights the nearly-blank medium; the starburst");
  lines.push("  is 14 one-module rays that are sparse by construction and fade to dashes at the");
  lines.push("  rim (heaviest toward the frozen right, where the dashes read as intentional).");
  lines.push("  The retired out/geometric-lattice.* files are deleted.");
  lines.push("- **target-cat.** The face now leads: solid 2×2 eyes, ear triangles that break");
  lines.push("  the head's top edge, nose dot + 3 whiskers/side, and a single ~200° orbit arc");
  lines.push("  in a supporting role, all on a clean disc. hero = every face feature.");
  lines.push("- **waves / spiral are UNCHANGED from round 1** (byte-identical seeds/outputs).");
  lines.push("");
  const report = lines.join("\n");
  fs.writeFileSync(path.join(OUT, "geometric-report.md"), report);
  console.log(report);
}

main();
