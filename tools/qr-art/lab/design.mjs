/*
 * The DESIGN half of the lab: a genome in, a tri-tone paint map out.
 *
 * A genome is a plain object of numbers/strings — everything the GA is allowed
 * to move. renderDesign() turns one into exactly what the studio's brush would
 * have produced: `target` (1 dark / 0 light) plus `weight` (0 = don't care, the
 * free noise tone), and a `tier` map the fitness function scores against.
 *
 * Tiers, high to low: 4 glyph ink, 3 the one-module halo that keeps a letter
 * off the noise, 2 rule/spoke ink, 1 the white field. 0 is the ground and is
 * never painted — that gray IS the picture's third tone.
 */
import { QR } from "./engine.mjs";

// ---------------- bitmap fonts ----------------
// Each glyph is rows of "#" ink / " " paper. Height is uniform per family.
export const FONTS = {
  // 5 tall, one-module stroke — at 41 modules a stroke is ~20% of cap height,
  // which reads BOLD even though it is one pixel.
  t5: {
    height: 5,
    glyphs: {
      H: ["#  #", "#  #", "####", "#  #", "#  #"],
      E: ["####", "#   ", "####", "#   ", "####"],
      X: ["#   #", " # # ", "  #  ", " # # ", "#   #"],
      F: ["####", "#   ", "####", "#   ", "#   "],
      L: ["#   ", "#   ", "#   ", "#   ", "####"],
      " ": ["  ", "  ", "  ", "  ", "  "],
    },
  },
  // 5 tall, narrow — the tightest legible cut, buys two modules per word.
  n5: {
    height: 5,
    glyphs: {
      H: ["# #", "# #", "###", "# #", "# #"],
      E: ["###", "#  ", "###", "#  ", "###"],
      X: ["# #", "# #", " # ", "# #", "# #"],
      F: ["###", "#  ", "###", "#  ", "#  "],
      L: ["#  ", "#  ", "#  ", "#  ", "###"],
      " ": ["  ", "  ", "  ", "  ", "  "],
    },
  },
  // 5 tall with a squared X — the X that reads as a letter, not a bowtie.
  s5: {
    height: 5,
    glyphs: {
      H: ["#  #", "#  #", "####", "#  #", "#  #"],
      E: ["####", "#   ", "####", "#   ", "####"],
      X: ["##  ##", " #### ", "  ##  ", " #### ", "##  ##"],
      F: ["####", "#   ", "####", "#   ", "#   "],
      L: ["#   ", "#   ", "#   ", "#   ", "####"],
      " ": ["  ", "  ", "  ", "  ", "  "],
    },
  },
  // 7 tall, two-module stems — poster stencil. Costs rows, buys presence.
  b7: {
    height: 7,
    glyphs: {
      H: ["##   ##", "##   ##", "##   ##", "#######", "#######", "##   ##", "##   ##"],
      E: ["#######", "#######", "##     ", "###### ", "###### ", "#######", "#######"],
      X: ["##   ##", " ## ## ", "  ###  ", "   #   ", "  ###  ", " ## ## ", "##   ##"],
      F: ["#######", "#######", "##     ", "###### ", "###### ", "##     ", "##     "],
      L: ["##     ", "##     ", "##     ", "##     ", "##     ", "#######", "#######"],
      " ": ["   ", "   ", "   ", "   ", "   ", "   ", "   "],
    },
  },
  // 6 tall, two-module stems — the compromise cut.
  b6: {
    height: 6,
    glyphs: {
      H: ["## ##", "## ##", "#####", "#####", "## ##", "## ##"],
      E: ["#####", "##   ", "#### ", "#### ", "##   ", "#####"],
      X: ["## ##", "## ##", " ### ", " ### ", "## ##", "## ##"],
      F: ["#####", "##   ", "#### ", "#### ", "##   ", "##   "],
      L: ["##   ", "##   ", "##   ", "##   ", "##   ", "#####"],
      " ": ["   ", "   ", "   ", "   ", "   ", "   "],
    },
  },
};

