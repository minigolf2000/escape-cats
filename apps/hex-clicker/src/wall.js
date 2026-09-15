// NIGHT WALL — the reveal. Moon scene, 1-stroke alphabet, every mouse faces its
// direction of travel. Position is a pure function of (wall seed, mouse index,
// the snapshot clock) — no wall state is stored — so a reload draws the
// IDENTICAL reveal. drawWall must be called with wallNow() (snapshot-aligned
// milliseconds), never performance.now(). The one exception is each mouse's
// smoothed heading vector: cosmetic, and it re-converges within a few frames.
//
// Lab knobs map to game state: mice = the whole cast, always (no arrival ramp;
// see WALL in rules.ts), per-shape headcounts = WALL_COUNT, noise = 0, speed =
// one uniform wallSpeed(), trail = mods.trail, and whether the mice LOOK like
// mice = mods.neon (Counting Mice).
//
// BRIGHTNESS is not a lab knob: the night opens UNLIT and Paper Lantern hands it
// back over WALL.rampMs. wallUnitsAt() carries the pace (the ramp integrated in
// closed form, so mice accelerate rather than jump) and wallGlowAt() the light,
// off the same anchor and easing. Every alpha this file writes is scaled by the
// glow, read once per frame in syncWallFrame.

import {
  WALL,
  WALL_COUNT,
  WALL_COUNT_KEYS,
  WALL_CAP,
  WALL_PERSIST_MS,
  wallSpeed,
  wallGlowAt,
  wallUnitsAt,
  mulberry32,
} from "@escape-cats/shared";
import { game, mods, nightActive, wallSeed, wallNow } from "./state.js";
import { wallCv, hexCatEl } from "./dom.js";
import { MOUSE_COLORS, MOUSE_KEYLINE, MOUSE_EYE_INK, MOUSE_EYE, SIL_LO, BODY_LO, TAIL_LO } from "./art.js";

// THE WALL IS FULLY CAST FROM THE FIRST FRAME OF NIGHT: what the night buys is
// what the mice LOOK like (Counting Mice) and what they LEAVE BEHIND (the trail
// rungs, then Scent Trail), never whether they exist. No per-letter staging —
// an unstaffed letter and one with no ink behind it look identical.
function wallMiceCount() { return nightActive() ? WALL_CAP : 0; }
// ONE speed for every crew (WALL.speedBase), converted through each crew's own
// point spacing, so the rate is uniform on screen. The cost: letters do not
// finish together — a MOON letter is ~2.3x the ink of a TO THE letter. One
// hairline for every trail: the word earns legibility from trail LENGTH, not
// from being painted fatter than the scenery.
const WALL_INK_W = 1.8;        // one hairline for every trail, word and scenery
const HEADING_DT = 16;         // ms back-sample for facing direction (~1 frame at 60fps)
const HEADING_EASE = 0.25;     // per-frame lerp toward the new heading vector
function tracer() {
  const polys = [];
  let cur = null, tx = 0, ty = 0, rot = 0;
  const stack = [];
  const T = (x, y) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    return { x: tx + x * c - y * s, y: ty + x * s + y * c };
  };
  const api = {
    polys,
    save() { stack.push([tx, ty, rot]); },
    restore() { [tx, ty, rot] = stack.pop(); },
    translate(x, y) { const p = T(x, y); tx = p.x; ty = p.y; },
    rotate(a) { rot += a; },
    moveTo(x, y) { cur = [T(x, y)]; polys.push(cur); },
    lineTo(x, y) { cur ? cur.push(T(x, y)) : api.moveTo(x, y); },
    quadraticCurveTo(cx, cy, x, y) {
      const p0 = cur[cur.length - 1], p1 = T(cx, cy), p2 = T(x, y);
      for (let i = 1; i <= 12; i++) {
        const u = i / 12, v = 1 - u;
        cur.push({ x: v * v * p0.x + 2 * v * u * p1.x + u * u * p2.x,
                   y: v * v * p0.y + 2 * v * u * p1.y + u * u * p2.y });
      }
    },
    bezierCurveTo(ax, ay, bx, by, x, y) {
      const p0 = cur[cur.length - 1], p1 = T(ax, ay), p2 = T(bx, by), p3 = T(x, y);
      for (let i = 1; i <= 16; i++) {
        const u = i / 16, v = 1 - u;
        cur.push({ x: v ** 3 * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u ** 3 * p3.x,
                   y: v ** 3 * p0.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u ** 3 * p3.y });
      }
    },
    arc(cx, cy, r, a0, a1, ccw) {
      let d = a1 - a0;
      if (ccw && d > 0) d -= Math.PI * 2;
      if (!ccw && d < 0) d += Math.PI * 2;
      const n = Math.max(6, Math.ceil(Math.abs(d) * r / 5));
      for (let i = 0; i <= n; i++) {
        const a = a0 + d * i / n;
        api.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    },
    ellipse(cx, cy, rx, ry, rota, a0, a1, ccw) {
      let d = a1 - a0;
      if (ccw && d > 0) d -= Math.PI * 2;
      if (!ccw && d < 0) d += Math.PI * 2;
      const n = Math.max(8, Math.ceil(Math.abs(d) * Math.max(rx, ry) / 5));
      const cr = Math.cos(rota || 0), sr = Math.sin(rota || 0);
      for (let i = 0; i <= n; i++) {
        const a = a0 + d * i / n, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
        api.lineTo(cx + ex * cr - ey * sr, cy + ex * sr + ey * cr);
      }
    },
  };
  return api;
}
function resamplePoly(poly, sp) {
  const out = [];
  if (!poly.length) return out;
  out.push(poly[0]);
  let acc = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 1e-6) continue;
    let pos = 0;
    while (acc + (d - pos) >= sp) {
      pos += sp - acc; acc = 0;
      out.push({ x: a.x + (b.x - a.x) * pos / d, y: a.y + (b.y - a.y) * pos / d });
    }
    acc += d - pos;
  }
  out.push(poly[poly.length - 1]);
  return out;
}
// Group subpaths into geometrically continuous shapes; each becomes one crew.
const JOIN_R = 9;
function components(polys) {
  const n = polys.length;
  const parent = [...Array(n).keys()];
  const find = a => parent[a] === a ? a : (parent[a] = find(parent[a]));
  const touch = (a, b) => {
    const ends = [a[0], a[a.length - 1]];
    for (const e of ends) for (const p of b)
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= JOIN_R * JOIN_R) return true;
    return false;
  };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
    if (find(i) !== find(j) && (touch(polys[i], polys[j]) || touch(polys[j], polys[i])))
      parent[find(j)] = find(i);
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(polys[i]);
  }
  return [...groups.values()].map(chainPolys);
}
// Chain a group's subpaths into ONE walkable tour. A mouse interpolates between
// consecutive tour points at a constant index rate, so any gap in the sequence
// is walked as a visible jump across empty space — and end-to-nearest-end
// joining leaves one at every seam (the comet's tail strands all start at the
// nucleus). So a mouse BACKTRACKS: before the next subpath it retraces the tour
// already emitted to the point nearest that subpath's start, which costs
// nothing visually and leaves a residual hop of at most ~JOIN_R.
//
// Rejoining within JOIN_R is a HARD FILTER, shortest retrace breaking the tie —
// not a cost function trading retrace for leap (that is the jump this removes),
// and not pure proximity (retracing to an arbitrary point compounds
// quadratically; the Dipper grew to 8196 points). A CLOSED subpath may be
// entered at ANY point and is re-cut to start there: its seam is an artefact of
// where the draw call began, and honouring it stranded the ringed giant with a
// single 38-unit step among 6-unit ones, walked at 6x speed.
function chainPolys(g) {
  const restList = [...g];
  let out = [...restList.shift()];
  const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  // Re-cut a cycle to start (and end) at index k. p[L-1] repeats p[0], so the
  // wrapped tail skips p[0] and the new seam inherits p[0]->p[1]'s spacing.
  const recut = (p, k) => k ? p.slice(k).concat(p.slice(1, k + 1)) : p;
  while (restList.length) {
    let bi = 0, bent = 0, bcyc = false, bj = out.length - 1;
    let bBack = Infinity, bHop = Infinity;
    restList.forEach((p, i) => {
      const cyc = tourIsClosed(p);
      // Legal entry points: every point of a cycle, or an open stroke's two ends.
      const entries = cyc ? p.length - 1 : 2;
      for (let h = 0; h < entries; h++) {
        const head = cyc ? p[h] : (h ? p[p.length - 1] : p[0]);
        for (let j = 0; j < out.length; j++) {
          const hop = d2(head, out[j]), back = out.length - 1 - j;
          const near = hop <= JOIN_R * JOIN_R, bestNear = bHop <= JOIN_R * JOIN_R;
          const better = near !== bestNear ? near
                       : near ? (back < bBack) : (hop < bHop);
          if (better) { bBack = back; bHop = hop; bi = i; bent = h; bcyc = cyc; bj = j; }
        }
      }
    });
    for (let k = out.length - 2; k >= bj; k--) out.push(out[k]);
    const nxt = restList.splice(bi, 1)[0];
    out = out.concat(bcyc ? recut(nxt, bent) : (bent ? [...nxt].reverse() : nxt));
  }
  return out;
}
// Does this tour end where it started? A closed tour (a glyph's O, a free star,
// the giant's disc) has no wrap discontinuity, so its crew LOOPS; only OPEN
// strokes need the ping-pong that avoids a wrap jump. Coverage is unaffected:
// a mouse advances at `ppms` tour-points per ms either way. The threshold is
// relative to the tour's own mean spacing, since word tours are sampled finer.
function tourIsClosed(tour) {
  const L = tour.length;
  if (L < 4) return false;
  let sum = 0;
  for (let i = 1; i < L; i++) sum += Math.hypot(tour[i].x - tour[i - 1].x, tour[i].y - tour[i - 1].y);
  const step = sum / (L - 1);
  if (!(step > 0)) return false;
  return Math.hypot(tour[0].x - tour[L - 1].x, tour[0].y - tour[L - 1].y) <= step * 0.5;
}

