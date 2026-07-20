// build-01-nearly-blank.mjs — Piece 1: "the nearly-blank code".
//
// A mostly-white sheet with a thin line-drawn cat face + the three finder
// squares, that still scans. Strategy (per specs/01-nearly-blank.md):
//   1. Pin all black strokes (highest priority).
//   2. Pin a 2-module white halo around every stroke.
//   3. Pin the WHOLE remaining field white, spiralling outward from the face
//      centre so that when solver rank runs out the forced/unsatisfied modules
//      (speckle) land at the symbol margins, reading as paper grain.
// Then let the engine's flip pass erase residual dark speckle (near-face first
// via the seq tie-break), keeping >=2 codewords headroom per block.
//
// Search: all 8 masks x >=48 restarts (noise/flip seeds), scored by weighted
// satisfied pins (halo > field) + a whiteness bonus on the inner 29x29. L vs M
// compared. Reproducible: `node build-01-nearly-blank.mjs` regenerates out/.
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
const RESTARTS = 48;

// ---------------------------------------------------------------------------
// Face geometry (row, col). Procedural, centred slightly left-of-center.
// Face centre near (19,18); head clears the v6 alignment pattern at (34,34).
// ---------------------------------------------------------------------------
const CY = 19, CX = 18;      // face centre (row, col)
const HEAD_R = 10;           // head radius (~20 module diameter)
const EAR_H = 6;             // ear height
const EYE_ROW = 16;          // eye line
const EYE_DX = 4;            // eyes ~2*EYE_DX apart (~8 modules, near "~7")
const NOSE_ROW = 19;
const MOUTH_ROW = 21;

