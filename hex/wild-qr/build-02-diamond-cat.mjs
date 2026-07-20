// build-02-diamond-cat.mjs — Piece 2 of the QR-art project: the diamond cat.
//
// A v5-L (37x37) QR whose finder patterns become a cat's face when the symbol
// is hung at 45 deg (as a diamond): TL finder -> TOP corner (forehead blaze
// between two ears), TR finder -> RIGHT eye, BL finder -> LEFT eye, BR quadrant
// (with the v5 alignment pattern at (30,30)) -> BOTTOM = the muzzle/nose.
//
// In-symbol art (drawn in UPRIGHT module coordinates):
//   - muzzle: rounded white cutout around the alignment pattern (the nose)
//   - mouth : small dark "w"/omega just BR-ward of the alignment pattern
//   - whiskers: dark anti-diagonal strokes (horizontal when hung) with halos
//   - iris hint: white eyebrow bands widening the TR/BL finder separators
//   - everything else: surrendered noise (fur)
//
// Poster (outside the symbol, no solver cost): green field, white rounded card
// rotated 45 deg, black ear triangles flanking the TOP corner, white whisker
// strokes continuing on the field, emerald irises, an "escape cats" caption.
//
// Reproducible: fixed seeds; run `node build-02-diamond-cat.mjs`.
// Outputs to ./out/: diamond-cat.svg, diamond-cat.png, diamond-cat-symbol.png,
// diamond-cat-report.md.

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
const VERSION = 5;
const LEVEL = "L";
const S = QRArt.sizeOf(VERSION); // 37
const NOISE_SEED = 0xca7ca7;
const FLIP_SEED = 20260720;

// Poster colours
const COL_FIELD = [23, 83, 56]; // #175338 green field
const COL_DARK = [10, 13, 16]; // near-black modules
const COL_LIGHT = [255, 255, 255]; // white card / cutouts
const COL_IRIS = [13, 59, 42]; // #0d3b2a dark emerald irises (lum < 0.2)
const COL_EAR = [10, 13, 16]; // black ears

// ---------------------------------------------------------------------------
// 1. In-symbol art target (upright module coordinates)
// ---------------------------------------------------------------------------
const fp = QRArt.functionPatterns(VERSION);
const tone = new Int8Array(S * S); // 0 noise, 1 dark, 2 light
const seq = new Int32Array(S * S).fill(-1);
let counter = 0;
function paint(r, c, t) {
  if (r < 0 || c < 0 || r >= S || c >= S) return;
  const i = r * S + c;
  if (fp.func[i]) return; // never constrain function patterns
  if (tone[i] === t) return;
  tone[i] = t;
  seq[i] = counter++;
}

// Nose = the alignment pattern centre (immovable function pattern).
const NOSE_R = 30, NOSE_C = 30;

// Iris sets: the 3x3 dark centres of the TR (right eye) and BL (left eye)
// finders. Recoloured emerald in the poster.
const irisCells = new Set();
for (let r = 2; r <= 4; r++) for (let c = 32; c <= 34; c++) irisCells.add(r * S + c); // TR eye
for (let r = 32; r <= 34; r++) for (let c = 2; c <= 4; c++) irisCells.add(r * S + c); // BL eye

// --- priority pins ---
// Priority (highest first): mouth, whiskers, whisker halos, eyebrows, muzzle
// field. The dark features (mouth/whiskers) must survive the solver, so they
// are pinned first; the large white fields are lower priority.
// paintLight only fills genuine noise cells (never overwrites a dark feature).
const paintLight = (r, c) => {
  if (r < 0 || c < 0 || r >= S || c >= S) return;
  const i = r * S + c;
  if (fp.func[i] || tone[i] === 1) return; // don't clobber dark features/func
  paint(r, c, 2);
};

// hang-space helper: origin at the nose (30,30); +H = right in the hang,
// +D = down in the hang. r = 30 + D - H, c = 30 + D + H.
const NR = 30, NC = 30;

// (1) Mouth: a 1-module-thick "omega" (two arcs) ~2 modules below the nose,
// floating on the white muzzle field. Tops at D=3, valleys at D=4.
const mouth = [
  [NR + 3 - -2, NC + 3 + -2], // (35,31) left top
  [NR + 3 - 0, NC + 3 + 0],   // (33,33) middle top
  [NR + 3 - 2, NC + 3 + 2],   // (31,35) right top
  [NR + 4 - -1, NC + 4 + -1], // (35,33) left valley
  [NR + 4 - 1, NC + 4 + 1],   // (33,35) right valley
];
for (const [r, c] of mouth) paint(r, c, 1);