// 1-STROKE ALPHABET — the word source. Each glyph is ONE continuous pen path in
// a box `w` wide by 100 tall (y=0 cap height, y=100 baseline), authored through
// the same tracer() API as the scenery, so a mouse walking it is literally
// writing the letter. Retracing is normal for an engraver's font (T doubles
// back along its bar); the patrol makes retraces free. O is authored closed so
// tourIsClosed() has its crew circle. A WIDE cut, and under the uniform speed
// that is not free: more ink per letter draws slower and lowers the legibility
// number. Only the letters the word needs exist; assertWordGlyphs checks.
const GLYPHS = {
  'T': { w: 78, draw(x) { x.moveTo(0, 0); x.lineTo(78, 0); x.lineTo(39, 0); x.lineTo(39, 100); } },
  'O': { w: 88, draw(x) { x.moveTo(88, 50); x.ellipse(44, 50, 44, 50, 0, 0, 6.283); } },
  'H': { w: 80, draw(x) { x.moveTo(0, 0); x.lineTo(0, 100); x.lineTo(0, 50);
                          x.lineTo(80, 50); x.lineTo(80, 0); x.lineTo(80, 100); } },
  'E': { w: 72, draw(x) { x.moveTo(72, 0); x.lineTo(0, 0); x.lineTo(0, 50); x.lineTo(58, 50);
                          x.lineTo(0, 50); x.lineTo(0, 100); x.lineTo(72, 100); } },
  'M': { w: 96, draw(x) { x.moveTo(0, 100); x.lineTo(0, 0); x.lineTo(48, 56);
                          x.lineTo(96, 0); x.lineTo(96, 100); } },
  'N': { w: 82, draw(x) { x.moveTo(0, 100); x.lineTo(0, 0); x.lineTo(82, 100); x.lineTo(82, 0); } },
  ' ': { w: 40, draw() {} },
};
// Wider than text tracking: the trail inks each hairline to roughly a stroke
// width, so adjacent glyphs close up by that much once drawn.
const GLYPH_GAP = 17;
// Arial Black's cap height at the 190px reference size the scene is authored to.
const REF_CAP_H = 137;

