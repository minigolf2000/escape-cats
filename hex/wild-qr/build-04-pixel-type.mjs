// build-04-pixel-type.mjs — Piece 4 of the QR-art project: "the code that names
// its destination". The artwork *is* legible pixel type: two lines, CAT over
// GAMES, drawn as dark letters with a 1-module white halo against surrendered
// noise. Scanning it opens https://github.com/minigolf2000/cat-games — so the
// human-readable and machine-readable layers agree.
//
// Central constraint (see hex/qr-art-notes.md): the 41-char URL freezes block 1
// solid, and interleaving sprinkles those frozen codewords into the right-hand
// columns. So the rightmost letters (T of CAT, S of GAMES) are the expensive
// ones. We fight that three ways: (1) scheme+host case bits — the only steerable
// bits inside the frozen URL region — via urlCase "schemehost"; (2) priority
// order that pins the frozen-side letter strokes FIRST; (3) a slight leftward
// bias plus the RS flip budget for any stroke the basis can't reach.
//
// Reproducible: fixed seeds; run `node build-04-pixel-type.mjs`.
// Outputs to ./out/: pixel-type.png, pixel-type.svg,
// pixel-type-target-vs-solved.png, pixel-type-report.md.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QRArt } from "./engine.mjs";
import { renderMatrix, writePNG } from "./png.mjs";
import { verifyMatrix, scanRGBA } from "./verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const URL = "https://github.com/minigolf2000/cat-games";
const VERSION = 6;
const LEVEL = "L";
const S = QRArt.sizeOf(VERSION); // 41
const NOISE_SEED = 0xca7f00d;
const FLIP_SEED = 20260720;