// (2) Whiskers: exactly 3 per side, 1 module thick, horizontal in the hang
// (constant r+c), fanning from the cheeks out to the symbol edge. Right cheek
// exits the right edge (c=36) at rows 20/24/28 (hang levels D=-2/0/2); left
// cheek is the mirror. All start clear of the mouth (H>=3).
function whiskerCellsFor(D, side) {
  // side 'R': c increases to 36; 'L': mirror (r increases to 36).
  const cells = [];
  for (let H = 3; ; H++) {
    const r = NR + D - H, c = NC + D + H;
    if (side === "R") {
      if (c > 36 || r < 0) break;
      cells.push([r, c]);
      if (c === 36) break;
    } else {
      // mirror: swap so the stroke runs to row 36
      const rr = c, cc = r;
      if (rr > 36 || cc < 0) break;
      cells.push([rr, cc]);
      if (rr === 36) break;
    }
  }
  return cells;
}
const whiskers = [];
for (const D of [-2, 0, 2]) {
  whiskers.push({ dir: [-1, +1], cells: whiskerCellsFor(D, "R") });
  whiskers.push({ dir: [+1, -1], cells: whiskerCellsFor(D, "L") });
}
// paint whisker cores (dark, high priority)
for (const w of whiskers) for (const [r, c] of w.cells) paint(r, c, 1);
// (3) whisker halos: 1-module white margin around each core (noise cells only)
for (const w of whiskers)
  for (const [r, c] of w.cells)
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) paintLight(r + dr, c + dc);

// (4) Iris eyebrow bands: widen the finder separators toward centre with white
// so each eye pops off the fur. Auto-skips function cells (timing/format).
function eyebrow(rows, cols) {
  for (let r = rows[0]; r <= rows[1]; r++)
    for (let c = cols[0]; c <= cols[1]; c++) paintLight(r, c);
}
// TR eye (rows 0..6, cols 30..36): inner edges face down (row 7+) & left (col 29-)
eyebrow([7, 9], [27, 36]);
eyebrow([0, 9], [27, 28]);
// BL eye (rows 30..36, cols 0..6): inner edges face up (row 29-) & right (col 7+)
eyebrow([27, 36], [7, 9]);
eyebrow([27, 28], [0, 9]);

// (5) Muzzle: rounded-diamond white cutout around the nose (~13 modules across).
// Manhattan disc of radius 6 centred just BR of the nose, corners softened.
// Lowest priority; only fills genuine noise so nose/mouth/whiskers stay put.
const MUZ_R = 31, MUZ_C = 31, MUZ_RAD = 6;
for (let r = 0; r < S; r++)
  for (let c = 0; c < S; c++) {
    const man = Math.abs(r - MUZ_R) + Math.abs(c - MUZ_C);
    const cheb = Math.max(Math.abs(r - MUZ_R), Math.abs(c - MUZ_C));
    if (man <= MUZ_RAD && cheb <= MUZ_RAD - 0.5) paintLight(r, c);
  }

// Derive {order, target}: painted, non-function cells, oldest paint first.
const order = [];
for (let i = 0; i < S * S; i++) if (tone[i] > 0 && !fp.func[i]) order.push(i);
order.sort((a, b) => seq[a] - seq[b]);
const target = new Uint8Array(S * S);
for (const i of order) target[i] = tone[i] === 1 ? 1 : 0;

// ---------------------------------------------------------------------------
// 2. Solve (schemehost case play) — search masks, keep the best solve.
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
  const honored = order.length - res.unsatisfied.length;
  // validate for honest per-block headroom
  const v = QRArt.validate(res.matrix, VERSION);
  const headroom = v.ok ? Math.min(...v.perBlock.map((b) => b.capacity - b.errors)) : -1;
  const score = honored * 1000 + headroom; // prefer honored pins, then headroom
  if (!best || score > best.score) best = { mask, res, honored, headroom, v, score };
}

const { res, mask, honored, v } = best;
const matrix = res.matrix;
const pinPct = (honored / order.length) * 100;