/*
 * How many separate pieces a word breaks into under 4-connectivity.
 *
 * This is the one thing about a letterform that module resolution decides for
 * you. A one-module diagonal X is a perfectly good X on paper and five loose
 * squares at 41 modules — the word reads "HE.", and the squares look like
 * noise that leaked into the white field. Diagonal contact is not contact
 * here, so 4-connectivity is the test, and a glyph that fails it is not a
 * narrower letter, it is a broken one.
 */
export function glyphPieces(font, words) {
  const F = FONTS[font];
  let extra = 0;
  for (const ch of new Set(words.replace(/\|/g, ""))) {
    const rows = F.glyphs[ch];
    if (!rows) continue;
    const h = rows.length, w = rows[0].length;
    const seen = new Uint8Array(h * w);
    let pieces = 0;
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        if (rows[r][c] !== "#" || seen[r * w + c]) continue;
        pieces++;
        const stack = [[r, c]];
        seen[r * w + c] = 1;
        while (stack.length) {
          const [y, x] = stack.pop();
          for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const yy = y + dy, xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
            if (rows[yy][xx] !== "#" || seen[yy * w + xx]) continue;
            seen[yy * w + xx] = 1;
            stack.push([yy, xx]);
          }
        }
      }
    if (pieces > 1) extra += pieces - 1;
  }
  return extra;
}

export function glyphWidth(font, ch) {
  return FONTS[font].glyphs[ch][0].length;
}
export function textWidth(font, word, letterSpace) {
  let w = 0;
  for (let i = 0; i < word.length; i++) w += glyphWidth(font, word[i]) + (i ? letterSpace : 0);
  return w;
}

// ---------------- geometry ----------------
// Flat-top regular hexagon: vertices left/right, horizontal top and bottom
// edges — the orientation in the reference art. `squash` stretches it
// vertically so a wide word can still be centred in a tall symbol.
// 1.0 exactly on the boundary: the |y| edge is the flat top/bottom, the other
// term is the pair of slanted sides.
function hexNorm(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  return Math.max(ay / (Math.sqrt(3) / 2), ax + ay / Math.sqrt(3));
}
function hexNormPointy(dx, dy) {
  return hexNorm(dy, dx);
}

// How far out a module sits, in units of the hexagon's own radius: 1.0 is the
// boundary. The layout repair and the ground sculptor both measure with this.
export function hexRadiusAt(g, r, c) {
  const f = g.pointy ? hexNormPointy : hexNorm;
  return f(c + 0.5 - g.cx, (r + 0.5 - g.cy) / (g.squash || 1));
}

/*
 * A hexagon built for a module grid rather than sampled onto one.
 *
 * The continuous hexagon is defined by an inequality and whatever falls out
 * of rounding it is the edge — at 41 modules that is a ragged staircase with
 * a different rhythm on every side, and the six-triangle face made out of it
 * read as a bowtie. This one is defined by its SLOPE: half-width W, and
 * slanted sides that rise `slope` for every 1 they run. Pick slope 2 and
 * every side, and every long diagonal, is the same clean 1:2 staircase — a
 * regular hexagon's slope is sqrt(3), so 2 is barely taller and rasterises
 * exactly. Height follows from the slope; it is not a free parameter.
 *
 * The long diagonals are the point. In any hexagon each one runs vertex to
 * opposite vertex through the centre and is PARALLEL to two of the sides —
 * which is why fixing the side slope fixes the spokes for free, and why the
 * face comes out as six equal triangles instead of a knot.
 */
