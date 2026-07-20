// build-01-nearly-blank.mjs — Piece 1: "the nearly-blank code".
//
// A mostly-white sheet with a thin, line-drawn cat face + the three finder
// squares, that still scans. Run `node build-01-nearly-blank.mjs` to regenerate
// everything in out/ (fully deterministic).
//
// Strategy (specs/01-nearly-blank.md):
//   1. Pin all black strokes (highest priority).
//   2. Pin a 2-module white halo around every stroke ("drawn on paper").
//   3. Pin the WHOLE remaining field white, spiralling outward from the face
//      centre — so when solver rank runs out, the forced/unsatisfied modules
//      (speckle) land at the symbol margins, reading as paper grain, not face
//      damage.
// The engine's flip pass then erases residual dark speckle (near-face first via
// the seq tie-break), keeping >=2 codewords of headroom per block.
//
// Search: all 8 masks x 200 restarts (flip-seed rotations), scored by weighted
// satisfied pins (halo > field) + a whiteness bonus on the inner 29x29. Levels
// L and M are both solved and compared; L wins (it maximises solver rank, which
// is what a white-field piece needs). urlCase "schemehost" gives the solver the
// case bits inside the frozen URL region; verification allows the RFC-3986 case
// remix.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QRArt } from "./engine.mjs";
import { renderMatrix, writePNG } from "./png.mjs";
import { verifyMatrix } from "./verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
const URL = "https://github.com/minigolf2000/cat-games";
const VERSION = 6;
const S = QRArt.sizeOf(VERSION); // 41
const RESTARTS = 200;             // >=48 per spec; more restarts = better speckle redistribution
const NOISE_SEED = 999;          // freeDim is 0 for a full-field pin, so the
                                 // noise seed is inert; fixed for determinism.

// ---------------------------------------------------------------------------
// Face geometry (row, col). Procedural, centred slightly left-of-center. The
// head clears the v6 alignment pattern at (34,34), which stays as furniture.
// The head arc opens at the ear joins and at the chin; the right whiskers reach
// a little further than the left, keeping the signature whiskers legible while
// spending fewer "expensive" dark modules in the clean left field.
// ---------------------------------------------------------------------------
const G = {
  CY: 19, CX: 18,     // face centre (row, col)
  HEAD_R: 9,          // head radius (~18-module diameter, within spec's +-2)
  EAR_H: 4,           // ear height
  EYE_ROW: 16,        // eye line
  EYE_DX: 4,          // eyes ~2*EYE_DX apart
  NOSE_ROW: 19,
  MOUTH_ROW: 21,
  WHISK_L: 4,         // left whisker length (modules)
  WHISK_R: 6,         // right whisker length
  HALO: 2,            // white halo thickness (Chebyshev)
  CHIN_GAP: 70,       // degrees of open chin at the bottom of the head arc
};

// Bresenham line into a sink(r,c).
function line(r0, c0, r1, c1, sink) {
  let dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
  let sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
  let err = dr - dc, r = r0, c = c0;
  for (;;) {
    sink(r, c);
    if (r === r1 && c === c1) break;
    const e2 = 2 * err;
    if (e2 > -dc) { err -= dc; r += sr; }
    if (e2 < dr) { err += dr; c += sc; }
  }
}