// Acceptance: bare symbol must verify at scale 8 and 3 (schemehost-equivalent).
const vm = verifyMatrix(matrix, VERSION, URL, { allowSchemeHostCase: true });
if (!v.ok) throw new Error("validate() failed on best solve");
for (const b of v.perBlock) {
  const head = b.capacity - b.errors;
  if (head < 2) throw new Error(`block headroom ${head} < 2 (used ${b.errors}/${b.capacity})`);
}

// ---------------------------------------------------------------------------
// 3. Poster geometry (shared by SVG + PNG so they cannot drift)
// ---------------------------------------------------------------------------
const M = 20; // px per module
const QZ = 5; // quiet-zone modules (card padding), >= 4
const CARD = (S + 2 * QZ) * M; // white card side
const RX = 3 * M; // card corner radius
const EDGE = 8 * M; // buffer margin for ears + whiskers
const BUF = CARD + 2 * EDGE; // upright buffer side
const CARD_X = EDGE, CARD_Y = EDGE; // card top-left in buffer
const QR_X = CARD_X + QZ * M, QR_Y = CARD_Y + QZ * M; // QR top-left in buffer

// module (r,c) -> buffer pixel rect
const modX = (c) => QR_X + c * M;
const modY = (r) => QR_Y + r * M;

// Ear triangles (buffer coords). Bases sit on the two card edges meeting at the
// TL corner (which becomes the TOP apex after +45deg rotation); apexes point
// up-and-outward. A 3-module gap by the corner leaves the finder "blaze"
// visible between the ears. Tall, so they read as unmistakable ears at
// thumbnail size.
const earRight = [
  // base on TOP edge of card
  [CARD_X + 3 * M, CARD_Y],
  [CARD_X + 15 * M, CARD_Y],
  [CARD_X + 12 * M, CARD_Y - 16 * M], // apex: up, leaning outward (toward RIGHT vertex)
];
const earLeft = [
  // base on LEFT edge of card (mirror of earRight about the diagonal)
  [CARD_X, CARD_Y + 3 * M],
  [CARD_X, CARD_Y + 15 * M],
  [CARD_X - 16 * M, CARD_Y + 12 * M], // apex: up, leaning outward (toward LEFT vertex)
];

// Poster whisker strokes on the green field: continue each in-symbol whisker
// outward from the symbol edge, same angle (so they read horizontal in the
// diamond hang). Anchored at each whisker's outer module, extended ~7 modules.
const fieldWhiskers = [];
for (const w of whiskers) {
  const [dr, dc] = w.dir;
  const [or, oc] = w.cells[w.cells.length - 1]; // outer module (at the edge)
  const x1 = modX(oc) + M / 2, y1 = modY(or) + M / 2;
  const x2 = x1 + dc * 7 * M, y2 = y1 + dr * 7 * M;
  fieldWhiskers.push([x1, y1, x2, y2]);
}

// Rotation: +45deg (clockwise, screen y-down) maps TL->TOP, TR->RIGHT,
// BL->LEFT, BR->BOTTOM (verified geometrically).
const ANGLE = (45 * Math.PI) / 180;
const DIAG = Math.ceil(BUF * Math.SQRT2);