function sampleStrokeWord(word) {
  const letters = [];
  let pen = 0;
  for (const ch of word) {
    const g = GLYPHS[ch];
    if (!g) {
      // Only reachable by editing the scene's text; assertWordGlyphs catches it at boot.
      console.error(`[wall] no 1-stroke glyph for ${JSON.stringify(ch)} — rendering blank`);
      pen += GLYPHS[' '].w + GLYPH_GAP;
      continue;
    }
    const tr = tracer();
    tr.translate(pen, 0);
    g.draw(tr);
    const polys = tr.polys.map(p => resamplePoly(p, 4)).filter(p => p.length > 1);
    if (polys.length) letters.push(chainPolys(polys));
    pen += g.w + GLYPH_GAP;
  }
  // Normalize into the 190px reference space: scale to REF_CAP_H tall, then
  // shift so the ink spans [0,w] x [0,h] (loadWallScene centres on w/2, h/2).
  const all = letters.flat();
  if (!all.length) return { letters, w: 1, h: 1 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of all) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  const k = REF_CAP_H / Math.max(1, y1 - y0);
  for (const p of all) { p.x = (p.x - x0) * k; p.y = (p.y - y0) * k; }
  return { letters, w: (x1 - x0) * k, h: (y1 - y0) * k };
}

// TO THE MOON — the committed scene. Every element pairs a LONG structure with a
// compact payload: a compact shape resolves the instant a mouse laps it, so the
// scene draws PATHS — an orbit, a comet's tail, a constellation figure.
//
// THE LAYOUT IS SET BY THE SHOP, NOT BY THE FRAME. Every y is squeezed into the
// TOP HALF of the 390x620 reference box; the empty band under it is the shop's
// footprint in scene units. #dock is 436px tall on the 390x844 phone this is
// calibrated to, so only the top 408px of the stage is unobscured; resizeWall()
// contain-fits and CENTRES the box (scale 1, wallOffY 112 there), so screen y
// 408 is scene y 296 and anything below 296 spends the night behind frosted
// glass. Centring is the mechanism: content ending at 320 in a 620 box is
// lifted by (620-320)/2. Shorten the content and it rises on its own.
//
// The two word SIZES are load-bearing: they set WORD_INK_EST, which the
// legibility estimate divides by. Compact the scenery, never the word. On a
// shorter phone (375x667) the Dipper's top spokes pass behind #hud; accepted.

// The Big Dipper in a unit box, radii tracking real magnitudes so it reads as the
// asterism rather than as seven identical dots.
const DIPPER = {
  dubhe:  [0.00, 0.24, 6.5], merak: [0.07, 0.56, 5.5], phecda: [0.32, 0.60, 5],
  megrez: [0.31, 0.37, 4],   alioth: [0.55, 0.30, 6],  mizar:  [0.77, 0.21, 5.5],
  alkaid: [1.00, 0.00, 6.5],
};
// ox, oy, w, h, star scale. w and h scale TOGETHER: the Dipper's own y range is
// 0.6 of the box, so squeezing h alone turns a 4.8:1 asterism into a 7:1 smear.
const DIPPER_BOX = [46, 20, 224, 79, 0.90];
const dipperAt = (ox, oy, w, h) => k => [ox + DIPPER[k][0] * w, oy + DIPPER[k][1] * h];
// The whole asterism as ONE Euler stroke (Megrez and Alkaid are its two
// odd-degree nodes), stars drawn INLINE as detours. Figure plus seven separate
// stars was 1311 tour points, 91% of it chainPolys retracing; this is 121 and
// retrace-free, which also keeps the mice evenly spaced on screen.
const DIPPER_EULER = ['alkaid', 'mizar', 'alioth', 'megrez', 'dubhe', 'merak', 'phecda', 'megrez'];
function dipperStar(x, cx, cy, r) {
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    x.lineTo(cx + dx * r, cy + dy * r); x.lineTo(cx, cy);
  }
}
function bigDipper(x, ox, oy, w, h, sc) {
  const P = dipperAt(ox, oy, w, h);
  const drawn = new Set();          // Megrez is passed twice; star it once
  DIPPER_EULER.forEach((k, i) => {
    const [px, py] = P(k);
    i ? x.lineTo(px, py) : x.moveTo(px, py);
    if (!drawn.has(k)) { drawn.add(k); dipperStar(x, px, py, DIPPER[k][2] * sc); }
  });
}
// Tail strands all leave the nucleus together and bow apart downstream. Anchored
// far apart at both ends they draw parallel rails, which reads as track, not tail.
function cometSweep(x, hx, hy, r, dx, dy, bows) {
  x.moveTo(hx + r, hy); x.arc(hx, hy, r, 0, 6.283);
  const L = Math.hypot(dx, dy), px = -dy / L, py = dx / L;
  for (const b of bows) {
    x.moveTo(hx + dx * 0.06, hy + dy * 0.06);
    x.bezierCurveTo(hx + dx * 0.38 + px * b * 0.18, hy + dy * 0.38 + py * b * 0.18,
                    hx + dx * 0.72 + px * b * 0.62, hy + dy * 0.72 + py * b * 0.62,
                    hx + dx + px * b,               hy + dy + py * b);
  }
}
// Where the giant sits on its orbit. Body and path are DIFFERENT colours so they
// read as a planet on a path, not one tangle.
//
// cx is one unit right of the scene's centre (195), and that is load-bearing:
// the sleeping cat poses to this ellipse's CENTRE (syncPoseVars), so moving cx
// drags her sideways. cy IS Hex's position — 262 keeps her 48 units above the
// stage's middle, visible all night above the shop. ry 48 gives her 20 units of
// clear sky inside the orbit; much tighter and the ellipse traces her outline.
// `at` keeps the giant off her: its distance from her centre is
// sqrt((cos(at)*rx)^2 + (sin(at)*ry)^2) (`rot` does not enter), and 0.974 lands
// it at 112 on the right shoulder — ring 21 units clear of her silhouette and
// away from the comet's tail, which sweeps down-LEFT.
const ORB = { cx: 196, cy: 262, rx: 186, ry: 48, rot: -0.08, at: 0.974 };
const GIANT = (() => {
  const c = Math.cos(ORB.rot), s = Math.sin(ORB.rot);
  const ex = Math.cos(ORB.at) * ORB.rx, ey = Math.sin(ORB.at) * ORB.ry;
  return { x: ORB.cx + ex * c - ey * s, y: ORB.cy + ex * s + ey * c };
})();
// Small on purpose: the giant stands 112 units from Hex and must read as a
// planet going round a cat, not a second body of her size. Ring proportion held
// near 2.6:1 so it is the same object smaller. A SHORTER TOUR IS A FASTER TOUR —
// the green crew resolves earlier than the comet or asterism; accepted.
const GIANT_R = 24;
const GIANT_RING = { rx: 62, ry: 16, rot: -0.3 };

