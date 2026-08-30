/*
 * The JUDGE half of the lab: run a genome through the studio's own solver and
 * score what came back.
 *
 * Scoring is deliberately MULTIPLICATIVE — ambition (how much hexagon and how
 * much letter the design dares to ask for) times quality (how much of that the
 * code actually granted). Additive scoring always converges on a tiny, perfect,
 * boring design; this form makes a broken letter cost more than a small one.
 */
import { QR } from "./engine.mjs";
import { renderDesign } from "./design.mjs";

const prepCache = new Map();
export function prepFor(text, version, level, urlCase = "schemehost") {
  const key = `${text}|${version}|${level}|${urlCase}`;
  let p = prepCache.get(key);
  if (!p) {
    p = QR.prepareArt(text, version, level, urlCase);
    prepCache.set(key, p);
  }
  return p;
}

// cost per unsatisfied module, by tier. A letter that breaks is the whole
// design failing; a speck in the white field is a speck.
const TIER_COST = { 4: 42, 3: 13, 2: 6, 1: 2.2 };
const K = 46; // quality falls off as exp(-cost/K): one broken glyph module ≈ x0.40
// A white shape big enough to swallow the ground stops being a shape. The
// reference art gives its hexagon about 30% of the symbol and lets the free
// noise be the other 70%; past this cap extra area earns nothing and still
// costs pins, so the design settles instead of eating the code.
const AREA_CAP_FRAC = 0.42;

export function evaluate(g, url, opts = {}) {
  const minHeadroom = opts.minHeadroom ?? 2;
  const d = renderDesign(g);
  const size = d.size;

  // Ink the design asked for but that lands outside its own white field is a
  // letter sitting on the noise — always a defect, never a solver problem.
  let strayInk = 0;
  if (g.mode !== "text") {
    for (const [r, c] of d.glyphCells) {
      if (r < 0 || c < 0 || r >= size || c >= size) { strayInk += 2; continue; }
      const i = r * size + c;
      if (d.tier[i] !== 4) strayInk++;             // swallowed by a function pattern
      else if (!insideField(d, g, r, c)) strayInk++;
    }
  }

  const prep = prepFor(url, g.version, g.level, g.urlCase || "schemehost");
  const masks = g.mask >= 0 ? [g.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
  let best = null;
  for (const m of masks) {
    const res = QR.solveArt(prep, {
      order: d.order, target: d.target, mask: m, seq: d.seq,
      margin: g.margin, marginCap: g.marginCap, flipSeed: g.flipSeed,
    });
    const met = measure(d, res);
    if (!best || met.cost < best.met.cost) best = { res, met, mask: m };
  }

  const { res, met } = best;
  // The ground is sculpted as part of the EVALUATION, not as a pretty-print
  // afterthought: how crisply the shape's edge reads is a property of the
  // design, and a design the GA cannot see it cannot select for.
  sculptGroundExact(d, g, res.matrix, res.noiseBasis);
  met.edgeMiss = edgeMiss(d, res.matrix);
  met.ground = +darkFraction(d, res.matrix).toFixed(3);

  const capArea = AREA_CAP_FRAC * size * size;
  // Ink is the message, so it is worth six times its area in shape.
  const ambition = Math.min(met.fieldArea, capArea) + 6 * met.inkArea;
  // A code whose readback still spells the URL the way a human typed it is
  // worth a hair more than one that spent the host's case bits, all else equal.
  const caseBonus = (g.urlCase || "schemehost") === "none" ? 1.04 : 1;
  // A finder square or timing strip poking through the white field is a hole
  // in the picture that no amount of solving can close.
  const centre = (size - 1) / 2;
  const offCentre = g.mode === "text" ? 0 : Math.abs(g.cx - centre - 0.5) + Math.abs(g.cy - centre - 0.5);
  const quality = Math.exp(-(met.cost + 20 * strayInk + 1.5 * met.intrusionTiming + 12 * met.intrusionHard +
    2.5 * offCentre + 2.2 * met.edgeMiss) / K);
  let fitness = ambition * quality * caseBonus;

  // Hard gates: it has to scan, and it has to scan as the right URL.
  const v = QR.validate(res.matrix, g.version, {});
  const scans = v.ok && sameURL(v.text, url);
  if (!scans) fitness = -1;
  else if (res.headroom < minHeadroom) fitness = -1;

  return {
    fitness, genome: g, design: d, res, matrix: res.matrix, mask: best.mask,
    metrics: { ...met, strayInk, ambition, quality, headroom: res.headroom, scans, decoded: v.text },
  };
}

/*
 * RFC 3986: scheme and host are case-insensitive, the path is not. The solver
 * spends host case bits as free variables, so the readback can come back
 * SHOUTING and still be the same link — but a flipped path character is a
 * different video.
 */
export function sameURL(a, b) {
  if (a === b) return true;
  if (typeof a !== "string") return false;
  const split = (u) => {
    const s = u.indexOf("://");
    if (s < 0) return null;
    const slash = u.indexOf("/", s + 3);
    return slash < 0 ? [u, ""] : [u.slice(0, slash), u.slice(slash)];
  };
  const A = split(a), B = split(b);
  if (!A || !B) return false;
  return A[0].toLowerCase() === B[0].toLowerCase() && A[1] === B[1];
}

function insideField(d, g, r, c) {
  // the glyph's own module was painted tier 4; check its neighbours are field,
  // i.e. the letter is not hanging off the edge of the white shape
  const size = d.size;
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) return false;
      const j = rr * size + cc;
      // furniture is not "the noise": a letter sitting beside a timing strip
      // is still a letter on white, and the timing cross is priced separately
      if (d.tier[j] === 0 && !d.func[j]) return false;
    }
  return true;
}