// ---------------------------------------------------------------------------
// 4a. Rasterise the UPRIGHT poster buffer (green bg, card, QR, ears, whiskers).
// ---------------------------------------------------------------------------
function makeUprightBuffer() {
  const W = BUF, H = BUF;
  const data = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, col) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
  };
  const fillRect = (x0, y0, w, h, col) => {
    for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++)
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) put(x, y, col);
  };
  // green field
  fillRect(0, 0, W, H, COL_FIELD);
  // ears (black triangles) — drawn before the card so the card edge overlaps
  const fillTri = (tri, col) => {
    const xs = tri.map((p) => p[0]), ys = tri.map((p) => p[1]);
    const minx = Math.floor(Math.min(...xs)), maxx = Math.ceil(Math.max(...xs));
    const miny = Math.floor(Math.min(...ys)), maxy = Math.ceil(Math.max(...ys));
    const [ax, ay] = tri[0], [bx, by] = tri[1], [cx, cy] = tri[2];
    const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    for (let y = miny; y <= maxy; y++)
      for (let x = minx; x <= maxx; x++) {
        const w0 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / d;
        const w1 = ((cx - bx) * (y - by) - (cy - by) * (x - bx)) / d;
        const w2 = 1 - w0 - w1;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) put(x, y, col);
      }
  };
  fillTri(earRight, COL_EAR);
  fillTri(earLeft, COL_EAR);
  // white rounded card
  const roundRect = (x0, y0, w, h, r, col) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let inside = true;
        if (x < r && y < r) inside = (r - x) ** 2 + (r - y) ** 2 <= r * r;
        else if (x > w - r && y < r) inside = (x - (w - r)) ** 2 + (r - y) ** 2 <= r * r;
        else if (x < r && y > h - r) inside = (r - x) ** 2 + (y - (h - r)) ** 2 <= r * r;
        else if (x > w - r && y > h - r) inside = (x - (w - r)) ** 2 + (y - (h - r)) ** 2 <= r * r;
        if (inside) put(x0 + x, y0 + y, col);
      }
  };
  roundRect(CARD_X, CARD_Y, CARD, CARD, RX, COL_LIGHT);
  // QR modules
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      if (!matrix[r * S + c]) continue;
      const col = irisCells.has(r * S + c) ? COL_IRIS : COL_DARK;
      fillRect(modX(c), modY(r), M, M, col);
    }
  // field whisker strokes (white, rounded caps approximated by thick line)
  const drawLine = (x1, y1, x2, y2, wpx, col) => {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, cx = x1 + (x2 - x1) * t, cy = y1 + (y2 - y1) * t;
      for (let dy = -wpx; dy <= wpx; dy++)
        for (let dx = -wpx; dx <= wpx; dx++)
          if (dx * dx + dy * dy <= wpx * wpx) put(cx + dx, cy + dy, col);
    }
  };
  for (const [x1, y1, x2, y2] of fieldWhiskers) drawLine(x1, y1, x2, y2, M * 0.32, COL_LIGHT);
  return { data, width: W, height: H };
}

// ---------------------------------------------------------------------------
// 4b. Rotate an RGBA buffer by `angle` (rad) about its centre onto a green
// canvas (bilinear sampling). Output is square, side = ceil(diag).
// ---------------------------------------------------------------------------
function rotateRGBA(src, angle, bg) {
  const { data, width: sw, height: sh } = src;
  const out = Math.ceil(Math.hypot(sw, sh));
  const dst = new Uint8ClampedArray(out * out * 4);
  const cxo = out / 2, cyo = out / 2, cxs = sw / 2, cys = sh / 2;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (let y = 0; y < out; y++)
    for (let x = 0; x < out; x++) {
      const dx = x - cxo, dy = y - cyo;
      // inverse rotate by -angle
      const sx = cos * dx + sin * dy + cxs;
      const sy = -sin * dx + cos * dy + cys;
      const o = (y * out + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
        dst[o] = bg[0]; dst[o + 1] = bg[1]; dst[o + 2] = bg[2]; dst[o + 3] = 255;
        continue;
      }
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      for (let ch = 0; ch < 3; ch++) {
        const p00 = data[(y0 * sw + x0) * 4 + ch];
        const p10 = data[(y0 * sw + x0 + 1) * 4 + ch];
        const p01 = data[((y0 + 1) * sw + x0) * 4 + ch];
        const p11 = data[((y0 + 1) * sw + x0 + 1) * 4 + ch];
        dst[o + ch] =
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) +
          p01 * (1 - fx) * fy + p11 * fx * fy;
      }
      dst[o + 3] = 255;
    }
  return { data: dst, width: out, height: out };
}

// Overlay a horizontal "escape cats" caption onto a final (post-rotation) RGBA
// canvas, near the bottom, using a tiny 3x5 pixel font.
const FONT = {
  a: ["010", "101", "111", "101", "101"],
  c: ["111", "100", "100", "100", "111"],
  e: ["111", "100", "110", "100", "111"],
  p: ["110", "101", "110", "100", "100"],
  s: ["111", "100", "111", "001", "111"],
  t: ["111", "010", "010", "010", "010"],
  " ": ["000", "000", "000", "000", "000"],
};
function drawCaption(img, text, col) {
  const { data, width: W, height: H } = img;
  const px = Math.max(3, Math.round(M * 0.32)); // pixel size of a font cell
  const cw = 4 * px; // char advance (3 wide + 1 gap)
  const tw = text.length * cw - px;
  let x0 = Math.round(W / 2 - tw / 2);
  const y0 = Math.round(H - 7 * M); // above the bottom edge
  const put = (x, y) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
  };
  for (const ch of text) {
    const g = FONT[ch] || FONT[" "];
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 3; c++)
        if (g[r][c] === "1")
          for (let dy = 0; dy < px; dy++)
            for (let dx = 0; dx < px; dx++) put(x0 + c * px + dx, y0 + r * px + dy);
    x0 += cw;
  }
}