const MOON_SCENE = {
  // TO THE letterspaced across the frame, MOON large beneath. `place(k, n)`
  // positions the k-th VISIBLE letter of n (spaces yield no tour). `y` is a
  // letter's MIDLINE (loadWallScene recentres on its own bbox); a line's ink is
  // size * 137/190 tall, so MOON at 78 spans 140..196 and the orbit's top
  // (x=247) sits 15 units under it. Move a y freely; RE-MEASURE WORD_INK_EST if
  // you move a size.
  lines: [
    { text: 'TO THE', place(k, n) {
      const t = n < 2 ? 0 : k / (n - 1);
      return { x: 75 + t * 240, y: 106, size: 34, rot: 0 };
    } },
    { text: 'MOON', place(k, n) {
      const t = n < 2 ? 0 : k / (n - 1);
      return { x: 63 + t * 264, y: 168, size: 78, rot: 0 };
    } },
  ],
  elements: [
    // FOUR tail strands keep the pink crew's tour long enough. The outermost bow
    // sets the frame's left edge: the +41 strand ends at x=10.
    { color: 'pink', draw(x) { cometSweep(x, 352, 48, 8, -318, 234, [-48, -17, 13, 41]); } },
    { color: 'blue', draw(x) {
      x.moveTo(ORB.cx + ORB.rx * Math.cos(ORB.rot), ORB.cy + ORB.rx * Math.sin(ORB.rot));
      x.ellipse(ORB.cx, ORB.cy, ORB.rx, ORB.ry, ORB.rot, 0, 6.283);
    } },
    { color: 'green', draw(x) {
      x.moveTo(GIANT.x + GIANT_R, GIANT.y); x.arc(GIANT.x, GIANT.y, GIANT_R, 0, 6.283);
      // Land the pen ON the ring at its ROTATED angle-0 point, like the orbit
      // above: `GIANT.x + rx` is 18 units off the curve at rot -0.3, and the
      // stray spur stopped the stroke reading as a cycle to tourIsClosed.
      x.moveTo(GIANT.x + GIANT_RING.rx * Math.cos(GIANT_RING.rot),
               GIANT.y + GIANT_RING.rx * Math.sin(GIANT_RING.rot));
      x.ellipse(GIANT.x, GIANT.y, GIANT_RING.rx, GIANT_RING.ry, GIANT_RING.rot, 0, 6.283);
    } },
    { color: 'purple', draw(x) { bigDipper(x, ...DIPPER_BOX); } },
  ],
};

// loadWallScene() only runs at the night transition, so an unknown letter would
// surface mid-session as a silent blank. Check at BOOT instead.
(function assertWordGlyphs() {
  const missing = [...new Set(MOON_SCENE.lines.flatMap(ln => [...ln.text]))]
    .filter(ch => !GLYPHS[ch]);
  if (missing.length)
    throw new Error(`[wall] MOON_SCENE needs 1-stroke glyphs that don't exist: ${missing.join(' ')}`);
})();

const wctx = wallCv.getContext('2d');
// Offscreen layer for Scent Trail's persisting ink (see drawWall).
const inkCv = document.createElement('canvas');
const inkCtx = inkCv.getContext('2d');
// The reference frame every scene coordinate is authored in. Shared with the
// sleeping cat's pose (syncPoseVars), so the two fits cannot disagree. H is 620
// while the ink stops at 320, and that half-empty box IS the layout (see
// MOON_SCENE). Shrinking H to "fit the art" does the opposite of what it looks
// like: a portrait fit is width-limited, so H changes only wallOffY, and a
// shorter box centres LOWER — H 360 drops the scene 130px behind the dock.
// 390x620 is also what keeps --pose-fit at 1.0 on phones (POSE_SCENE_W).
const WALL_REF_W = 390, WALL_REF_H = 620;
let wW = 0, wH = 0;
// Scene->screen mapping is constant between resizes, so it is computed here and
// not in wallPosAt, which runs ~400k times/sec at full night state.
let wallScale = 1, wallOffX = 0, wallOffY = 0;
export function resizeWall() {
  const dpr = Math.min(devicePixelRatio || 1, 3);
  wW = wallCv.clientWidth; wH = wallCv.clientHeight;
  wallCv.width = Math.round(wW * dpr); wallCv.height = Math.round(wH * dpr);
  wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  inkCv.width = wallCv.width; inkCv.height = wallCv.height;
  inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // The layer is reallocated, so the record is gone and every mouse's last position
  // is stale; without this the first post-resize frame draws one long false streak.
  wallInkDirty = false;
  for (const m of wallCast) m.lx = undefined;
  wallScale = Math.min(wW / WALL_REF_W, wH / WALL_REF_H);
  wallOffX = (wW - WALL_REF_W * wallScale) / 2;
  wallOffY = (wH - WALL_REF_H * wallScale) / 2;
  syncPoseVars();
}
// Puts the sleeping cat at the CENTRE of the blue crew's orbit, publishing that
// point to CSS as an offset from the stage centre in screen px (it composes with
// the 1.8s zoom-out and the #sleepZ counter-scale, which live in the
// stylesheet). #catPose flex-centres Hex on #stage and #wall is inset:0 of the
// same #stage, so the offset is just (ORB - scene centre) through the wall's
// fit. On a phone the fit is width-limited, so her pose tracks the viewport's
// WIDTH and holds still when the URL bar shows and hides. ORB.cy clears the
// dock's top edge by ~6px on a 390x844 phone: grow #shopScroll's 46vh cap and
// this is the first thing it eats.
//
// --pose-fit: her SIZE comes from `#hexCat { width: min(55%, 300px) }`, a
// fraction of the VIEWPORT, while the orbit is fitted with min(w/390, h/620).
// The two agree on every portrait phone and diverge badly once the fit goes
// height-limited (landscape put her at 120 scene units inside a 186-unit
// ellipse). So her night size is stated once in scene units and the multiplier
// is whatever it takes to get there.