// Build the tri-tone target the way the studio's buildOrderTarget does:
// tone 0 free / 1 dark / 2 light, plus a seq paint-stamp = priority order.
function buildTarget(P = G) {
  const {
    CY, CX, HEAD_R, EAR_H, EYE_ROW, EYE_DX, NOSE_ROW, MOUTH_ROW,
    WHISK_L, WHISK_R, HALO, CHIN_GAP,
  } = P;
  const fp = QRArt.functionPatterns(VERSION);
  const tone = new Int8Array(S * S);
  const seq = new Int32Array(S * S).fill(-1);
  let counter = 0;
  const inB = (r, c) => r >= 0 && c >= 0 && r < S && c < S;
  const paint = (r, c, t) => {
    if (!inB(r, c)) return;
    const i = r * S + c;
    if (fp.func[i]) return;      // never constrain function patterns
    if (tone[i] !== 0) return;   // keep the earliest (highest-priority) paint
    tone[i] = t;
    seq[i] = counter++;
  };

  // ---- strokes (dark) -----------------------------------------------------
  const strokes = new Set();
  const dark = (r, c) => {
    if (!inB(r, c)) return;
    const i = r * S + c;
    if (fp.func[i]) return;
    strokes.add(i);
  };

  // Head: open arc outline (1 module). Angle 0 = +col; top = 270. Breaks at the
  // two ear joins and the chin gap.
  const earJoinL = [248, 260], earJoinR = [280, 292];
  const chinLo = 90 - CHIN_GAP / 2, chinHi = 90 + CHIN_GAP / 2;
  for (let a = 0; a < 360; a += 0.5) {
    const rad = (a * Math.PI) / 180;
    const rr = Math.round(CY + HEAD_R * Math.sin(rad));
    const cc = Math.round(CX + HEAD_R * Math.cos(rad));
    if (a >= earJoinL[0] && a <= earJoinL[1]) continue;
    if (a >= earJoinR[0] && a <= earJoinR[1]) continue;
    if (CHIN_GAP > 0 && a >= chinLo && a <= chinHi) continue;
    dark(rr, cc);
  }

  // Ears: two OUTLINE triangles sitting on top of the head arc.
  const topRow = CY - HEAD_R;
  const tri = (bL, bR, bRow, aR, aC) => {
    line(bRow, bL, bRow, bR, dark); // base
    line(bRow, bL, aR, aC, dark);   // left side
    line(bRow, bR, aR, aC, dark);   // right side
  };
  tri(CX - 8, CX - 3, topRow + 2, topRow + 2 - EAR_H, CX - 6);
  tri(CX + 3, CX + 8, topRow + 2, topRow + 2 - EAR_H, CX + 6);

  // Eyes: two 2x2 dark dots on the eye line.
  const eye = (er, ec) => { dark(er, ec); dark(er, ec + 1); dark(er + 1, ec); dark(er + 1, ec + 1); };
  eye(EYE_ROW, CX - EYE_DX - 1);
  eye(EYE_ROW, CX + EYE_DX - 1);

  // Nose: 3-module triangle at face centre.
  dark(NOSE_ROW, CX);
  dark(NOSE_ROW + 1, CX - 1);
  dark(NOSE_ROW + 1, CX + 1);

  // Mouth: small "omega" curve under the nose.
  dark(MOUTH_ROW, CX - 1);
  dark(MOUTH_ROW, CX + 1);
  dark(MOUTH_ROW + 1, CX - 2);
  dark(MOUTH_ROW + 1, CX);
  dark(MOUTH_ROW + 1, CX + 2);

  // Whiskers: three horizontal strokes per side, radiating, extending OUTSIDE
  // the head arc into the field.
  const whiskerRows = [EYE_ROW + 2, EYE_ROW + 4, EYE_ROW + 6];
  const tilt = [-1, 0, 1];
  whiskerRows.forEach((wr, k) => {
    for (let c = CX - HEAD_R - 1, st = 0; st < WHISK_L; c--, st++) dark(wr + Math.round(tilt[k] * st * 0.4), c);
    for (let c = CX + HEAD_R + 1, st = 0; st < WHISK_R; c++, st++) dark(wr + Math.round(tilt[k] * st * 0.4), c);
  });

  // Commit strokes (priority 1, oldest paint).
  for (const i of strokes) paint((i / S) | 0, i % S, 1);

  // ---- halo (white): HALO-module Chebyshev dilation of strokes ------------
  for (const i of strokes) {
    const sr = (i / S) | 0, sc = i % S;
    for (let dr = -HALO; dr <= HALO; dr++)
      for (let dc = -HALO; dc <= HALO; dc++) {
        const r = sr + dr, c = sc + dc;
        if (!inB(r, c)) continue;
        if (strokes.has(r * S + c)) continue;
        paint(r, c, 2);
      }
  }

  // ---- field (white): everything else, spiralling out from the face centre-
  const rest = [];
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      const i = r * S + c;
      if (fp.func[i] || tone[i] !== 0) continue;
      rest.push([i, (r - CY) * (r - CY) + (c - CX) * (c - CX)]);
    }
  rest.sort((a, b) => a[1] - b[1]); // nearest-to-face first => margins last
  for (const [i] of rest) paint((i / S) | 0, i % S, 2);

  // ---- derive order / target / tier map -----------------------------------
  const order = [];
  for (let i = 0; i < S * S; i++) if (tone[i] > 0 && !fp.func[i]) order.push(i);
  order.sort((a, b) => seq[a] - seq[b]);
  const target = new Uint8Array(S * S);
  for (const i of order) target[i] = tone[i] === 1 ? 1 : 0;

  // tier: 3 = stroke, 2 = halo (white within Chebyshev 2 of a stroke), 1 = field
  const tier = new Int8Array(S * S);
  for (const i of order) {
    if (tone[i] === 1) { tier[i] = 3; continue; }
    const sr = (i / S) | 0, sc = i % S;
    let halo = false;
    for (let dr = -2; dr <= 2 && !halo; dr++)
      for (let dc = -2; dc <= 2; dc++)
        if (strokes.has((sr + dr) * S + (sc + dc))) { halo = true; break; }
    tier[i] = halo ? 2 : 1;
  }

  return { order, target, seq, tone, tier, strokes, fp };
}