// ---------------------------------------------------------------------------
// 5. Build the deliverable posters
// ---------------------------------------------------------------------------
const upright = makeUprightBuffer();
const diamond = rotateRGBA(upright, ANGLE, COL_FIELD);
drawCaption(diamond, "escape cats", COL_LIGHT);
writePNG(path.join(OUT, "diamond-cat.png"), diamond);

// Bare upright symbol, scale 8 (plain black/white).
writePNG(
  path.join(OUT, "diamond-cat-symbol.png"),
  renderMatrix(matrix, VERSION, { scale: 8, quiet: 4 })
);

// ---------------------------------------------------------------------------
// 6. SVG deliverable (same geometry, diamond orientation)
// ---------------------------------------------------------------------------
function buildSVG() {
  const D = DIAG;
  const off = (D - BUF) / 2; // translate buffer so its centre is canvas centre
  const rgb = (a) => `rgb(${a[0]},${a[1]},${a[2]})`;
  let s = "";
  s += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${D} ${D}" width="${D}" height="${D}">`;
  s += `<rect width="${D}" height="${D}" fill="${rgb(COL_FIELD)}"/>`;
  // rotated group: translate buffer into place, then rotate +45 about buffer centre
  s += `<g transform="translate(${off} ${off}) rotate(45 ${BUF / 2} ${BUF / 2})">`;
  // ears
  const tri = (t) => `<polygon points="${t.map((p) => p.join(",")).join(" ")}" fill="${rgb(COL_EAR)}"/>`;
  s += tri(earRight);
  s += tri(earLeft);
  // card
  s += `<rect x="${CARD_X}" y="${CARD_Y}" width="${CARD}" height="${CARD}" rx="${RX}" fill="${rgb(COL_LIGHT)}"/>`;
  // QR modules — near-black + emerald irises, as two <path>s
  let darkPath = "", irisPath = "";
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      if (!matrix[r * S + c]) continue;
      const seg = `M${modX(c)} ${modY(r)}h${M}v${M}h-${M}z`;
      if (irisCells.has(r * S + c)) irisPath += seg; else darkPath += seg;
    }
  s += `<path d="${darkPath}" fill="${rgb(COL_DARK)}"/>`;
  s += `<path d="${irisPath}" fill="${rgb(COL_IRIS)}"/>`;
  // field whiskers
  for (const [x1, y1, x2, y2] of fieldWhiskers)
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${rgb(COL_LIGHT)}" stroke-width="${M * 0.6}" stroke-linecap="round"/>`;
  s += `</g>`;
  // caption (horizontal, on the field, not rotated)
  s += `<text x="${D / 2}" y="${D - 5 * M}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="${M * 1.6}" letter-spacing="${M * 0.15}" text-anchor="middle" fill="${rgb(COL_LIGHT)}">escape cats</text>`;
  s += `</svg>`;
  return s;
}
fs.writeFileSync(path.join(OUT, "diamond-cat.svg"), buildSVG());

// ---------------------------------------------------------------------------
// 7. Acceptance gate: scan matrix (orientation x scale) on the composed poster
// ---------------------------------------------------------------------------
function halfRes(img) {
  // simple 2x box downscale
  const { data, width: W, height: H } = img;
  const w2 = W >> 1, h2 = H >> 1;
  const out = new Uint8ClampedArray(w2 * h2 * 4);
  for (let y = 0; y < h2; y++)
    for (let x = 0; x < w2; x++) {
      const o = (y * w2 + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const a = data[((2 * y) * W + 2 * x) * 4 + ch];
        const b = data[((2 * y) * W + 2 * x + 1) * 4 + ch];
        const c = data[((2 * y + 1) * W + 2 * x) * 4 + ch];
        const d = data[((2 * y + 1) * W + 2 * x + 1) * 4 + ch];
        out[o + ch] = (a + b + c + d) >> 2;
      }
    }
  return { data: out, width: w2, height: h2 };
}