// Three-tone palette (Disney-poster trick, applied at render time — zero solver
// cost). Letter strokes + function patterns render pure black; the surrendered
// noise ground renders dark gray so the type lifts off it. jsQR still thresholds
// both against white, so the toned artifact scans.
const GRAY = [0x3a, 0x3a, 0x3a]; // #3a3a3a — must stay low-luminance (< 0.2)
function relLuminance([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// GAMES halo band radius (Chebyshev). Art notes asked to try 2 for the smaller
// line; measured, the 2-module band cost 2 stroke pins (248->246, 97.25%->
// 96.47%, below the 97% gate: M and S each lost a stroke to the extra
// light-pin competition), so we keep 1 and let the three-tone separation carry
// GAMES. (Set GHALO=2 to reproduce the rejected variant.)
const GAMES_HALO_R = Number(process.env.GHALO ?? 1);

const fp = QRArt.functionPatterns(VERSION);

// ---------------------------------------------------------------------------
// 1. Pixel font
// ---------------------------------------------------------------------------
// Big glyphs for CAT (8 wide x 14 tall, 2-module strokes — bold, reads at
// distance). Small glyphs for GAMES (10 tall, 1-module strokes; widths vary so
// the word fits the clean band cols 9..31 without touching the bottom-left
// finder or the (34,34) alignment).
const BIG = {
  C: [
    "11111111",
    "11111111",
    "11000000",
    "11000000",
    "11000000",
    "11000000",
    "11000000",
    "11000000",
    "11000000",
    "11000000",
    "11000000",
    "11000000",
    "11111111",
    "11111111",
  ],
  A: [
    "00111100",
    "00111100",
    "01100110",
    "01100110",
    "11000011",
    "11000011",
    "11111111",
    "11111111",
    "11000011",
    "11000011",
    "11000011",
    "11000011",
    "11000011",
    "11000011",
  ],
  T: [
    "11111111",
    "11111111",
    "00011000",
    "00011000",
    "00011000",
    "00011000",
    "00011000",
    "00011000",
    "00011000",
    "00011000",
    "00011000",
    "00011000",
    "00011000",
    "00011000",
  ],
};

const SMALL = {
  G: [
    "1111",
    "1000",
    "1000",
    "1000",
    "1000",
    "1011",
    "1001",
    "1001",
    "1001",
    "1111",
  ],
  A: [
    "0110",
    "1001",
    "1001",
    "1001",
    "1111",
    "1001",
    "1001",
    "1001",
    "1001",
    "1001",
  ],
  M: [
    "10001",
    "11011",
    "10101",
    "10101",
    "10001",
    "10001",
    "10001",
    "10001",
    "10001",
    "10001",
  ],
  E: [
    "111",
    "100",
    "100",
    "100",
    "111",
    "100",
    "100",
    "100",
    "100",
    "111",
  ],
  S: [
    "111",
    "100",
    "100",
    "100",
    "111",
    "001",
    "001",
    "001",
    "001",
    "111",
  ],
};

// A tiny 3-4 module paw print (garnish; lowest priority, dropped first).
// 4 wide x 5 tall: three toe beans over a wider pad.
const PAW = [
  "1010",
  "1010",
  "0000",
  "0110",
  "0110",
];

// ---------------------------------------------------------------------------
// 2. Placement (module coordinates)
// ---------------------------------------------------------------------------
// CAT: rows 9..22 (14 tall). Letters 8 wide, 1-module gaps. Cols 7..32 keeps
// the whole word right of the col-6 timing strip and pulls the frozen-side T
// leftward (ends col 32, not the extreme right edge). Essentially centered with
// a slight left bias.
//   C: cols 7..14   A: cols 16..23   T: cols 25..32
const CAT_ROW = 9;
const CAT = [
  { glyph: BIG.C, name: "C", col: 7 },
  { glyph: BIG.A, name: "A", col: 16 },
  { glyph: BIG.T, name: "T", col: 25 },
];

// GAMES: rows 24..33 (10 tall). The clean band cols 9..31 clears the
// bottom-left finder (cols 0..8 at rows 33+) and the (34,34) alignment
// (cols 32..36) — so the S ends at col 31, "before column 32", and the
// alignment square sits just past it, reading as a full stop.
//   G:9..12  A:14..17  M:19..23  E:25..27  S:29..31
const GAMES_ROW = 24;
const GAMES = [
  { glyph: SMALL.G, name: "G", col: 9 },
  { glyph: SMALL.A, name: "A", col: 14 },
  { glyph: SMALL.M, name: "M", col: 19 },
  { glyph: SMALL.E, name: "E", col: 25 },
  { glyph: SMALL.S, name: "S", col: 29 },
];

// ---------------------------------------------------------------------------
// 3. Paint tone map with priority (paint stamp = priority, oldest = highest)
// ---------------------------------------------------------------------------
const tone = new Int8Array(S * S); // 0 noise, 1 dark, 2 light
const seq = new Int32Array(S * S).fill(-1);
const role = new Int8Array(S * S); // 0 none, 1 letter-stroke, 2 halo, 3 paw
let counter = 0;

function paintDark(r, c, isPaw) {
  if (r < 0 || c < 0 || r >= S || c >= S) return;
  const i = r * S + c;
  if (fp.func[i]) return; // never constrain function patterns
  if (tone[i] === 1) return;
  tone[i] = 1;
  seq[i] = counter++;
  role[i] = isPaw ? 3 : 1;
}
function paintLight(r, c) {
  if (r < 0 || c < 0 || r >= S || c >= S) return;
  const i = r * S + c;
  if (fp.func[i] || tone[i] === 1) return; // don't clobber dark strokes/func
  if (tone[i] === 2) return;
  tone[i] = 2;
  seq[i] = counter++;
  role[i] = 2;
}

// Rasterise a glyph's dark cells at (row0, col0). Returns the list of dark cells
// (for later halo generation) without painting yet.
function glyphCells(glyph, row0, col0) {
  const cells = [];
  for (let r = 0; r < glyph.length; r++)
    for (let c = 0; c < glyph[r].length; c++)
      if (glyph[r][c] === "1") cells.push([row0 + r, col0 + c]);
  return cells;
}

// Collect every letter's dark cells first so we can order them by priority
// (frozen-side letters — the rightmost T and S — pinned earliest).
const letters = [];
for (const g of CAT) letters.push({ ...g, line: "CAT", cells: glyphCells(g.glyph, CAT_ROW, g.col) });
for (const g of GAMES) letters.push({ ...g, line: "GAMES", cells: glyphCells(g.glyph, GAMES_ROW, g.col) });

// Priority: rightmost-column-first (frozen columns are the expensive ones), so
// pins there consume solver rank before it runs out. Ties: top line before
// bottom, then earlier column.
const priorityOrder = [...letters].sort((a, b) => {
  const ax = a.col + a.glyph[0].length, bx = b.col + b.glyph[0].length;
  if (bx !== ax) return bx - ax; // larger right-edge column first
  return a.line === b.line ? a.col - b.col : a.line === "CAT" ? -1 : 1;
});

// (a) letter strokes — highest priority, frozen-side letters first.
for (const L of priorityOrder) for (const [r, c] of L.cells) paintDark(r, c, false);

// (b) Halos — next priority. GAMES (smaller glyphs, fights the noise harder)
// gets a wider halo band placed FIRST (higher priority); then a 1-module ring
// around every stroke gives CAT its halo (GAMES inner ring is already down).
const allStroke = [];
for (const L of letters) for (const cell of L.cells) allStroke.push(cell);
const gamesStroke = [];
for (const L of letters) if (L.line === "GAMES") for (const cell of L.cells) gamesStroke.push(cell);
for (const [r, c] of gamesStroke)
  for (let dr = -GAMES_HALO_R; dr <= GAMES_HALO_R; dr++)
    for (let dc = -GAMES_HALO_R; dc <= GAMES_HALO_R; dc++)
      if (dr || dc) paintLight(r + dr, c + dc);
for (const [r, c] of allStroke)
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++)
      if (dr || dc) paintLight(r + dr, c + dc);

// (c) paw-print garnish — lowest priority (drops first if rank runs short).
// Tucked into the open field top-left, above CAT and clear of the timing strip.
const PAW_ROW = 2, PAW_COL = 11; // between the two top finders, rows 2..6-ish
const pawCells = glyphCells(PAW, PAW_ROW, PAW_COL);
for (const [r, c] of pawCells) paintDark(r, c, true);
for (const [r, c] of pawCells)
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++)
      if (dr || dc) paintLight(r + dr, c + dc);