export function crispHex(g) {
  const W = g.R;                       // half-width: the left and right points
  const s = g.slope || 2;
  const H = (s * W) / 2;               // half-height, forced by the slope
  return {
    W, H, s,
    inside: (dx, dy) => Math.abs(dy) <= H + 1e-9 && Math.abs(dy) <= s * (W - Math.abs(dx)) + 1e-9,
    // 1.0 on the boundary, for the ground sculptor's priority order
    norm: (dx, dy) => Math.max(Math.abs(dy) / H, (Math.abs(dy) / s + Math.abs(dx)) / W),
    // three diameters: flat, and the two parallel to the slanted sides. The
    // threshold is measured ACROSS the line's fast axis, so each one is
    // exactly `t` modules wide however steep it is, and they meet in a single
    // module at the centre instead of a blob.
    onSpoke: (dx, dy, t) =>
      Math.abs(dy) <= t / 2 ||
      Math.abs(dx - dy / s) <= t / 2 ||
      Math.abs(dx + dy / s) <= t / 2,
  };
}

// A honeycomb of small hexagons. Neighbours of a flat-top cell sit at
// (0, +/-2H) across the flat edges and (+/-1.5W, +/-H) across the slanted
// ones; `gap` pushes them apart so the dark ground shows between.
export function honeycomb(g) {
  const { W, H } = crispHex(g);
  const k = 1 + (g.cellGap || 0) / Math.max(1, W);
  const steps = [[0, 2 * H], [1.5 * W, H], [1.5 * W, -H], [0, -2 * H], [-1.5 * W, -H], [-1.5 * W, H]];
  const cells = [[0, 0]];
  const seen = new Set(["0,0"]);
  for (let ring = 0; ring < (g.cellRings || 1); ring++) {
    for (const [x, y] of [...cells]) {
      for (const [sx, sy] of steps) {
        const nx = +(x + sx * k).toFixed(3), ny = +(y + sy * k).toFixed(3);
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push([nx, ny]);
      }
    }
  }
  return cells;
}

export const DEFAULT_GENOME = {
  mode: "both",           // both | shapes | text | banner | flexface | cluster
  slope: 2,               // slanted-side rise per run; 2 rasterises exactly
  spokeWidth: 1,          // flexface: thickness of the six crease lines
  cellRings: 1,           // cluster: 1 ring = 7 cells, 2 = 19
  cellGap: 2,             // cluster: dark modules between neighbours
  invert: 0,              // 1 = letters knocked WHITE out of a dark halo
  version: 6,
  level: "L",
  font: "t5",
  words: "HEX|HEX|FLEX",
  letterSpace: 1,
  lineSpace: 2,
  cx: 20.5, cy: 20.5,     // hexagon centre, module units
  R: 14,                  // circumradius, module units
  squash: 1.0,            // >1 taller
  pointy: 0,              // 1 = pointy-top hexagon
  tx: 0, ty: 0,           // text offset from hexagon centre
  halo: 1,                // rings of protected white around ink
  outline: 0,             // dark hexagon rule, thickness in modules
  outlineGap: 1,          // white gap between rule and field edge
  ring: 0,                // dark ring painted OUTSIDE the hexagon (crisp silhouette)
  ground: "dense",        // free-noise treatment: dense | rings | halo | free
  ringPeriod: 4, haloBand: 4,
  spokes: 0,              // shapes mode: 6 triangles from centre
  innerR: 0,              // shapes mode: nested hexagon
  urlCase: "schemehost",  // "none" keeps the link's typed capitalisation
  margin: 0.5, marginCap: 0.8,
  mask: -1,               // -1 = search all 8
  flipSeed: 0,
  noiseSeed: 0,
};