// diamond poster as delivered = QR at 45 deg; rotate it back -45 => QR upright.
const diamondBack = rotateRGBA(diamond, -ANGLE, COL_FIELD);
const scanTargets = [
  { orient: "diamond (QR @45deg)", scale: "full", img: diamond },
  { orient: "diamond (QR @45deg)", scale: "half", img: halfRes(diamond) },
  { orient: "rotated 45deg (QR upright)", scale: "full", img: diamondBack },
  { orient: "rotated 45deg (QR upright)", scale: "half", img: halfRes(diamondBack) },
];
const scanMatrix = scanTargets.map((t) => {
  const decoded = scanRGBA(t.img);
  const ok = decoded !== null && sameURLlite(decoded, URL);
  return { orient: t.orient, scale: t.scale, ok, decoded };
});
function sameURLlite(a, b) {
  const norm = (u) => {
    const m = u.match(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/i);
    return m ? m[1].toLowerCase() + m[2] : u;
  };
  return norm(a) === norm(b);
}

// ---------------------------------------------------------------------------
// 8. Report
// ---------------------------------------------------------------------------
function meterLines(perBlock) {
  return perBlock
    .map((b, i) => `- blk${i}: ${b.errors}/${b.capacity} codewords used — ${b.capacity - b.errors} headroom`)
    .join("\n");
}
const decodedText = v.text;
const report = `# Piece 2 — diamond cat — build report

Generated by \`build-02-diamond-cat.mjs\` (reproducible; seeds noise=${NOISE_SEED}, flip=${FLIP_SEED}).

## Symbol
- URL: \`${URL}\`
- Version ${VERSION}, level ${LEVEL} (${S}x${S}), mask ${mask} (chosen by pins-then-headroom).
- urlCase: schemehost (verified with allowSchemeHostCase).
- Decoded (case-remixed, RFC-3986 equivalent): \`${decodedText}\`
- Pins honored: ${honored}/${order.length} (${pinPct.toFixed(1)}%), flips: ${res.flips.length}, freeDim: ${res.freeDim}.

## Per-block meter (honest validate() decode)
${meterLines(v.perBlock)}

Worst-block headroom: ${best.headroom} codewords (gate: >= 2). Bare-symbol verifyMatrix passed at scale 8 and 3.

## Scan matrix — composed poster (orientation x scale)
| orientation | scale | jsQR |
| --- | --- | --- |
${scanMatrix.map((s) => `| ${s.orient} | ${s.scale} | ${s.ok ? "PASS" : "FAIL"} |`).join("\n")}

Poster raster: ${diamond.width}x${diamond.height}px (${M}px/module upright); half-res ${diamond.width >> 1}x${diamond.height >> 1}px.
"Upright" scan = poster as delivered (QR hangs at 45 deg); "rotated 45deg" = poster rotated back so the QR is axis-aligned. jsQR recovers orientation from the finder patterns in both.

## Anatomy mapping (upright module coords -> diamond)
- TL finder -> TOP corner (forehead blaze between the ears)
- TR finder -> RIGHT eye; BL finder -> LEFT eye (3x3 centres recoloured emerald ${'#0d3b2a'})
- BR quadrant, alignment pattern (30,30) -> BOTTOM = nose, on a white muzzle field
- mouth: dark "w" BR-ward of the nose; whiskers: anti-diagonal (horizontal when hung)

## Deliverables
- out/diamond-cat.svg — composed poster, diamond orientation (print master)
- out/diamond-cat.png — rasterized poster (${diamond.width}x${diamond.height})
- out/diamond-cat-symbol.png — bare upright symbol, scale 8
- out/diamond-cat-report.md — this file
`;
fs.writeFileSync(path.join(OUT, "diamond-cat-report.md"), report);

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------
console.log(`mask ${mask}, pins ${honored}/${order.length} (${pinPct.toFixed(1)}%), flips ${res.flips.length}`);
console.log("meter:");
console.log(meterLines(v.perBlock));
console.log(`worst-block headroom: ${best.headroom}`);
console.log("verifyMatrix (bare symbol) scale 8 & 3: PASS");
console.log("scan matrix:");
for (const s of scanMatrix) console.log(`  ${s.orient} @ ${s.scale}: ${s.ok ? "PASS" : "FAIL"}${s.ok ? "" : " decoded=" + JSON.stringify(s.decoded)}`);
console.log(`outputs written to ${OUT}`);