// Build the tri-tone target the way the studio's buildOrderTarget does.
// tone: 0 free / 1 dark / 2 light ; seq: paint stamp (priority).
function buildTarget() {
  const fp = QRArt.functionPatterns(VERSION);
  const tone = new Int8Array(S * S);
  const seq = new Int32Array(S * S).fill(-1);
  let counter = 0;
  const inB = (r, c) => r >= 0 && c >= 0 && r < S && c < S;
  // paint: only set tone if the cell is empty (never overwrite an earlier,
  // higher-priority stroke/halo with a lower one). t=1 dark, t=2 light.
  const paint = (r, c, t, { over = false } = {}) => {
    if (!inB(r, c)) return;
    const i = r * S + c;
    if (fp.func[i]) return;            // never constrain function patterns
    if (tone[i] === t) return;
    if (tone[i] !== 0 && !over) return; // don't clobber existing paint
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

  // Head: open circle outline, 1 module wide. Break at ear joins (top ~+-35deg).
  for (let a = 0; a < 360; a += 2) {
    const rad = (a * Math.PI) / 180;
    // angle measured from +x (col) axis; top of head is at a=270 (row up).
    const rr = Math.round(CY - HEAD_R * Math.sin(rad));
    const cc = Math.round(CX + HEAD_R * Math.cos(rad));
    // break the arc where the ears join: skip a wedge near the top.
    const topGapL = a > 246 && a < 262;   // left ear join
    const topGapR = a > 278 && a < 294;   // right ear join
    if (topGapL || topGapR) continue;
    dark(rr, cc);
  }

  // Ears: two OUTLINE triangles sitting on top of the head circle.
  // Left ear apex up-left; right ear apex up-right. ~EAR_H tall.
  const drawTriOutline = (baseL, baseR, baseRow, apexR, apexC) => {
    // three edges: base + two slanted sides, drawn as 1-module lines.
    line(baseRow, baseL, baseRow, baseR, dark);   // base
    line(baseRow, baseL, apexR, apexC, dark);     // left side
    line(baseRow, baseR, apexR, apexC, dark);     // right side
  };
  // Ear base points sit on the circle near the top.
  const leftBaseL = CX - 8, leftBaseR = CX - 3, leftBaseRow = CY - Math.round(HEAD_R * 0.55);
  const rightBaseL = CX + 3, rightBaseR = CX + 8, rightBaseRow = CY - Math.round(HEAD_R * 0.55);
  drawTriOutline(leftBaseL, leftBaseR, leftBaseRow, leftBaseRow - EAR_H, CX - 6);
  drawTriOutline(rightBaseL, rightBaseR, rightBaseRow, rightBaseRow - EAR_H, CX + 6);

  // Eyes: two 2x2 dark dots on the eye line, ~2*EYE_DX apart.
  const eye = (er, ec) => { dark(er, ec); dark(er, ec + 1); dark(er + 1, ec); dark(er + 1, ec + 1); };
  eye(EYE_ROW, CX - EYE_DX - 1);
  eye(EYE_ROW, CX + EYE_DX - 1);

  // Nose: 3-module triangle at face centre.
  dark(NOSE_ROW, CX);
  dark(NOSE_ROW + 1, CX - 1);
  dark(NOSE_ROW + 1, CX + 1);

  // Mouth: small "omega" curve under the nose (5-7 modules).
  dark(MOUTH_ROW, CX - 1);
  dark(MOUTH_ROW, CX + 1);
  dark(MOUTH_ROW + 1, CX - 2);
  dark(MOUTH_ROW + 1, CX);
  dark(MOUTH_ROW + 1, CX + 2);

  // Whiskers: three horizontal strokes per side, radiating slightly, extending
  // OUTSIDE the head circle into the white field. Left goes left, right right.
  const whiskerRows = [EYE_ROW + 2, EYE_ROW + 4, EYE_ROW + 6];
  const tilt = [-1, 0, 1]; // radiate: top slants up, bottom slants down
  whiskerRows.forEach((wr, k) => {
    // left whisker: from just outside head (col ~ CX-9) leftwards ~5 modules.
    const lStart = CX - 9, lEnd = CX - 14;
    for (let c = lStart, step = 0; c >= lEnd; c--, step++) dark(wr + Math.round(tilt[k] * step * 0.4), c);
    // right whisker
    const rStart = CX + 9, rEnd = CX + 14;
    for (let c = rStart, step = 0; c <= rEnd; c++, step++) dark(wr + Math.round(tilt[k] * step * 0.4), c);
  });

  // Commit strokes (priority 1, oldest paint).
  for (const i of strokes) paint((i / S) | 0, i % S, 1);

  // ---- halo (white): 2-module Chebyshev dilation of strokes ---------------
  const R = 2;
  for (const i of strokes) {
    const sr = (i / S) | 0, sc = i % S;
    for (let dr = -R; dr <= R; dr++)
      for (let dc = -R; dc <= R; dc++) {
        const r = sr + dr, c = sc + dc;
        if (!inB(r, c)) continue;
        if (strokes.has(r * S + c)) continue; // stroke stays dark
        paint(r, c, 2);                        // halo white (priority 2)
      }
  }

  // ---- field (white): everything else, spiralling out from the face centre-
  const rest = [];
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      const i = r * S + c;
      if (fp.func[i] || tone[i] !== 0) continue;
      const d2 = (r - CY) * (r - CY) + (c - CX) * (c - CX);
      rest.push([i, d2]);
    }
  rest.sort((a, b) => a[1] - b[1]); // nearest-to-face first => margins last
  for (const [i] of rest) paint((i / S) | 0, i % S, 2);

  // ---- derive order / target ---------------------------------------------
  const order = [];
  for (let i = 0; i < S * S; i++) if (tone[i] > 0 && !fp.func[i]) order.push(i);
  order.sort((a, b) => seq[a] - seq[b]);
  const target = new Uint8Array(S * S);
  for (const i of order) target[i] = tone[i] === 1 ? 1 : 0;

  return { order, target, seq, tone, fp, strokes };
}

// Bresenham line into a dark() sink.
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