// Her on-screen width at night, in SCENE units — the authority on her night
// size (the CSS width decides the day's). Written as the derivation because it
// IS what the CSS width produces at quarter scale on any phone under the 300px
// cap, so those phones resolve --pose-fit to 1.0000 and nothing moves.
const POSE_SCENE_W = 0.55 * WALL_REF_W * 0.25;
// Called from resizeWall so it never runs off a stale mapping, and reached on
// the night latch before the first painted frame (syncPhase -> resizeWall).
function syncPoseVars() {
  const st = document.documentElement.style;
  st.setProperty('--pose-x', ((ORB.cx - WALL_REF_W / 2) * wallScale).toFixed(2) + 'px');
  st.setProperty('--pose-y', ((ORB.cy - WALL_REF_H / 2) * wallScale).toFixed(2) + 'px');
  // The COMPUTED width, not getBoundingClientRect() (post-transform, so it
  // would feed this frame's --pose-fit into the next and creep on every resize)
  // and not offsetWidth (#hexCat is an <svg>, so it is undefined there and the
  // NaN quietly lands on the fallback).
  const layoutW = parseFloat(getComputedStyle(hexCatEl).width) * 0.25;   // 0.25 == `body.night #catPose`'s scale
  st.setProperty('--pose-fit', layoutW > 0
    ? (POSE_SCENE_W * wallScale / layoutW).toFixed(4) : '1');
}
window.addEventListener('resize', () => { if (nightActive()) resizeWall(); });

// `step` is a crew's mean point spacing in scene units — what converts the one
// wall speed into that crew's points/ms. WALL_WORD_INK is the word's total ink
// in scene units, the denominator of the legibility estimate: a DISTANCE, since
// a letter's points are worth more units the larger it is set.
let WALL_CREWS = [], WALL_WORD_LEN = 0, WALL_WORD_INK = 1, wallCast = [];
function tourStep(tour) {
  if (tour.length < 2) return 1;
  let sum = 0;
  for (let i = 1; i < tour.length; i++)
    sum += Math.hypot(tour[i].x - tour[i - 1].x, tour[i].y - tour[i - 1].y);
  return sum / (tour.length - 1) || 1;
}
export function loadWallScene() {
  WALL_CREWS = []; WALL_WORD_LEN = 0;
  for (const ln of MOON_SCENE.lines) {
    const s = sampleStrokeWord(ln.text);
    // Per-letter placement: each letter is recentred on its OWN bbox and then
    // scaled/rotated into the spot the layout chose for it, so a line can spread
    // its letters across the frame instead of being set as one block.
    s.letters.forEach((letterTour, k) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of letterTour) {
        if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
      }
      const pl = ln.place(k, s.letters.length);
      const sc = pl.size / 190, rot = pl.rot || 0;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const lcx = (x0 + x1) / 2, lcy = (y0 + y1) / 2;
      const tour = letterTour.map(p => {
        const dx = (p.x - lcx) * sc, dy = (p.y - lcy) * sc;
        return { x: pl.x + dx * cr - dy * sr, y: pl.y + dx * sr + dy * cr };
      });
      WALL_CREWS.push({ color: MOUSE_COLORS.yellow, tour, len: tour.length,
                       step: tourStep(tour), kind: 'word', closed: tourIsClosed(tour) });
      WALL_WORD_LEN += tour.length;
    });
  }
  for (const e of MOON_SCENE.elements) {
    const tr = tracer(); e.draw(tr);
    const sampled = tr.polys.map(p => resamplePoly(p, 6)).filter(p => p.length > 1);
    for (const compTour of components(sampled)) {
      WALL_CREWS.push({ color: MOUSE_COLORS[e.color], tour: compTour, len: compTour.length,
                       step: tourStep(compTour), kind: 'scenery', closed: tourIsClosed(compTour) });
    }
  }
  WALL_WORD_INK = WALL_CREWS.reduce((a, c) =>
    a + (c.kind === 'word' ? (c.len - 1) * c.step : 0), 0) || 1;
  rebuildWallCast();
}

// Where a crew's spread STARTS on its tour. Without it two crews of the same
// shape and size move as one animation played twice (MOON's two O's circled in
// lockstep). Golden-ratio spacing: consecutive crews land ~0.618 of a lap apart
// and the sequence never repeats, so no accidental pairs anywhere — and still a
// pure function of (crew, index, time), nothing to save or send.
const crewPhase = idx => ((idx + 1) * 0.6180339887498949) % 1;

// WHICH SHAPE EACH MOUSE WALKS — a staffing question, since every mouse is
// drawn from the first frame. Per-COLOUR caps, each the shape's own count: the
// word's is 9, one golden mouse per letter. Within a colour every shape is
// staffed before any gets a second mouse (sharing by tour length alone never
// staffs the comet's 10-point nucleus against its 429-point tail). Colours are
// then interleaved by how full each is, which is the order the per-crew phases
// are handed out in.
function rebuildWallCast() {
  wallCast = [];
  const keys = WALL_COUNT_KEYS;
  const byColor = new Map(keys.map(k => [MOUSE_COLORS[k], []]));
  WALL_CREWS.forEach((c, idx) => { const g = byColor.get(c.color); if (g) g.push(idx); });
  const PAD = 14;
  // Per colour, the sequence of crews its mice join, in order.
  const queues = new Map();
  for (const key of keys) {
    const crews = byColor.get(MOUSE_COLORS[key]);
    if (!crews || !crews.length) continue;
    const want = WALL_COUNT[key];
    const weights = crews.map(k => WALL_CREWS[k].len + PAD);
    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
    // One pass staffing every crew, then extra mice to whichever crew is
    // furthest behind its share of the ink.
    let seq = crews.map((_, k) => k).sort((a, b) => weights[b] - weights[a]);
    const counts = crews.map(() => 0);
    for (const k of seq) counts[k]++;
    while (seq.length < want) {
      let bi = 0, bd = -Infinity;
      for (let k = 0; k < crews.length; k++) {
        const deficit = (seq.length + 1) * (weights[k] / wSum) - counts[k];
        if (deficit > bd) { bd = deficit; bi = k; }
      }
      counts[bi]++; seq.push(bi);
    }
    seq = seq.slice(0, want);
    queues.set(key, seq.map(k => crews[k]));
  }
  // Interleave: repeatedly take from whichever colour is least full.
  const taken = new Map(keys.map(k => [k, 0]));
  for (let i = 0; i < WALL_CAP; i++) {
    let pick = null, worst = Infinity;
    for (const key of keys) {
      const q = queues.get(key);
      if (!q || taken.get(key) >= q.length) continue;
      const filled = taken.get(key) / q.length;
      if (filled < worst) { worst = filled; pick = key; }
    }
    if (pick == null) break;
    const ord = taken.get(pick);
    const crew = queues.get(pick)[ord];
    taken.set(pick, ord + 1);
    const rng = mulberry32(wallSeed() + i * 7919);
    wallCast.push({ i, p01: rng(), crew, color: WALL_CREWS[crew].color, key: pick, ord });
  }
  // Phases, SPREAD along the path. A ping-pong cycle visits every position
  // twice, so spacing phases across the whole cycle lands mice in coincident
  // pairs (p and 1-p are the same point); confining the spacing to the outbound
  // half spreads them. Closed tours take the full span. Then the whole crew is
  // ROTATED by crewPhase(idx), which stops identical glyphs moving as one.
  const byCrew = new Map();
  for (const m of wallCast) {
    if (!byCrew.has(m.crew)) byCrew.set(m.crew, []);
    byCrew.get(m.crew).push(m);
  }
  for (const [idx, members] of byCrew) {
    const closed = WALL_CREWS[idx].closed, span = closed ? 1 : 0.5;
    const off = crewPhase(idx) * span;
    members.forEach((m, k) => {
      m.phase = (span * k / members.length + off) % span;
    });
  }
}