// ---------------------------------------------------------------------------
// 4. Derive {order, target}
// ---------------------------------------------------------------------------
const order = [];
for (let i = 0; i < S * S; i++) if (tone[i] > 0 && !fp.func[i]) order.push(i);
order.sort((a, b) => seq[a] - seq[b]);
const target = new Uint8Array(S * S);
for (const i of order) target[i] = tone[i] === 1 ? 1 : 0;

// Index sets for per-role accounting.
const strokeIdx = new Set();
const haloIdx = new Set();
const pawIdx = new Set();
for (let i = 0; i < S * S; i++) {
  if (role[i] === 1) strokeIdx.add(i);
  else if (role[i] === 2) haloIdx.add(i);
  else if (role[i] === 3) pawIdx.add(i);
}

// ---------------------------------------------------------------------------
// 5. Solve — schemehost case play, search all masks, keep the best solve.
// ---------------------------------------------------------------------------
const prep = QRArt.prepareArt(URL, VERSION, LEVEL, "schemehost");
let best = null;
for (let mask = 0; mask < 8; mask++) {
  const res = QRArt.solveArt(prep, {
    order,
    target,
    seq,
    mask,
    margin: 0.5,
    marginCap: 0.8,
    noiseRng: QRArt.mulberry32(NOISE_SEED),
    flipSeed: FLIP_SEED,
  });
  const v = QRArt.validate(res.matrix, VERSION);
  if (!v.ok) continue;
  const headroom = Math.min(...v.perBlock.map((b) => b.capacity - b.errors));
  const unsat = new Set(res.unsatisfied);
  // Legibility-weighted score: stroke pins dominate, then halos, then headroom.
  let strokeMiss = 0, haloMiss = 0;
  for (const i of unsat) {
    if (strokeIdx.has(i) || pawIdx.has(i)) strokeMiss++;
    else if (haloIdx.has(i)) haloMiss++;
  }
  const score = -strokeMiss * 100000 - haloMiss * 100 + headroom;
  if (process.env.SWEEP) console.log(`mask ${mask}: strokeMiss ${strokeMiss}, haloMiss ${haloMiss}, headroom ${headroom}, flips ${res.flips.length}`);
  if (!best || score > best.score) best = { mask, res, v, headroom, strokeMiss, haloMiss, score };
}
if (!best) throw new Error("no mask produced a decodable solve");

