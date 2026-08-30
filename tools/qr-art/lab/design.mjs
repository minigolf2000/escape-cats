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
    },
  },
};

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

export const DEFAULT_GENOME = {
  mode: "both",           // both | shapes | text
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

  // ---- field ----
  if (g.mode !== "text") {
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
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + (g.pointy ? Math.PI / 6 : 0);
        for (let t = 0; t <= g.R * 12; t++) {
          const d = (t / 12);
          const x = g.cx + Math.cos(a) * d;
          const y = g.cy + Math.sin(a) * d * g.squash;
          const r = Math.floor(y), c = Math.floor(x);
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
  const lines = g.words.split("|").filter(Boolean);
  const F = FONTS[g.font];
  const blockH = lines.length * F.height + (lines.length - 1) * g.lineSpace;
  const top = Math.round(g.cy + g.ty - blockH / 2);
  const glyphCells = [];
  if (g.mode !== "shapes") {
    lines.forEach((word, li) => {
      const w = textWidth(g.font, word, g.letterSpace);
      let x = Math.round(g.cx + g.tx - w / 2);
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
  if (g.mode === "text" && glyphCells.length) {
    let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
    for (const [r, c] of glyphCells) {
      r0 = Math.min(r0, r); r1 = Math.max(r1, r);
      c0 = Math.min(c0, c); c1 = Math.max(c1, c);
    }
    const p = Math.max(1, g.halo);
    for (let r = r0 - p; r <= r1 + p; r++)
      for (let c = c0 - p; c <= c1 + p; c++) put(r, c, 0, 1);
  }
  for (const [r, c] of glyphCells) {
    put(r, c, 1, 4);
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
          if (tier[i] === 0 && g.mode !== "text") continue; // don't paint the ground
          put(rr, cc, 0, 3);
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
    glyphInk, glyphCells, blockH, intrusionTiming, intrusionHard, font: F,
  };
}