// Ping-pong along the crew's tour; noise is locked to 0. Writes into a
// caller-supplied point rather than allocating: ~200k calls/sec at full night,
// and the short-lived {x,y} were GC pressure that shows as periodic frame drops
// on a phone. Lerp in scene space, map to screen once.
//
// DISTANCE TRAVELLED, not elapsed time, and the (base, anchor) pair lives on the
// authority (HexSimState.wallBase/wallAt), banked once per purchase — a phone
// integrating its own would re-anchor at its own frame time, and a late joiner
// would replay the whole night at the new rate. This is a pure read of shared
// state.
//
// RATE and GLOW are cached per frame by syncWallFrame(now), the ONE place per
// frame the wall asks what time it is: both sit on the ~200k-lookups/sec path,
// both are invariant within a frame (a purchase arrives between frames), and
// the glow's easing curve would otherwise be re-derived per sprite.
let wallFrameSpeed = 0, wallFrameGlow = 1;
function syncWallFrame(now) {
  wallFrameSpeed = wallSpeed(mods);
  wallFrameGlow = wallGlowAt(game, mods, now);
}
const wallUnits = t => wallUnitsAt(game, wallFrameSpeed, t);

// A reset starts a new run: the sim clears the odometer for us, but the
// per-run RENDER state is ours and has to go with it, or the new night inherits
// the old one's grown trail and a neon beat that already played.
export function resetWallClock() {
  wallTrailShown = null;
  wallNeonAt = null;
  wallLastNow = 0;
}
function wallPosAt(m, t, out) {
  const crew = WALL_CREWS[m.crew];
  const L = crew.len;
  let sx, sy;
  if (L < 2) {
    const p0 = crew.tour[0] || { x: 195, y: 310 };
    sx = p0.x; sy = p0.y;
  } else {
    // Scene units -> this crew's points. One speed for every mouse.
    const pts = wallUnits(t) / crew.step;
    // Closed tours loop (tour[L-1] IS tour[0], so the wrap is continuous);
    // open ones ping-pong back along themselves to avoid a wrap jump.
    const cyc = crew.closed ? L - 1 : 2 * (L - 1);
    let f = ((pts + m.phase * cyc) % cyc + cyc) % cyc;
    if (!crew.closed && f > L - 1) f = cyc - f;
    const idx = Math.min(L - 2, Math.floor(f)), frac = f - idx;
    const a = crew.tour[idx], b = crew.tour[idx + 1];
    sx = a.x + (b.x - a.x) * frac;
    sy = a.y + (b.y - a.y) * frac;
  }
  out.x = wallOffX + sx * wallScale;
  out.y = wallOffY + sy * wallScale;
  return out;
}
// At 1.55 the body is ~7.6px wide: the wall reads as a swarm at distance, not a
// parade. drawWallMouse's stroke widths are r-relative, so the keyline is
// sub-pixel and survives as an anti-aliased edge — intended. NIGHT_POP_SCALE is
// measured against this; re-measure it if this moves.
const WALL_MOUSE_R = 1.55;

// Same silhouette as mouseSVG, from the same traced rings (SIL_LO/BODY_LO in
// mouse-geom.js), so the two cannot drift. LO because a wall mouse is ~7.6px.
// The keyline is not a stroke: it is the silhouette ring painted under the
// slightly smaller body ring, so the line thickens at the nose and thins along
// the back as drawn. `r` is roughly the body's vertical half-size; the art
// faces +x at rest and `angle` (canvas radians) rotates it. `alpha` multiplies
// the whole sprite so the Counting Mice cross-fade moves body, outline and eye
// together.
// Pivot and scale are the BODY's centre and vertical half-size, read off the
// traced geometry rather than typed by hand: a re-trace moves the drawing
// inside its box, and a stale pivot leaves the sprite spinning about its old
// middle. r stays "the body's vertical half-size", so 2r is the mouse's height
// in wall units whatever the drawing does; the v2 mouse is flatter, so at the
// same r it renders about 12% wider than the v1 one did.
const WALL_MOUSE_CX = 27.13, WALL_MOUSE_CY = 14.34, WALL_MOUSE_UNIT = 11.76;
function drawWallMouse(x, y, color, r, angle, alpha) {
  const s = r / WALL_MOUSE_UNIT, cx = WALL_MOUSE_CX, cy = WALL_MOUSE_CY;
  wctx.save();
  // The unlit night dims the whole sprite the same way `alpha` does, so it rides
  // the same globalAlpha rather than being folded into every fillStyle below.
  const glow = wallFrameGlow;
  if (alpha !== undefined || glow !== 1)
    wctx.globalAlpha = (alpha === undefined ? 1 : alpha) * glow;
  wctx.translate(x, y);
  wctx.rotate(angle || 0);

  // One path per layer, every ring of that layer inside it, filled even-odd so
  // any inner ring punches its hole instead of painting over it — the tail's
  // curl closes on itself and is exactly that case. The tail gets its OWN fill
  // rather than riding in SIL_LO's: it overlaps the rump, and even-odd would
  // read that overlap as a hole and punch a notch through the mouse.
  const rings = layer => {
    wctx.beginPath();
    for (const ring of layer) {
      wctx.moveTo((ring[0] - cx) * s, (ring[1] - cy) * s);
      for (let i = 2; i < ring.length; i += 2)
        wctx.lineTo((ring[i] - cx) * s, (ring[i + 1] - cy) * s);
      wctx.closePath();
    }
  };

  wctx.fillStyle = MOUSE_KEYLINE;
  rings(SIL_LO); wctx.fill('evenodd');
  rings(TAIL_LO); wctx.fill('evenodd');
  rings(BODY_LO); wctx.fillStyle = color; wctx.fill('evenodd');

  // eye — its own near-black dot now, because that is what the v2 drawing is:
  // the v1 mouse wore its eye in the keyline colour, a hole punched in the
  // body. At wall size it is still the one mark that reads, which is why it is
  // the only one of the three the canvas draws — at WALL_MOUSE_R the ear and
  // the nose come to about a third of a pixel each.
  wctx.beginPath();
  wctx.arc((MOUSE_EYE.cx - cx) * s, (MOUSE_EYE.cy - cy) * s, MOUSE_EYE.r * s, 0, 6.283);
  wctx.fillStyle = MOUSE_EYE_INK; wctx.fill();
  wctx.restore();
}