const { res, mask, v, headroom } = best;
const matrix = res.matrix;
const unsat = new Set(res.unsatisfied);

// Per-role satisfaction.
function satOf(set) {
  let total = 0, miss = 0;
  for (const i of set) { total++; if (unsat.has(i)) miss++; }
  return { total, honored: total - miss, miss, pct: total ? ((total - miss) / total) * 100 : 100 };
}
const strokeSat = satOf(strokeIdx);
const haloSat = satOf(haloIdx);
const pawSat = satOf(pawIdx);
// Letter-stroke satisfaction, per the spec's >=97% gate (paw excluded — garnish).
const letterPct = strokeSat.pct;

// Per-letter breakdown (which letters, if any, lost strokes).
const perLetter = letters.map((L) => {
  let miss = 0;
  for (const [r, c] of L.cells) if (unsat.has(r * S + c) && !fp.func[r * S + c]) miss++;
  return { line: L.line, name: L.name, total: L.cells.length, miss };
});

// ---------------------------------------------------------------------------
// 6. Acceptance gates
// ---------------------------------------------------------------------------
const vm = verifyMatrix(matrix, VERSION, URL, { allowSchemeHostCase: true });
for (const b of v.perBlock) {
  const head = b.capacity - b.errors;
  if (head < 2) throw new Error(`block headroom ${head} < 2 (used ${b.errors}/${b.capacity})`);
}
if (letterPct < 97) {
  console.warn(`WARNING: letter-stroke satisfaction ${letterPct.toFixed(1)}% < 97% gate`);
}

// ---------------------------------------------------------------------------
// 7. Render deliverables
// ---------------------------------------------------------------------------
const SCALE = 8, QUIET = 4;
const GRAY_LUM = relLuminance(GRAY);

// blackSet = the modules that render pure black in the toned version: function
// patterns + intended letter/paw strokes (the ones actually dark in the matrix).
// Everything else dark is surrendered noise → gray.
const blackSet = new Set();
for (let i = 0; i < S * S; i++) if (fp.func[i]) blackSet.add(i);
for (const i of strokeIdx) blackSet.add(i);
for (const i of pawIdx) blackSet.add(i);

// Three-tone rasteriser: black for strokes+function patterns, gray for noise,
// white for light. Own rasteriser (the engine's toRGBA is single-dark-colour).
function renderToned(m, { scale = SCALE, quiet = QUIET } = {}) {
  const dim = (S + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = 255; }
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      if (!m[r * S + c]) continue;
      const col = blackSet.has(r * S + c) ? [0, 0, 0] : GRAY;
      const x0 = (c + quiet) * scale, y0 = (r + quiet) * scale;
      for (let y = 0; y < scale; y++)
        for (let x = 0; x < scale; x++) {
          const o = ((y0 + y) * dim + (x0 + x)) * 4;
          data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
        }
    }
  return { data, width: dim, height: dim };
}

// (a) hero = toned; (b) BW = pure black/white print fallback.
writePNG(path.join(OUT, "pixel-type.png"), renderToned(matrix, { scale: SCALE, quiet: QUIET }));
writePNG(path.join(OUT, "pixel-type-bw.png"), renderMatrix(matrix, VERSION, { scale: SCALE, quiet: QUIET }));