// Whiteness metrics.
function whiteness(matrix, fp, strokes) {
  // overall: fraction of non-function modules that are light.
  let nfTotal = 0, nfLight = 0;
  for (let i = 0; i < S * S; i++) {
    if (fp.func[i]) continue;
    nfTotal++;
    if (matrix[i] === 0) nfLight++;
  }
  // inner 29x29 (rows/cols 6..34), excluding strokes and furniture.
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
    .map((b, i) => `blk${i}: ${b.errorsUsed}/${b.capacity} used (${b.capacity - b.errorsUsed} headroom)`)
    .join("\n  ");
}

// Score a solved candidate. Weighted satisfied pins (halo>field) + whiteness.
function score(res, tone, whiteInner) {
  const unsat = new Set(res.unsatisfied);
  let stroke = 0, halo = 0, field = 0;
  // classify satisfied pins by their tone priority tier. tone==1 stroke.
  // Halo vs field: recompute halo set from tone? We pass a classifier map.
  return { stroke, halo, field, whiteInner };
}

// ---------------------------------------------------------------------------
// Search over level x mask x restart.
// ---------------------------------------------------------------------------
function run() {
  const { order, target, seq, tone, fp, strokes } = buildTarget();

  // Build a per-module tier map for scoring: 3=stroke, 2=halo, 1=field.
  // halo = tone 2 cells within Chebyshev 2 of a stroke; else field.
  const tier = new Int8Array(S * S);
  for (const i of order) {
    if (tone[i] === 1) { tier[i] = 3; continue; }
    const sr = (i / S) | 0, sc = i % S;
    let isHalo = false;
    for (let dr = -2; dr <= 2 && !isHalo; dr++)
      for (let dc = -2; dc <= 2; dc++)
        if (strokes.has((sr + dr) * S + (sc + dc))) { isHalo = true; break; }
    tier[i] = isHalo ? 2 : 1;
  }

  const levels = ["L", "M"];
  const results = [];
  for (const level of levels) {
    const prep = QRArt.prepareArt(URL, VERSION, level, "schemehost");
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      for (let t = 0; t < RESTARTS; t++) {
        const noiseSeed = 1000 + mask * 131 + t * 2654435761 % 1000000;
        const flipSeed = 1 + mask * 97 + t * 7;
        const res = QRArt.solveArt(prep, {
          order, target, seq, mask,
          margin: 0.5, marginCap: 0.8,
          noiseRng: QRArt.mulberry32(noiseSeed >>> 0),
          flipSeed,
        });
        // feasibility gate: >=2 headroom per block (solver-side estimate).
        if (res.headroom < 2) continue;
        // satisfied pins by tier.
        const unsat = new Set(res.unsatisfied);
        let sStroke = 0, sHalo = 0, sField = 0, nStroke = 0, nHalo = 0, nField = 0;
        for (const i of order) {
          if (tier[i] === 3) { nStroke++; if (!unsat.has(i)) sStroke++; }
          else if (tier[i] === 2) { nHalo++; if (!unsat.has(i)) sHalo++; }
          else { nField++; if (!unsat.has(i)) sField++; }
        }
        const w = whiteness(res.matrix, fp, strokes);
        // Weighted art score: strokes must be perfect, halo heavy, field light,
        // plus a strong whiteness bonus on the inner 29x29.
        const art = sStroke * 50 + sHalo * 6 + sField * 1 + w.inner * 4000 + w.overall * 1000;
        const cand = {
          level, mask, noiseSeed: noiseSeed >>> 0, flipSeed, res, w, art,
          sStroke, nStroke, sHalo, nHalo, sField, nField,
        };
        if (!best || art > best.art) best = cand;
      }
    }
    results.push(best);
  }

  // Verify + gate each level's best, then pick the winner.
  const verified = [];
  for (const c of results) {
    if (!c) continue;
    const v = verifyMatrix(c.res.matrix, VERSION, URL, { allowSchemeHostCase: true });
    const perBlock = v.perBlock;
    const minHead = Math.min(...perBlock.map((b) => b.capacity - b.errorsUsed));
    verified.push({ ...c, v, perBlock, minHead });
  }

  // Prefer a candidate that passes all acceptance gates; among those, best art.
  const passes = (c) =>
    c.minHead >= 2 && c.w.overall >= 0.78 && c.w.inner >= 0.92;
  verified.sort((a, b) => {
    const pa = passes(a) ? 1 : 0, pb = passes(b) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return b.art - a.art;
  });
  const winner = verified[0];

  return { winner, verified, order, tone, fp, strokes, tier };
}