// Reused scratch points for the per-frame position math (see wallPosAt).
const wallHead = { x: 0, y: 0 }, wallScratch = { x: 0, y: 0 };
// Pre-Counting-Mice: a drifting light. Colourless and shapeless on purpose, so it
// sits among the starfield rather than announcing itself as a creature.
const WALL_POINT_COLOR = '#e9edf7';
// `a` fades the whole speck and `rs` scales it; the cross-fade swells the speck
// as it goes out so the light looks like it BECAME the mouse. PAPER LANTERN dims
// this too: before the lantern the specks are the ONLY thing on the wall, so
// the row's brightness half has to land here.
function drawWallPoint(x, y, a, rs) {
  const s = rs === undefined ? 1 : rs, m = (a === undefined ? 1 : a) * wallFrameGlow;
  wctx.globalAlpha = 0.28 * m;
  wctx.beginPath(); wctx.arc(x, y, 3.4 * s, 0, 6.283);
  wctx.fillStyle = WALL_POINT_COLOR; wctx.fill();
  wctx.globalAlpha = m;
  wctx.beginPath(); wctx.arc(x, y, 1.5 * s, 0, 6.283);
  wctx.fillStyle = WALL_POINT_COLOR; wctx.fill();
  wctx.globalAlpha = 1;
}