function measure(d, res) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let fieldArea = 0, inkArea = 0;
  for (let i = 0; i < d.size * d.size; i++) {
    if (d.tier[i] >= 1) fieldArea++;
    if (d.tier[i] === 4) inkArea++;
  }
  const { intrusionTiming, intrusionHard } = d;
  for (const mi of res.unsatisfied) counts[d.tier[mi]]++;
  const cost = 4 * 0 + counts[4] * TIER_COST[4] + counts[3] * TIER_COST[3] +
    counts[2] * TIER_COST[2] + counts[1] * TIER_COST[1];
  return {
    glyphMiss: counts[4], haloMiss: counts[3], ruleMiss: counts[2], fieldMiss: counts[1],
    cost, fieldArea, inkArea, intrusionTiming, intrusionHard, misses: res.unsatisfied.length,
  };
}

/*
 * Ground sculpting — the free half of the picture.
 *
 * A finished solve leaves a null space of ~860 dimensions: every vector in it
 * touches ONLY unpainted modules, so XOR any subset into the matrix and the
 * drawing, the pins and the decode all survive. That makes the "random" QR
 * texture a drawable surface that costs nothing — no pins, no error budget.
 *
 * We use it for the thing the reference art gets right and a rolled field
 * gets wrong: the ground has to be DARK, and darkest right where it meets the
 * white shape, or the silhouette never reads.
 */
export function groundWant(d, g) {
  const size = d.size;
  const want = new Int8Array(size * size);   // +1 dark, -1 light, 0 don't care
  const w = new Float64Array(size * size);
  const style = g.ground || "dense";
  if (style === "free") return { want, w };
  const norm = (r, c) => {
    const dx = Math.abs(c + 0.5 - g.cx), dy = Math.abs((r + 0.5 - g.cy) / (g.squash || 1));
    const [X, Y] = g.pointy ? [dy, dx] : [dx, dy];
    return Math.max(Y / (Math.sqrt(3) / 2), X + Y / Math.sqrt(3));
  };
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      if (d.tier[i] !== 0 || d.func[i]) continue;  // painted, or furniture we cannot move
      let dark = 1, weight = 1;
      if (style === "rings") {
        // concentric hexagons echoing the shape — a flexagon's own geometry,
        // drawn in the texture for free
        const p = g.ringPeriod || 4;
        const t = (norm(r, c) - g.R) % p;
        dark = t >= 0 && t < (p / 2) ? 1 : -1;
      } else if (style === "halo") {
        // dark close in, released to free noise further out
        dark = norm(r, c) < g.R + (g.haloBand || 4) ? 1 : 0;
        weight = dark ? 1 : 0;
      }
      want[i] = dark;
      w[i] = weight;
    }
  // the boundary ring matters most: this is the edge the eye reads
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      if (d.tier[i] !== 0 || d.func[i]) continue;
      let touches = false;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        if (d.tier[rr * size + cc] >= 1) touches = true;
      }
      if (touches) { want[i] = 1; w[i] = 6; }
    }
  return { want, w };
}