// Whiteness metrics.
function whiteness(matrix, fp, strokes) {
  let nfTotal = 0, nfLight = 0;
  for (let i = 0; i < S * S; i++) {
    if (fp.func[i]) continue;
    nfTotal++;
    if (matrix[i] === 0) nfLight++;
  }
  let innTotal = 0, innLight = 0;
  for (let r = 6; r <= 34; r++)
    for (let c = 6; c <= 34; c++) {
      const i = r * S + c;
      if (fp.func[i] || strokes.has(i)) continue;
      innTotal++;
      if (matrix[i] === 0) innLight++;
    }
  return {
    overall: nfLight / nfTotal, overallLight: nfLight, overallTotal: nfTotal,
    inner: innLight / innTotal, innerLight: innLight, innerTotal: innTotal,
  };
}

function meterLine(perBlock) {
  return perBlock
    .map((b, i) => `blk${i}: ${b.errorsUsed ?? b.errors}/${b.capacity} used (${b.capacity - (b.errorsUsed ?? b.errors)} headroom)`)
    .join("\n  ");
}

// Deterministic restart flip-seed sequence.
const flipSeedFor = (t) => (t === 0 ? 0 : (Math.imul(t, 2654435761) >>> 0) % 4000000);

// Solve one level: search 8 masks x RESTARTS flip-seeds, score, return the best.
function solveLevel(level, tgt) {
  const { order, target, seq, tier, strokes, fp } = tgt;
  const prep = QRArt.prepareArt(URL, VERSION, level, "schemehost");
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    for (let t = 0; t < RESTARTS; t++) {
      const flipSeed = flipSeedFor(t);
      const res = QRArt.solveArt(prep, {
        order, target, seq, mask,
        margin: 0.5, marginCap: 0.8,
        noiseRng: QRArt.mulberry32(NOISE_SEED),
        flipSeed,
      });
      if (res.headroom < 2) continue; // enforce >=2 codewords headroom/block

      const unsat = new Set(res.unsatisfied);
      let sStroke = 0, sHalo = 0, sField = 0, nStroke = 0, nHalo = 0, nField = 0;
      for (const i of order) {
        if (tier[i] === 3) { nStroke++; if (!unsat.has(i)) sStroke++; }
        else if (tier[i] === 2) { nHalo++; if (!unsat.has(i)) sHalo++; }
        else { nField++; if (!unsat.has(i)) sField++; }
      }
      const w = whiteness(res.matrix, fp, strokes);

      // Art score: weighted satisfied pins (halo > field) + whiteness bonus on
      // the inner 29x29. Among candidates that clear both acceptance gates
      // (78% overall / 92% inner) we maximise the *minimum* margin above them,
      // so the winner is as robust as the tight ceiling allows; below the gates
      // we push both whiteness figures up toward passing.
      const pass = w.overall >= 0.78 && w.inner >= 0.92;
      const worstMargin = Math.min(w.overall - 0.78, w.inner - 0.92);
      const art = pass
        ? 1e7 + worstMargin * 1e6 + (w.overall + w.inner) * 1000 +
          sStroke * 50 + sHalo * 6 + sField * 1
        : (w.overall - 0.78) * 1e5 + (w.inner - 0.92) * 1e5 +
          sStroke * 50 + sHalo * 6 + sField * 1 +
          w.inner * 4000 + w.overall * 2000;

      const cand = {
        level, mask, flipSeed, res, w, art, pass,
        sStroke, nStroke, sHalo, nHalo, sField, nField,
      };
      if (!best || art > best.art) best = cand;
    }
  }
  return best;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const tgt = buildTarget(G);

  // Solve + compare L and M.
  const cands = [];
  for (const level of ["L", "M"]) {
    const c = solveLevel(level, tgt);
    const v = verifyMatrix(c.res.matrix, VERSION, URL, { allowSchemeHostCase: true });
    const perBlock = v.perBlock;
    const minHead = Math.min(...perBlock.map((b) => b.capacity - b.errorsUsed));
    cands.push({ ...c, v, perBlock, minHead });
  }

  // Winner: prefer a candidate that passes all gates; among those, best art.
  const gatePass = (c) => c.minHead >= 2 && c.w.overall >= 0.78 && c.w.inner >= 0.92;
  cands.sort((a, b) => {
    const pa = gatePass(a) ? 1 : 0, pb = gatePass(b) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return b.art - a.art;
  });
  const winner = cands[0];
  const { level, mask, res, w, perBlock, minHead, flipSeed } = winner;

  // Final verification (throws on any scan/decode failure).
  const v = verifyMatrix(res.matrix, VERSION, URL, { allowSchemeHostCase: true });
  const decoded = v.validate.text;

  // Outputs.
  writePNG(path.join(OUT, "nearly-blank.png"), renderMatrix(res.matrix, VERSION, { scale: 8, quiet: 4 }));
  fs.writeFileSync(path.join(OUT, "nearly-blank.svg"), QRArt.toSVG(res.matrix, VERSION, { scale: 8, quiet: 4 }));
  fs.writeFileSync(path.join(OUT, "nearly-blank-preview.txt"), QRArt.ascii(res.matrix, VERSION));

  const report = `# Piece 1 — nearly-blank — build report

Generated by \`node build-01-nearly-blank.mjs\` (deterministic; re-run to regenerate).

## Chosen configuration
- URL: \`${URL}\`
- urlCase "schemehost"; decoded (RFC-3986 case remix, same URL): \`${decoded}\`
- Version ${VERSION} (${S}x${S}) — Level **${level}**, Mask **${mask}**
- Restart flip-seed: ${flipSeed} (search: 8 masks x ${RESTARTS} restarts/level)
- freeDim (noise DoF): ${res.freeDim} — a full-field white pin consumes all rank
- Deliberate flips: ${res.flips.length}

## Acceptance gates
- verifyMatrix @ scale 8 + scale 3 (allowSchemeHostCase): **PASS**
- Per-block meter (independent validate() decode):
  ${meterLine(perBlock)}
  min headroom = ${minHead} codewords (need >= 2): **${minHead >= 2 ? "PASS" : "FAIL"}**
- Whiteness, non-function modules light: **${(w.overall * 100).toFixed(1)}%** (${w.overallLight}/${w.overallTotal}); need >= 78%: **${w.overall >= 0.78 ? "PASS" : "FAIL"}**
- Inner 29x29 light (rows/cols 6..34, excl. strokes + furniture): **${(w.inner * 100).toFixed(1)}%** (${w.innerLight}/${w.innerTotal}); need >= 92%: **${w.inner >= 0.92 ? "PASS" : "FAIL"}**

## Pin satisfaction (by priority tier)
- Strokes (dark):    ${winner.sStroke}/${winner.nStroke}
- Halo (2px white):  ${winner.sHalo}/${winner.nHalo}
- Field (white):     ${winner.sField}/${winner.nField}

## Level comparison (best candidate each)
${cands
  .slice()
  .sort((a, b) => (a.level < b.level ? -1 : 1))
  .map((c) => `- Level ${c.level}, mask ${c.mask}: overall ${(c.w.overall * 100).toFixed(1)}%, inner ${(c.w.inner * 100).toFixed(1)}%, minHead ${c.minHead}, halo ${c.sHalo}/${c.nHalo}, field ${c.sField}/${c.nField}${gatePass(c) ? " [passes gates]" : ""}`)
  .join("\n")}

L wins: it maximises solver rank (nVars ${QRArt.prepareArt(URL, VERSION, "L", "schemehost").bases.length} vs M ${QRArt.prepareArt(URL, VERSION, "M", "schemehost").bases.length}), which is what a white-field piece needs; M's smaller rank leaves more residual speckle despite its larger flip budget.

## Outputs
- out/nearly-blank.png (scale 8, quiet 4)
- out/nearly-blank.svg
- out/nearly-blank-preview.txt (engine ascii dump)
`;
  fs.writeFileSync(path.join(OUT, "nearly-blank-report.md"), report);
  console.log(report);
}

main();