// COUNTING MICE gets a beat, not a swap: each speck swells, sheds a spark ring
// and resolves into its mouse, in order of distance from the sleeping cat so the
// change ripples outward from Hex. wallNeonAt is set ONLY by the live purchase
// (buyUpgrade edge); a reload with the upgrade owned leaves it null and draws
// neon at once — earned beats play once, restored state never replays them.
const WALL_NEON_MS = 620;      // per-mouse cross-fade
const WALL_NEON_RIPPLE = 900;  // ms for the ripple to reach the outermost mouse
let wallNeonAt = null;
export function startWallNeon() {
  if (!wW) resizeWall();
  // Fires off a snapshot edge, possibly before this frame's drawWall primed the rate.
  syncWallFrame(wallNow());
  wallNeonAt = wallNow();
  // Origin is Hex, not the canvas middle: the counting is coming from her.
  const wr = wallCv.getBoundingClientRect(), cr = hexCatEl.getBoundingClientRect();
  const cx = cr.left + cr.width / 2 - wr.left, cy = cr.top + cr.height / 2 - wr.top;
  const order = wallCast.map(m => {
    wallPosAt(m, wallNeonAt, wallScratch);
    return { m, d: Math.hypot(wallScratch.x - cx, wallScratch.y - cy) };
  }).sort((a, b) => a.d - b.d);
  const span = Math.max(1, order.length - 1);
  order.forEach((o, k) => { o.m.neonDelay = WALL_NEON_RIPPLE * k / span; });
}
// How far through its own cross-fade one mouse is, or null when the beat is not
// running. Shared by the sprite and both ink paths, so a trail recolours on the
// same curve its body arrives on.
function flipU(m, now) {
  if (wallNeonAt === null) return null;
  return Math.max(0, Math.min(1, (now - wallNeonAt - (m.neonDelay || 0)) / WALL_NEON_MS));
}
// Counting Mice lands with trails already 84 long, so the ink cannot switch
// palette on the frame `neon` flips — that is a hard cut across the wall while
// the bodies are still fading in. One lerp per mouse per frame, only during the beat.
function mixHex(a, b, t) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  const r = Math.round((A >> 16) + ((B >> 16) - (A >> 16)) * t);
  const g = Math.round(((A >> 8) & 255) + (((B >> 8) & 255) - ((A >> 8) & 255)) * t);
  const c = Math.round((A & 255) + ((B & 255) - (A & 255)) * t);
  return `rgb(${r},${g},${c})`;
}
// The colour a mouse's ink should be right now: its own colour once resolved, white
// while it is still a speck, and a blend of the two during the beat.
function wallInkColor(m, neon, u) {
  if (u === null) return neon ? m.color : WALL_POINT_COLOR;
  return mixHex(WALL_POINT_COLOR, m.color, u);
}
// Point out over the first half while swelling; mouse in over the last 70%, so the
// two overlap in the middle and neither pixel ever goes empty.
function drawWallFlip(m, x, y, u, angle) {
  const out = 1 - Math.min(1, u / 0.5), pop = Math.sin(Math.PI * Math.min(1, u / 0.5));
  if (out > 0) drawWallPoint(x, y, out * out, 1 + 0.8 * pop);
  if (pop > 0.02) { // spark ring — the moment of becoming
    wctx.globalAlpha = 0.5 * pop * (1 - u);
    wctx.strokeStyle = m.color; wctx.lineWidth = 0.9;
    wctx.beginPath(); wctx.arc(x, y, 2 + 6 * u, 0, 6.283); wctx.stroke();
    wctx.globalAlpha = 1;
  }
  const inn = Math.max(0, (u - 0.3) / 0.7);
  if (inn > 0) drawWallMouse(x, y, m.color, WALL_MOUSE_R * (0.5 + 0.5 * inn), angle, inn * inn);
}
// TRAIL GROWTH. The tail is SAMPLED, not recorded: segment j is where the mouse
// was j * trailDt ago, recomputed every frame — so a jump in mods.trail would
// make the whole extension appear in one frame, behind the mouse over ground it
// had already covered. Widening the window at exactly ONE SAMPLE PER trailDt
// keeps the oldest sample (now - trailN * trailDt) frozen at the point the
// mouse occupied when the upgrade landed, so the trail grows only over new
// ground (+34 takes 2.7s at 9.6 u/s). null until the first frame so a RESTORED
// save snaps to full length (the wallNeonAt / `.booting` rule); shrinking is
// instant, since only a dev preset shrinks trail.
let wallTrailShown = null;
function wallGrowTrail(dt) {
  if (wallTrailShown === null || wallTrailShown > mods.trail) { wallTrailShown = mods.trail; return; }
  if (wallTrailShown < mods.trail) wallTrailShown = Math.min(mods.trail, wallTrailShown + dt / WALL.trailDt);
}
let wallInkDirty = false, wallLastNow = 0;
export function drawWall(now) {
  if (!wW) resizeWall();
  // Clamped to the cast rather than trusting WALL_CAP: the cast is EMPTY before
  // loadWallScene runs, and a scene edit could leave fewer crews than headcount.
  const N = Math.min(wallMiceCount(), wallCast.length);
  const dt = wallLastNow ? Math.min(now - wallLastNow, 100) : 16;
  wallLastNow = now;
  syncWallFrame(now);
  wallGrowTrail(dt);
  // Every ink alpha below is scaled by the glow, so the unlit night dims the
  // drawing as well as the drawers and the hand-over brings both up together.
  const glow = wallFrameGlow;
  const neon = !!mods.neon;
  // Retired as soon as it has run its course, so the steady state is the same
  // straight drawWallMouse call it was before the beat existed.
  if (wallNeonAt !== null && now - wallNeonAt > WALL_NEON_MS + WALL_NEON_RIPPLE) wallNeonAt = null;
  const flipping = neon && wallNeonAt !== null;

  // SCENT TRAIL needs a layer that survives the frame, and a SEPARATE one: the
  // mice are redrawn every frame, and anything surviving on the main canvas
  // would smear their bodies into blobs. Only ONE segment per mouse per frame
  // goes onto it — where it actually moved — since redrawing the whole rolling
  // tail into an accumulating layer saturates to opaque within a few frames.
  if (mods.persist > 0 && N && WALL_CREWS.length) {
    const fade = 1 - Math.pow(2, -dt / (mods.persist * WALL_PERSIST_MS));
    inkCtx.globalCompositeOperation = 'destination-out';
    inkCtx.fillStyle = `rgba(0,0,0,${fade})`;
    inkCtx.fillRect(0, 0, wW, wH);
    inkCtx.globalCompositeOperation = 'source-over';
    inkCtx.lineWidth = WALL_INK_W; inkCtx.lineCap = 'round';
    inkCtx.globalAlpha = 0.5 * glow;
    for (let i = 0; i < N; i++) {
      const m = wallCast[i];
      wallPosAt(m, now, wallHead);
      if (m.lx !== undefined && Math.abs(wallHead.x - m.lx) <= 16 && Math.abs(wallHead.y - m.ly) <= 16) {
        inkCtx.strokeStyle = wallInkColor(m, neon, flipping ? flipU(m, now) : null);
        inkCtx.beginPath(); inkCtx.moveTo(m.lx, m.ly); inkCtx.lineTo(wallHead.x, wallHead.y); inkCtx.stroke();
      }
      m.lx = wallHead.x; m.ly = wallHead.y;
    }
    inkCtx.globalAlpha = 1;
    wallInkDirty = true;
  } else if (wallInkDirty) {
    inkCtx.clearRect(0, 0, wW, wH);
    for (const m of wallCast) m.lx = undefined;
    wallInkDirty = false;
  }

  wctx.clearRect(0, 0, wW, wH);
  if (wallInkDirty) wctx.drawImage(inkCv, 0, 0, wW, wH);
  if (!N || !WALL_CREWS.length) return;
  // Fractional, and CEIL for the loop bound with the final step clamped to the
  // fraction, so the oldest point lands exactly at now - wallTrailShown *
  // trailDt. Flooring left the tail tip sawtoothing over ~1.3px.
  const trailF = wallTrailShown, trailN = Math.ceil(trailF), maxSeg = 16;
  // lineCap is invariant, so set once per frame (~189k redundant assignments/sec
  // otherwise). lineWidth is per mouse, never per segment.
  wctx.lineCap = 'round';
  for (let i = 0; i < N; i++) {
    const m = wallCast[i];
    // head position: computed once, reused for the trail's first sample and the mouse.
    wallPosAt(m, now, wallHead);
    if (trailN > 0) {
      wctx.lineWidth = WALL_INK_W;
      // invariant across this mouse's segments, so hoisted out of the inner loop
      wctx.strokeStyle = wallInkColor(m, neon, flipping ? flipU(m, now) : null);
      let px = wallHead.x, py = wallHead.y;
      for (let j = 1; j <= trailN; j++) {
        const back = j < trailF ? j : trailF;
        const p = wallPosAt(m, now - back * WALL.trailDt, wallScratch);
        const far = Math.abs(p.x - px) > maxSeg || Math.abs(p.y - py) > maxSeg;
        if (!far) {
          wctx.globalAlpha = 0.5 * glow * (1 - back / trailF);
          wctx.beginPath(); wctx.moveTo(px, py); wctx.lineTo(p.x, p.y); wctx.stroke();
        }
        px = p.x; py = p.y;
      }
      wctx.globalAlpha = 1;
    }
    // Facing: sample a step back and point along the displacement. Smoothed as a
    // unit VECTOR (not the raw angle) so it eases through the ping-pong
    // turnarounds instead of snapping, and wraps clean through +/-pi. Held at
    // the last heading when displacement is ~0 (a single-point crew), rather
    // than being pulled to atan2(0,0)'s spurious 0 degrees.
    const back = wallPosAt(m, now - HEADING_DT, wallScratch);
    const ddx = wallHead.x - back.x, ddy = wallHead.y - back.y;
    const dist = Math.hypot(ddx, ddy);
    if (dist > 0.02) {
      const ux = ddx / dist, uy = ddy / dist;
      if (m.dirX === undefined) { m.dirX = ux; m.dirY = uy; }
      else { m.dirX += (ux - m.dirX) * HEADING_EASE; m.dirY += (uy - m.dirY) * HEADING_EASE; }
    }
    const ang = m.dirX === undefined ? 0 : Math.atan2(m.dirY, m.dirX);
    if (!neon) drawWallPoint(wallHead.x, wallHead.y);
    else if (!flipping) drawWallMouse(wallHead.x, wallHead.y, m.color, WALL_MOUSE_R, ang);
    else drawWallFlip(m, wallHead.x, wallHead.y, flipU(m, now), ang);
  }
}