/*
 * Pin the ground with the engine's own exact solver, then mop up with greedy
 * descent. solveExact is destructive on both the matrix and the basis it is
 * handed — which is exactly right here: a second pass over the leftover null
 * space, in ground priority order, pinning whatever rank remains after the
 * drawing has taken what it needs. Every vector in that basis touches only
 * unpainted modules, so this cannot disturb a letter.
 */
export function sculptGroundExact(d, g, matrix, basis) {
  const { want, w } = groundWant(d, g);
  const size = d.size;
  if (!basis || !basis.length) return { want, w, pinned: 0 };
  const target = new Uint8Array(size * size);
  const order = [];
  for (let i = 0; i < size * size; i++) {
    if (w[i] === 0) continue;
    target[i] = want[i] > 0 ? 1 : 0;
    order.push(i);
  }
  const dist = (i) => {
    const r = (i / size) | 0, c = i % size;
    const dx = Math.abs(c + 0.5 - g.cx), dy = Math.abs((r + 0.5 - g.cy) / (g.squash || 1));
    const [X, Y] = g.pointy ? [dy, dx] : [dx, dy];
    return Math.max(Y / (Math.sqrt(3) / 2), X + Y / Math.sqrt(3));
  };
  order.sort((a, b) => w[b] - w[a] || dist(a) - dist(b));
  const solVars = new Uint32Array(basis[0].vars.length);
  const { pinned, pool } = QR.solveExact(size, matrix, basis, target, order, solVars);
  sculptGround(matrix, pool, want, w);
  return { want, w, pinned };
}

// Greedy descent over the null-space basis. Each vector is all-or-nothing, so
// this is a straight coordinate descent on an exact, cheap objective.
export function sculptGround(matrix, basis, want, w, sweeps = 6) {
  const cost = (mi) => (w[mi] === 0 ? 0 : (matrix[mi] === (want[mi] > 0 ? 1 : 0) ? 0 : w[mi]));
  let total = 0;
  for (let i = 0; i < matrix.length; i++) total += cost(i);
  const mods = basis.map((v) => {
    const list = [];
    for (let x = 0; x < v.mod.length; x++) {
      let word = v.mod[x];
      while (word) {
        const t = word & -word;
        list.push((x << 5) + (31 - Math.clz32(t)));
        word ^= t;
      }
    }
    return list;
  });
  for (let s = 0; s < sweeps; s++) {
    let moved = 0;
    for (const list of mods) {
      let delta = 0;
      for (const mi of list) {
        if (w[mi] === 0) continue;
        delta += matrix[mi] === (want[mi] > 0 ? 1 : 0) ? w[mi] : -w[mi];
      }
      if (delta < 0) {
        for (const mi of list) matrix[mi] ^= 1;
        total += delta;
        moved++;
      }
    }
    if (!moved) break;
  }
  return total;
}

// A light module on the ground where it touches the white shape is a nick in
// the silhouette — the one defect that stops a hexagon reading as a hexagon.
export function edgeMiss(d, matrix) {
  const size = d.size;
  let bad = 0;
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      if (d.tier[i] !== 0 || d.func[i] || matrix[i]) continue;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        if (d.tier[rr * size + cc] >= 1) { bad++; break; }
      }
    }
  return bad;
}

export function darkFraction(d, matrix) {
  let n = 0, dark = 0;
  for (let i = 0; i < matrix.length; i++) if (d.tier[i] === 0 && !d.func[i]) { n++; dark += matrix[i]; }
  return dark / n;
}