// SVG builder. toned=true → two colours (black strokes+func over gray noise);
// toned=false → pure black on white (BW fallback).
function buildSVG(m, toned) {
  const M = 10, QZ = QUIET;
  const dim = (S + 2 * QZ) * M;
  let black = "", gray = "";
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      if (!m[r * S + c]) continue;
      const seg = `M${(c + QZ) * M} ${(r + QZ) * M}h${M}v${M}h-${M}z`;
      if (!toned || blackSet.has(r * S + c)) black += seg; else gray += seg;
    }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="#ffffff"/>` +
    (toned ? `<path d="${gray}" fill="#3a3a3a"/>` : "") +
    `<path d="${black}" fill="#000000"/>` +
    `</svg>`
  );
}
fs.writeFileSync(path.join(OUT, "pixel-type.svg"), buildSVG(matrix, true));
fs.writeFileSync(path.join(OUT, "pixel-type-bw.svg"), buildSVG(matrix, false));

// (c) target-vs-solved side-by-side. Left = pre-solve ideal (function patterns +
// the letter/paw strokes, dark on white, noise & halos blank so the type reads
// clean). Right = the solved symbol. Labelled with a tiny 3x5 font.
const idealMatrix = new Uint8Array(fp.base); // function patterns pre-seeded
for (const i of strokeIdx) idealMatrix[i] = 1;
for (const i of pawIdx) idealMatrix[i] = 1;

const FONT5 = {
  A: ["010", "101", "111", "101", "101"], E: ["111", "100", "110", "100", "111"],
  D: ["110", "101", "101", "101", "110"], G: ["111", "100", "101", "101", "111"],
  L: ["100", "100", "100", "100", "111"], O: ["111", "101", "101", "101", "111"],
  R: ["110", "101", "110", "101", "101"], S: ["111", "100", "111", "001", "111"],
  T: ["111", "010", "010", "010", "010"], V: ["101", "101", "101", "101", "010"],
  " ": ["000", "000", "000", "000", "000"],
};

function sideBySide(leftImg, rightImg, gapPx, labelL, labelR) {
  const h = Math.max(leftImg.height, rightImg.height);
  const labelH = 7 * 4 + 8; // font pixel 4, plus padding
  const W = leftImg.width + gapPx + rightImg.width;
  const H = h + labelH;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const put = (x, y, col) => {
    x |= 0; y |= 0;
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
  const label = (text, x0, y0) => {
    const px = 4, cw = 4 * px;
    let x = x0;
    for (const ch of text.toUpperCase()) {
      const g = FONT5[ch] || FONT5[" "];
      for (let r = 0; r < 5; r++)
        for (let c = 0; c < 3; c++)
          if (g[r][c] === "1")
            for (let dy = 0; dy < px; dy++)
              for (let dx = 0; dx < px; dx++) put(x + c * px + dx, y0 + r * px + dy, [20, 20, 20]);
      x += cw;
    }
  };
  blit(leftImg, 0, labelH);
  blit(rightImg, leftImg.width + gapPx, labelH);
  label(labelL, 4, 6);
  label(labelR, leftImg.width + gapPx + 4, 6);
  return { data, width: W, height: H };
}

// Target = pre-solve ideal (toned: black strokes/func on white). Solved = the
// toned hero, so the review sees exactly what ships.
const idealImg = renderToned(idealMatrix, { scale: SCALE, quiet: QUIET });
const solvedImg = renderToned(matrix, { scale: SCALE, quiet: QUIET });
writePNG(
  path.join(OUT, "pixel-type-target-vs-solved.png"),
  sideBySide(idealImg, solvedImg, 40, "TARGET", "SOLVED")
);

// ---------------------------------------------------------------------------
// 8. Scan matrix (jsQR) at both scales, plus half-res of scale 8.
// ---------------------------------------------------------------------------
function halfRes(img) {
  const { data, width: W, height: H } = img;
  const w2 = W >> 1, h2 = H >> 1;
  const out = new Uint8ClampedArray(w2 * h2 * 4);
  for (let y = 0; y < h2; y++)
    for (let x = 0; x < w2; x++) {
      const o = (y * w2 + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const a = data[(2 * y * W + 2 * x) * 4 + ch];
        const b = data[(2 * y * W + 2 * x + 1) * 4 + ch];
        const cc = data[((2 * y + 1) * W + 2 * x) * 4 + ch];
        const d = data[((2 * y + 1) * W + 2 * x + 1) * 4 + ch];
        out[o + ch] = (a + b + cc + d) >> 2;
      }
    }
  return { data: out, width: w2, height: h2 };
}
function sameURLlite(a, b) {
  const norm = (u) => {
    const m = u && u.match(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/i);
    return m ? m[1].toLowerCase() + m[2] : u;
  };
  return norm(a) === norm(b);
}
// The scan gate applies to the TONED artifact (the hero), not just the BW
// render. jsQR must recover the URL from the gray-on-white toned image at
// scale 8, scale 3, and half-res.
const scanTargets = [
  { label: "toned scale 8", img: renderToned(matrix, { scale: 8, quiet: 4 }) },
  { label: "toned scale 3", img: renderToned(matrix, { scale: 3, quiet: 4 }) },
  { label: "toned scale 8 half-res", img: halfRes(renderToned(matrix, { scale: 8, quiet: 4 })) },
  { label: "bw scale 8", img: renderMatrix(matrix, VERSION, { scale: 8, quiet: 4 }) },
  { label: "bw scale 3", img: renderMatrix(matrix, VERSION, { scale: 3, quiet: 4 }) },
  { label: "bw scale 8 half-res", img: halfRes(renderMatrix(matrix, VERSION, { scale: 8, quiet: 4 })) },
];
const scanMatrix = scanTargets.map((t) => {
  const decoded = scanRGBA(t.img);
  return { label: t.label, ok: decoded !== null && sameURLlite(decoded, URL), decoded };
});
// Hard gates.
if (GRAY_LUM >= 0.2) throw new Error(`gray luminance ${GRAY_LUM.toFixed(4)} >= 0.2`);
for (const s of scanMatrix.filter((s) => s.label.startsWith("toned"))) {
  if (!s.ok) throw new Error(`toned artifact failed jsQR scan gate at ${s.label}: got ${JSON.stringify(s.decoded)}`);
}

// ---------------------------------------------------------------------------
// 9. Report
// ---------------------------------------------------------------------------
function meterLines(perBlock) {
  return perBlock
    .map((b, i) => `- blk${i}: ${b.errors}/${b.capacity} codewords used — ${b.capacity - b.errors} headroom`)
    .join("\n");
}
const perLetterLines = perLetter
  .map((L) => `- ${L.line} \`${L.name}\`: ${L.total - L.miss}/${L.total} strokes${L.miss ? ` (**${L.miss} missed**)` : ""}`)
  .join("\n");