// ---------------------------------------------------------------------------
function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { winner, verified, fp, strokes } = run();
  const { level, mask, res, w, perBlock, minHead, noiseSeed, flipSeed } = winner;

  // Re-verify the winner (throws on any scan/decode failure).
  const v = verifyMatrix(res.matrix, VERSION, URL, { allowSchemeHostCase: true });

  // Outputs.
  const png = renderMatrix(res.matrix, VERSION, { scale: 8, quiet: 4 });
  writePNG(path.join(OUT, "nearly-blank.png"), png);
  fs.writeFileSync(path.join(OUT, "nearly-blank.svg"), QRArt.toSVG(res.matrix, VERSION, { scale: 8, quiet: 4 }));
  fs.writeFileSync(path.join(OUT, "nearly-blank-preview.txt"), QRArt.ascii(res.matrix, VERSION));

  const pins = { stroke: `${winner.sStroke}/${winner.nStroke}`, halo: `${winner.sHalo}/${winner.nHalo}`, field: `${winner.sField}/${winner.nField}` };
  const decoded = v.validate.text;

  const report = `# Piece 1 — nearly-blank — build report

Generated by \`node build-01-nearly-blank.mjs\` (reproducible).

## Chosen configuration
- URL: \`${URL}\` (urlCase "schemehost"; decoded remix: \`${decoded}\`)
- Version: ${VERSION} (${S}x${S}) — Level **${level}**, Mask **${mask}**
- Seeds: noise ${noiseSeed}, flip ${flipSeed}
- freeDim (noise DoF): ${res.freeDim}
- Deliberate flips: ${res.flips.length}

## Acceptance gates
- verifyMatrix (scale 8 + scale 3, allowSchemeHostCase): **PASS**
- Per-block meter (validate):
  ${meterLine(perBlock)}
  → min headroom = ${minHead} codewords (need >= 2): **${minHead >= 2 ? "PASS" : "FAIL"}**
- Whiteness (non-function light): **${(w.overall * 100).toFixed(1)}%** (${w.overallLight}/${w.overallTotal}), need >= 78%: **${w.overall >= 0.78 ? "PASS" : "FAIL"}**
- Inner 29x29 light (excl. strokes + furniture): **${(w.inner * 100).toFixed(1)}%** (${w.innerLight}/${w.innerTotal}), need >= 92%: **${w.inner >= 0.92 ? "PASS" : "FAIL"}**

## Pin satisfaction (by priority tier)
- Strokes (dark):  ${pins.stroke}
- Halo (2px white): ${pins.halo}
- Field (white):    ${pins.field}

## Level comparison (best candidate each)
${verified.map((c) => `- Level ${c.level}, mask ${c.mask}: overall ${(c.w.overall * 100).toFixed(1)}%, inner ${(c.w.inner * 100).toFixed(1)}%, minHead ${c.minHead}, halo ${c.sHalo}/${c.nHalo}, field ${c.sField}/${c.nField}`).join("\n")}

## Outputs
- out/nearly-blank.png (scale 8, quiet 4)
- out/nearly-blank.svg
- out/nearly-blank-preview.txt (engine ascii dump)
`;
  fs.writeFileSync(path.join(OUT, "nearly-blank-report.md"), report);

  // Console summary.
  console.log(report);
}

main();