export function renderDesign(g) {
  const size = QR.sizeOf(g.version);
  const { func } = QR.functionPatterns(g.version);
  const target = new Uint8Array(size * size);
  const weight = new Float64Array(size * size);
  const tier = new Uint8Array(size * size);
  const glyphInk = new Uint8Array(size * size);
  const seenIntrusion = new Uint8Array(size * size); // function modules the shape wanted

  // Furniture the shape wants but cannot have, split by how much it hurts.
  // A timing strip crossing a white field reads as a dashed RULE — the
  // reference art parks its hexagon's top edge on one. A finder ring or an
  // alignment square in the middle of the picture is just a hole.
  let intrusionTiming = 0, intrusionHard = 0;
  const put = (r, c, dark, t) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    const i = r * size + c;
    if (func[i]) {
      if (t >= 1 && !seenIntrusion[i]) {
        seenIntrusion[i] = 1;
        if (r === 6 || c === 6) intrusionTiming++; else intrusionHard++;
      }
      return;
    }
    if (tier[i] >= t) return;
    tier[i] = t;
    target[i] = dark ? 1 : 0;
  };

  const norm = g.pointy ? hexNormPointy : hexNorm;
  const inHex = (r, c, rad) => norm((c + 0.5 - g.cx), (r + 0.5 - g.cy) / g.squash) <= rad;

  // How far out a module sits from the shape, 1.0 on its boundary. The ground
  // sculptor works outward from this, so each mode has to answer for its own
  // geometry — a cluster's boundary is the nearest cell's, not the group's.
  const cell = crispHex(g);
  const cells = g.mode === "cluster" ? honeycomb(g) : null;
  let shapeNorm;
  if (g.mode === "flexface") {
    shapeNorm = (r, c) => cell.norm(c + 0.5 - g.cx, r + 0.5 - g.cy);
  } else if (g.mode === "cluster") {
    shapeNorm = (r, c) => Math.min(...cells.map(([x, y]) =>
      cell.norm(c + 0.5 - g.cx - x, r + 0.5 - g.cy - y)));
  } else {
    shapeNorm = (r, c) => norm(c + 0.5 - g.cx, (r + 0.5 - g.cy) / g.squash) / (g.R || 1);
  }

  // ---- the crisp-geometry modes ----
  if (g.mode === "flexface" || g.mode === "cluster") {
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) {
        const dy = r + 0.5 - g.cy, dx = c + 0.5 - g.cx;
        if (g.mode === "cluster") {
          for (const [x, y] of cells) if (cell.inside(dx - x, dy - y)) { put(r, c, 0, 1); break; }
        } else if (cell.inside(dx, dy)) {
          // white paper, then the six creases folded across it
          put(r, c, 0, 1);
          if (cell.onSpoke(dx, dy, g.spokeWidth || 1)) put(r, c, 1, 2);
        }
      }
  }

  // ---- field ----
  if (g.mode !== "text" && g.mode !== "flexface" && g.mode !== "cluster") {
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (inHex(r, c, g.R)) put(r, c, 0, 1);
  }

  // ---- shapes: nested hexagon + the six triangles of a flexagon face ----
  if (g.mode === "shapes") {
    if (g.innerR > 0) {
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++) {
          const d = norm(c + 0.5 - g.cx, (r + 0.5 - g.cy) / g.squash);
          if (d <= g.innerR && d > g.innerR - 1) put(r, c, 1, 2);
        }
    }
    if (g.spokes) {
      // THREE diameters, vertex to opposite vertex — not six rays out of the
      // middle, which meet in a four-module knot exactly where the star point
      // has to be crisp. In pointy-top orientation these cut the hexagon into
      // six EQUAL triangles: a flexagon's own crease pattern.
      for (let k = 0; k < 3; k++) {
        const a = (Math.PI / 3) * k + (g.pointy ? Math.PI / 6 : 0);
        const dx = Math.cos(a), dy = Math.sin(a) * g.squash;
        const steps = Math.ceil(g.R * 3);
        for (let t = -steps; t <= steps; t++) {
          const d = (t / steps) * g.R;
          const r = Math.round(g.cy + dy * d - 0.5);
          const c = Math.round(g.cx + dx * d - 0.5);
          if (inHex(r, c, g.R)) put(r, c, 1, 2);
        }
      }
    }
  }

  // ---- outline rule inside the field ----
  if (g.outline > 0 && g.mode !== "text") {
    const outer = g.R - g.outlineGap;
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) {
        const d = norm(c + 0.5 - g.cx, (r + 0.5 - g.cy) / g.squash);
        if (d <= outer && d > outer - g.outline) put(r, c, 1, 2);
      }
  }

  // ---- dark ring hugging the outside: makes the silhouette crisp ----
  if (g.ring > 0 && g.mode !== "text") {
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) {
        const d = norm(c + 0.5 - g.cx, (r + 0.5 - g.cy) / g.squash);
        if (d > g.R && d <= g.R + g.ring) put(r, c, 1, 2);
      }
  }

  // ---- text ----
  const lines = g.mode === "flexface" || g.mode === "cluster"
    ? [] : g.words.split("|").filter(Boolean);
  const F = FONTS[g.font];
  const blockH = lines.length * F.height + (lines.length - 1) * g.lineSpace;
  // banner: the words sit BELOW the shape on the ground, knocked out of it,
  // so the hexagon gets to be as clean as a shape-only design and the type
  // gets to be as bold as a text-only one. Neither has to shrink for the other.
  const hexHalf = (g.R || 0) * (Math.sqrt(3) / 2) * (g.squash || 1);
  const anchor = g.mode === "banner" ? g.cy + hexHalf + 1 + blockH / 2 : g.cy;
  const top = Math.round(anchor + g.ty - blockH / 2);
  const glyphCells = [];
  if (g.mode !== "shapes") {
    lines.forEach((word, li) => {
      const w = textWidth(g.font, word, g.letterSpace);
      // every line rounds the SAME way, so stems on different lines land on
      // the same sub-module phase and the block reads as one centred column
      let x = Math.round(g.cx + g.tx) - (w >> 1);
      const y = top + li * (F.height + g.lineSpace);
      for (const ch of word) {
        const rows = F.glyphs[ch];
        for (let rr = 0; rr < rows.length; rr++)
          for (let cc = 0; cc < rows[rr].length; cc++)
            if (rows[rr][cc] === "#") glyphCells.push([y + rr, x + cc]);
        x += rows[0].length + g.letterSpace;
      }
    });
  }
  // text mode paints its own white plate: the block plus padding.
  if ((g.mode === "text" || (g.mode === "banner" && !g.invert)) && glyphCells.length) {
    let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
    for (const [r, c] of glyphCells) {
      r0 = Math.min(r0, r); r1 = Math.max(r1, r);
      c0 = Math.min(c0, c); c1 = Math.max(c1, c);
    }
    const p = Math.max(1, g.halo);
    for (let r = r0 - p; r <= r1 + p; r++)
      for (let c = c0 - p; c <= c1 + p; c++) put(r, c, 0, 1);
  }
  const inkDark = g.invert ? 0 : 1;
  for (const [r, c] of glyphCells) {
    put(r, c, inkDark, 4);
    if (r >= 0 && c >= 0 && r < size && c < size) glyphInk[r * size + c] = 1;
  }
  // halo: white modules within `halo` of ink, promoted above plain field
  if (g.halo > 0) {
    const h = g.halo;
    for (const [r, c] of glyphCells)
      for (let dr = -h; dr <= h; dr++)
        for (let dc = -h; dc <= h; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          const i = rr * size + cc;
          if (tier[i] === 4) continue;
          if (tier[i] === 0 && !g.haloOutside && g.mode !== "text" && g.mode !== "banner") continue;
          put(rr, cc, 1 - inkDark, 3);
        }
  }

  const W = { 1: 1, 2: 3, 3: 6, 4: 12 };
  for (let i = 0; i < size * size; i++) weight[i] = W[tier[i]] || 0;

  // paint order: highest tier first (the solver pins in this order)
  const order = [];
  for (let i = 0; i < size * size; i++) if (weight[i] > 0) order.push(i);
  order.sort((a, b) => tier[b] - tier[a] || a - b);
  const seq = new Int32Array(size * size).fill(1 << 29);
  order.forEach((mi, k) => { seq[mi] = k; });

  return {
    size, target, weight, tier, func, order, seq,
    glyphInk, glyphCells, blockH, intrusionTiming, intrusionHard, font: F, shapeNorm,
  };
}