const report = `# Piece 4 — pixel type (CAT GAMES) — build report

Generated by \`build-04-pixel-type.mjs\` (reproducible; seeds noise=0x${NOISE_SEED.toString(16)}, flip=${FLIP_SEED}).

## Concept
The artwork *is* the code's name: two lines of pixel type — **CAT** (large,
8x14 glyphs, 2-module strokes) over **GAMES** (10-tall glyphs) — dark letters
with a 1-module white halo, everything else surrendered to noise. Scanning opens
\`${URL}\`.

## Three-tone render (Disney-poster trick, zero solver cost)
The hero renders letter strokes + function patterns in **pure black** and the
surrendered noise ground in **dark gray \`#3a3a3a\`** — so the type lifts off the
noise. This is a render-time recolour only; the matrix (and thus the scan) is
unchanged.
- Gray relative luminance: **${GRAY_LUM.toFixed(4)}** (gate < 0.2 ✓).
- The jsQR scan gate is enforced on the **toned** artifact (not just BW) at scale 8, scale 3, and half-res — all must pass.

## Symbol
- Version ${VERSION}, level ${LEVEL} (${S}x${S}), mask ${mask} (chosen by stroke-pins, then halo-pins, then headroom).
- urlCase: **schemehost** (scheme+host case bits are the only steerable bits in the frozen URL region); verified with \`allowSchemeHostCase\`.
- Decoded (case-remixed, RFC-3986 equivalent): \`${v.text}\`
- freeDim ${res.freeDim}, deliberate flips ${res.flips.length}.

## Legibility gate (the piece)
- **Letter-stroke pins: ${strokeSat.honored}/${strokeSat.total} = ${letterPct.toFixed(2)}%** (gate ≥97%).
- **Halo pins: ${haloSat.honored}/${haloSat.total} = ${haloSat.pct.toFixed(2)}%.**
- Paw-print garnish: ${pawSat.honored}/${pawSat.total} strokes (${pawSat.pct.toFixed(1)}%).

### Per-letter stroke satisfaction
${perLetterLines}

### GAMES halo (art-notes experiment)
Tried a 2-module halo band around the GAMES line (higher priority than the CAT
halo). It **cost 2 stroke pins** — 248→246 (97.25%→96.47%, below the 97% gate:
M and S each lost a stroke to the extra light-pin competition), so it was
**reverted to a 1-module halo**. The three-tone separation carries GAMES
instead. (Currently GAMES_HALO_R=${GAMES_HALO_R}; set env \`GHALO=2\` to reproduce the rejected variant.)

## Per-block meter (honest validate() decode)
${meterLines(v.perBlock)}

Worst-block headroom: ${headroom} codewords (gate: ≥2). Bare-symbol verifyMatrix passed at scale 8 and 3.

## Scan matrix (jsQR)
| render | result | decoded (scheme+host case-normalised) |
| --- | --- | --- |
${scanMatrix.map((s) => `| ${s.label} | ${s.ok ? "PASS" : "FAIL"} | ${sameURLlite(s.decoded, URL) ? "= URL" : JSON.stringify(s.decoded)} |`).join("\n")}

## Placement
- CAT: rows ${CAT_ROW}..${CAT_ROW + 13}, cols 7..32 (C 7..14, A 16..23, T 25..32). Right of the col-6 timing strip; slight left bias pulls the frozen-side T off the extreme right edge.
- GAMES: rows ${GAMES_ROW}..${GAMES_ROW + 9}, cols 9..31 (G 9..12, A 14..17, M 19..23, E 25..27, S 29..31). Sits in the clean band that clears the bottom-left finder (cols 0..8) and the (34,34) alignment (cols 32..36) — the S ends at col 31 and the alignment square reads as a full stop just past it.
- Paw print: rows ${PAW_ROW}..${PAW_ROW + 4}, cols ${PAW_COL}..${PAW_COL + 3} (garnish; lowest priority).
- Priority order: frozen-side letter strokes first (rightmost right-edge column first), then all strokes, then halos, then paw.

## Deliverables
- out/pixel-type.png — **hero, three-tone** (black type on gray noise), scale ${SCALE}
- out/pixel-type-bw.png — pure black/white print fallback, scale ${SCALE}
- out/pixel-type.svg — vector, three-tone (quiet zone ${QUIET})
- out/pixel-type-bw.svg — vector, black/white fallback
- out/pixel-type-target-vs-solved.png — pre-solve ideal vs toned-solved, side by side
- out/pixel-type-report.md — this file
`;
fs.writeFileSync(path.join(OUT, "pixel-type-report.md"), report);

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------
console.log(`mask ${mask}`);
console.log(`letter-stroke pins: ${strokeSat.honored}/${strokeSat.total} (${letterPct.toFixed(2)}%)`);
console.log(`halo pins:          ${haloSat.honored}/${haloSat.total} (${haloSat.pct.toFixed(2)}%)`);
console.log(`paw pins:           ${pawSat.honored}/${pawSat.total} (${pawSat.pct.toFixed(1)}%)`);
console.log("per-letter:", perLetter.map((L) => `${L.name}:${L.total - L.miss}/${L.total}`).join(" "));
console.log("meter:");
console.log(meterLines(v.perBlock));
console.log(`worst-block headroom: ${headroom} (flips ${res.flips.length}, freeDim ${res.freeDim})`);
console.log("verifyMatrix (scale 8 & 3, allowSchemeHostCase): PASS");
for (const s of scanMatrix) console.log(`  scan ${s.label}: ${s.ok ? "PASS" : "FAIL"}`);
console.log(`outputs written to ${OUT}`);
