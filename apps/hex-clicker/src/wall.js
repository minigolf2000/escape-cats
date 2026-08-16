// NIGHT WALL — the reveal. Ported from the prototype (which ported it from
// reveal-lab.html); moon scene only, 1-stroke alphabet, every mouse faces its
// direction of travel. Position is a pure function of (room seed, mouse index,
// shared clock) — no wall state on the wire — so all four phones draw the
// IDENTICAL reveal. drawWall must be called with wallNow() (server-aligned
// milliseconds), never performance.now().

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
import { MOUSE_COLORS, MOUSE_KEYLINE, MOUSE_EYE, SIL_LO, BODY_LO } from "./art.js";

// ---------------------------------------------------------------------------
// NIGHT WALL — the reveal, ported from reveal-lab.html (moon scene only; the
// dice scene is concept-art per the design doc). The word is drawn from the
// 1-stroke alphabet (see GLYPHS) and every mouse faces its direction of travel;
// both were settled in the lab and are locked here, not switchable. Position is
// still a pure function of (seed, mouse index, time) — no wall state to save —
// with one exception: each mouse carries a smoothed heading vector for its
// facing, which is cosmetic and re-converges within a few frames. Lab knobs map to game
// state — mice N = the whole cast, always (the arrival ramp is gone; see WALL),
// per-shape headcounts = WALL_COUNT (the word capped at one mouse per letter),
// noise = locked 0 (wander() dropped entirely), speed = one uniform wallSpeed(),
// trail = mods.trail from the sleep-stage upgrades, and whether ANY mice show
// look like is bought (mods.neon, the Counting Mice research).
//
// BRIGHTNESS is the one dial that is not a lab knob: the night opens UNLIT (quarter
// speed, a third of the opacity) and Paper Lantern hands it back over WALL.rampMs.
// wallUnitsAt() carries the pace — the ramp is integrated in closed form there, so
// the mice accelerate rather than jumping — and wallGlowAt() carries the light, off
// the same anchor and the same easing. Every alpha this file writes (speck, sprite,
// rolling trail, persisted ink) is scaled by it, so the two halves arrive as one
// gesture. Both are read once per frame; see syncWallFrame.
// ---------------------------------------------------------------------------
// THE WALL IS FULLY CAST FROM THE FIRST FRAME OF NIGHT. No research gate, and no
// arrival ramp either: the phase opens with all WALL_CAP mice already walking, and
// what the night buys is what they LOOK like (Counting Mice) and what they LEAVE
// BEHIND (the trail rungs, then Scent Trail) — never whether they exist. See the
// note on WALL in shared/hex/rules.ts for why the ramp went and why the golden mice
// can be out there from the start without leaking a letter.
//
// A REVEAL_ORDER used to live here — [4, 7, 0, 3, 8, 2, 1, 6, 5], the order the nine
// golden letter-mice were staffed in as the ramp climbed, so the board read `·· ··E
// ····`, then `·· ··E ··O·`, and so on to TO THE MOON. It was chosen to delay the
// moment a team can GUESS the rest rather than merely to reveal slowly: it
// interleaved the two lines so neither word completed until step 6, opened on the
// cheapest letters (E the commonest in English, a medial O the least distinctive),
// and held M for last so that at step 8 the board read "?OON" — boon, coon, goon,
// loon, moon, noon, soon, toon — where "MOO?" would admit only five.
//
// It is deleted rather than kept, because with all nine golden mice on the wall in
// the opening frame there is no staging left for it to describe: every letter is
// staffed at once, so the permutation only decided which cast slot served which
// letter, which nothing can see. The staging job it was doing now belongs entirely
// to the trail ladder — an unstaffed letter and a letter with no ink behind it look
// identical, and the ladder inks all nine together. It is recoverable from git
// history if per-letter staging ever comes back (it would need a mechanism other
// than headcount, e.g. per-crew trail length).
function wallMiceCount() { return nightActive() ? WALL_CAP : 0; }
// Colors come from the shared MOUSE_COLORS table (see spawnMousePop) — the
// wall used to keep its own separate palette object; deleted in favor of one
// source of truth. Usage here is fixed-per-role, not random: see loadWallScene.
//
// SPEED AND INK WIDTH, both settled in the lab:
//
// The word and the scenery used to be paced by different rules, which made mice
// visibly unequal. The word advanced by a fraction of the WHOLE WORD's ink per ms,
// so all nine letters finished together, but because letter tours are sampled at a
// fixed 4 units and then scaled to letter size, MOON's points sit 2.23 units apart
// against 0.95 for TO THE — an identical 23 points/sec came out ~56 units/sec
// across MOON and ~24 across TO THE, with the scenery at ~26. Now there is ONE
// speed (WALL.speed) and each crew converts it through its own point spacing, so
// the rate is uniform on screen. The cost, stated plainly: LETTERS NO LONGER
// FINISH TOGETHER — a MOON letter is ~2.3x the ink of a TO THE letter and takes
// ~2.3x as long to draw.
//
// Word trails were 5px against a 1.8 hairline for scenery. They are now the same
// 1.8 as everything else: the word has to earn legibility from trail LENGTH rather
// than from being painted fatter than the scene around it.
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
// consecutive tour points at a constant index rate, so any gap in the point
// sequence is walked as a straight line at whatever speed the gap demands — a
// visible jump across empty space. Joining subpaths end-to-nearest-end leaves
// exactly such a gap at every seam, and the seams can be enormous: the comet's
// tail strands all begin at the nucleus, so finishing one leaves the pen a
// frame-width from where the next starts.
//
// So a mouse BACKTRACKS instead. Before starting the next subpath, retrace back
// along the tour already emitted to whichever point sits closest to the new
// subpath's start. Retracing costs nothing visually — the mouse is re-walking a
// line its crew has already inked — and it leaves only a residual hop of at most
// about JOIN_R, the same threshold that decided these subpaths were one shape.
//
// Rejoining within JOIN_R is a HARD FILTER and shortest-retrace-first breaks the
// tie; it is deliberately not a cost function balancing the two, since trading a
// long retrace for a shorter leap is exactly the jump this removes. Picking purely
// by proximity instead compounds quadratically, because retracing to an arbitrary
// point re-walks everything in between — on the Big Dipper that grew the tour to
// 8196 points, a lap no mouse would finish. Shared with the 1-stroke glyphs, whose
// deliberate retraces arrive as subpaths with coincident endpoints, where both the
// retrace and the hop are zero-length and this reduces to plain concatenation.
//
// The remaining degree of freedom, and the one the ringed planet needs: WHERE a
// subpath may be picked up. An open stroke has two ends and no more, but a CLOSED
// one is a cycle, and its start point is an artefact of where the draw call
// happened to begin rather than a feature of the shape. Honouring that seam is
// what stranded the giant — components() groups its ring with its disc because
// the two curves genuinely cross, yet the ring's seam sits out at the end of its
// major axis, 38 units clear of the disc. Nothing was within JOIN_R, so the
// fallback took the smallest leap on offer and the crew's tour carried a single
// 38-unit step among 6-unit ones. A mouse advances at a constant POINTS rate
// (wallPosAt), so that one step was walked at 6x speed: the wall's only jump.
// A cycle is therefore re-cut to begin wherever it rejoins best, which puts the
// giant's join back on the crossing where the shape says it belongs.
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
// Does this tour end where it started? A closed tour (a glyph's O, a die pip, a
// free star, the ringed planet's disc) has no wrap discontinuity, so its crew
// should LOOP — round and round, continuous heading, no 180-degree turnaround at
// the ends. Only OPEN strokes need the ping-pong that avoids a wrap jump.
// Coverage is unaffected either way: the two cycles differ in length (L-1 vs
// 2(L-1)) but a mouse still advances at `ppms` tour-points per ms, so the ink
// laid per second — and the legibility formula built on it — is identical.
// The threshold is relative to the tour's own mean sample spacing, since word
// tours are resampled several times finer than scenery ones.
function tourIsClosed(tour) {
  const L = tour.length;
  if (L < 4) return false;
  let sum = 0;
  for (let i = 1; i < L; i++) sum += Math.hypot(tour[i].x - tour[i - 1].x, tour[i].y - tour[i - 1].y);
  const step = sum / (L - 1);
  if (!(step > 0)) return false;
  return Math.hypot(tour[0].x - tour[L - 1].x, tour[0].y - tour[L - 1].y) <= step * 0.5;
}

// ---------------------------------------------------------------------------
// 1-STROKE ALPHABET — the word source, settled in the Reveal Lab.
// A single-stroke ("engraver's") font for exactly the letters the scenes need.
// Each glyph is ONE continuous pen path in a box `w` wide by 100 tall (y=0 cap
// height, y=100 baseline), authored through the same tracer() API the scenery
// uses — so a letter arrives as a smooth polyline with no lateral snaking, and
// a mouse walking it is literally writing the letter.
//
// Why this and not the raster sampler it replaced: threading a nearest-
// neighbour tour through a FILLED glyph snakes across the stroke, because a
// 190px letter is ~6 samples thick — the nearest unused point is a lateral
// neighbour about as often as a longitudinal one. Measured in the lab at 39.5
// degrees of turn per step (1025 deg/sec) against the scenery's 77 deg/sec.
// The 1-stroke source lands at 4.6 deg/step (85 deg/sec) — the word stops being
// the odd one out — and reads as clean lettering rather than scratchy hatching.
//
// Retracing is deliberate and normal for this kind of font: T doubles back
// along half its bar to reach the stem, E re-crosses its middle arm, X passes
// through its own centre three times. The patrol makes retraces free — the
// mouse was going to come back this way regardless. O is authored closed, so
// tourIsClosed() picks it up and its crew circles instead of ping-ponging.
//
// The WIDE cut, settled in the lab against narrower and squarer faces. Under the
// uniform speed below this is NOT a free choice: a wider face is more ink to walk
// at a fixed rate, so it both draws each letter slower and lowers the legibility
// number. S/I/X/D are gone with the six-sided scene that needed them; the word is
// the only thing this alphabet has to set.
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
// Wider than a text font's tracking would be: these are single hairline strokes
// that the trail then inks to roughly a letter's stroke width, so adjacent
// glyphs close up by that much again once they're drawn.
const GLYPH_GAP = 17;
// Arial Black's cap height at the 190px reference size, so a 1-stroke word lands
// at the same optical size the raster sampler used to produce.
const REF_CAP_H = 137;

function sampleStrokeWord(word) {
  const letters = [];
  let pen = 0;
  for (const ch of word) {
    const g = GLYPHS[ch];
    if (!g) {
      // Can only happen if someone edits the scene's text; see assertWordGlyphs,
      // which catches it at boot. Blank-but-loud beats blank-and-silent.
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

// ---------------------------------------------------------------------------
// TO THE MOON — the committed scene, settled in the Reveal Lab.
//
// Every element pairs a LONG structure with a compact payload. Mice tracing long
// shapes is what makes the reveal a mystery; a compact shape resolves the instant
// a mouse laps it. But space is mostly empty and its bodies are localized, so the
// way out is to draw the PATH rather than only the body — an orbit, a comet's tail
// and a constellation figure all genuinely cross the frame.
//
// What this replaced: a rocket, a UFO, a launch-smoke bank and four free-standing
// stars. Those were compact, so their crews resolved immediately, and the smoke
// was the single largest crew soaking up scenery mice.
//
// ---- THE LAYOUT IS SET BY THE SHOP, NOT BY THE FRAME ----------------------
// Every y below is squeezed into the TOP HALF of the 390x620 reference box, and
// the empty band under it is not slack — it is the shop's footprint, expressed in
// scene units so this file can reason about it.
//
// The chain: #dock is a fixed overlay 436px tall on the 390x844 phone everything
// here is calibrated to (48px rail + a 46vh scroller), so only the top 408px of
// the stage is ever unobscured. resizeWall() contain-fits this box and CENTRES
// it, which on that phone means scale 1 and wallOffY 112 — so screen y 408 is
// scene y 296, and anything below 296 spends the night behind frosted glass.
// Centring is also what makes the empty band WORK: a scene that ends at 320 in a
// 620 box is lifted by (620-320)/2 = 150 units of bottom padding, which is the
// whole mechanism. Shorten the content and it rises on its own.
//
// It used to run to scene y 565 of 620, i.e. 51% of the drawing was under the
// shop — including all of MOON, the entire orbit, the ringed giant, and Hex
// herself, who sleeps at the orbit's centre and sat 148 units BELOW the stage's
// middle. Now the content ends at 320, only the orbit's lower arc and the giant's
// bottom half are behind the dock (9% of it), and Hex clears the dock's top edge
// by ~6px. The word — the thing the phase exists to make readable — is entirely
// in the clear.
//
// What paid for it, stated plainly, because these are the pacing costs:
//   - the comet's sweep is 395 units long instead of 542. Its crew is the biggest
//     on the wall (10 mice), so a shorter tour is a faster reveal; a FOURTH tail
//     strand buys the ink back (4 x 395 vs 3 x 542 is 1580 against 1626), and it
//     reads as a denser tail rather than a shorter one.
//   - the Big Dipper is scaled to 0.855, so the purple crew's tour drops ~121
//     points to ~103 and the asterism gives itself up about 15% sooner.
//   - the orbit's ry is 48 instead of 76. That is a tighter halo around Hex — 20
//     units of clear sky above and below her instead of 48 — and 7% off the blue
//     crew's walk.
// The two word sizes are UNTOUCHED, deliberately: they set WORD_INK_EST, which
// the legibility estimate divides by, and the reveal's whole tuning hangs off it.
// Compact the scenery, never the word.
//
// On a shorter phone (375x667) the fit is 0.96 and offY 35, which slides the
// whole thing up under a ~68px HUD: the Dipper's topmost spokes pass behind the
// score. Accepted — #hud is a text overlay with its own shadow, and the
// alternative is Hex back under the shop.

// The Big Dipper in a unit box, radii tracking real magnitudes so it reads as the
// asterism rather than as seven identical dots.
const DIPPER = {
  dubhe:  [0.00, 0.24, 6.5], merak: [0.07, 0.56, 5.5], phecda: [0.32, 0.60, 5],
  megrez: [0.31, 0.37, 4],   alioth: [0.55, 0.30, 6],  mizar:  [0.77, 0.21, 5.5],
  alkaid: [1.00, 0.00, 6.5],
};
// ox, oy, w, h, star scale. Scaled to 0.855 of the 262x92 it was authored at (and
// the star scale with it, so it is the same asterism smaller rather than a restyled
// one) — the height came out of the scene's budget, and w had to follow or the
// Dipper flattens: its own y range is 0.6 of the box, so squeezing h alone turned a
// 4.8:1 asterism into a 7:1 smear. See the layout note above for what the shorter
// tour costs the purple crew.
const DIPPER_BOX = [46, 20, 224, 79, 0.90];
const dipperAt = (ox, oy, w, h) => k => [ox + DIPPER[k][0] * w, oy + DIPPER[k][1] * h];
// The whole asterism as ONE continuous stroke. Its graph has exactly two
// odd-degree nodes — Megrez (bowl 2 + handle 1) and Alkaid (1) — so an Euler path
// exists between them walking all seven edges exactly once, with no retracing.
// Every vertex is passed through, so the stars are drawn INLINE, as a detour the
// stroke makes on its way rather than as separate subpaths.
//
// That distinction is this shape's whole cost. Drawn the obvious way — figure plus
// seven free-standing stars — the tour came to 1311 points, of which 1189 (91%)
// was chainPolys retracing along the figure to reach each star; the stars' own ink
// was 55. As one Euler stroke with inline spokes it is 121 points and no retrace:
// an 11x shorter walk for the same drawing. Being retrace-free is also what keeps
// mice from bunching, since nothing in the tour is revisited, so even spacing
// along it is even spacing on screen.
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
// Where the giant sits on its orbit. Body and path are DIFFERENT colours on
// purpose: as two same-colour ellipses of similar weight they read as one tangle
// instead of as a planet standing on a path.
//
// ORB.cx is one unit right of the scene's own centre (390/2 = 195), and that is
// load-bearing rather than a rounding slip: the sleeping cat is centred on the
// stage and now poses to this ellipse's CENTRE, so an orbit centred near x=195
// costs nothing to aim at. Moving cx far off centre is legal but drags her
// sideways with it (see syncPoseVars).
//
// cy is the single most consequential number in the scene, because it is HEX's
// position: 262 puts her 48 units above the stage's middle, where she is visible
// all night. It used to be 458, which put her 148 units BELOW the middle — behind
// the shop for the whole phase, only appearing when the tray recedes for the final
// read. Everything else here was laid out around getting this number up.
//
// ry 48, not 76, and `at` on the RIGHT of the ellipse rather than the left:
//   ry pays for cy. The orbit is 96 units tall now against Hex's ~56, so she has
//   20 units of clear sky above and below inside it instead of 48. Tighter reads as
//   a halo rather than a running track; much tighter and the ellipse starts
//   tracing her outline.
//   `at` is what keeps the giant off her. The distance from her centre to the
//   giant is sqrt((cos(at)*rx)^2 + (sin(at)*ry)^2) — rotation preserves length, so
//   `rot` does not enter it — and shrinking ry alone would have dragged the giant
//   in from 93 units to 76. 0.974 trades ry for rx and lands it at 112, on the
//   ellipse's right shoulder, where its 62-unit ring stops 21 units short of Hex's
//   silhouette instead of crossing under it. The side matters for a second reason:
//   the comet sweeps down-LEFT, so its tail used to end on top of a lower-left
//   giant once both shapes were pulled into the same shorter frame.
const ORB = { cx: 196, cy: 262, rx: 186, ry: 48, rot: -0.08, at: 0.974 };
const GIANT = (() => {
  const c = Math.cos(ORB.rot), s = Math.sin(ORB.rot);
  const ex = Math.cos(ORB.at) * ORB.rx, ey = Math.sin(ORB.at) * ORB.ry;
  return { x: ORB.cx + ex * c - ey * s, y: ORB.cy + ex * s + ey * c };
})();
// The giant's own size, small on purpose. Hex sleeps at the orbit's centre, and
// the giant stands on the path 112 units away from her — at the original 46 body /
// 108x28 ring it was WIDER than she is (92 units against her ~49) and its ring
// swept to within ~15 units of her silhouette, so the two read as a pair of
// similar bodies fighting over the same middle rather than as a cat with a planet
// going round her. Halving the body while holding the ring's proportion near where
// it was (2.35:1 then, 2.6:1 here — scaled, not restyled, so it is the same object
// smaller) settles the hierarchy; ORB.at then does the rest, and on the shorter
// scene the ring's whole 119-unit width now clears her x range rather than passing
// under her (see ORB above).
//
// The cost, stated plainly: A SHORTER TOUR IS A FASTER TOUR. The green crew's walk
// drops from ~126 sampled points to ~70, so with the same 4 mice the giant now
// resolves in a bit over half the time — it gives itself up earlier in the reveal
// than the comet or the asterism do. Lengthening the ring instead of scaling it
// would buy that back, at the price of a body-to-ring ratio that stops reading as
// a ringed planet; the pacing is the cheaper thing to lose.
const GIANT_R = 24;
const GIANT_RING = { rx: 62, ry: 16, rot: -0.3 };

const MOON_SCENE = {
  // The WIDE spread: TO THE letterspaced across the frame, MOON large beneath it.
  // `place(k, n, t)` positions the k-th VISIBLE letter of n (spaces yield no tour).
  //
  // `y` is each letter's MIDLINE, not its baseline (loadWallScene recentres every
  // letter on its own bbox), and a line's ink is size * 137/190 tall — so MOON at 78
  // spans 140..196 and the 15 units under it are the clearance to the orbit's highest
  // point, which lands at x=247, directly beneath MOON's second O. The two SIZES are
  // load-bearing in a way the y's are not: they set the word's total ink, which
  // WORD_INK_EST hardcodes and the legibility estimate divides by. Move a y freely;
  // re-measure if you move a size.
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
    // FOUR tail strands, not three, and that is what keeps the pink crew's tour the
    // length it was after the sweep lost 147 units of reach to the shorter frame.
    // The outermost bow decides the frame's left edge: at -318/234 the +41 strand
    // ends at x=10, so widening the fan any further walks it off the canvas.
    { color: 'pink', draw(x) { cometSweep(x, 352, 48, 8, -318, 234, [-48, -17, 13, 41]); } },
    { color: 'blue', draw(x) {
      x.moveTo(ORB.cx + ORB.rx * Math.cos(ORB.rot), ORB.cy + ORB.rx * Math.sin(ORB.rot));
      x.ellipse(ORB.cx, ORB.cy, ORB.rx, ORB.ry, ORB.rot, 0, 6.283);
    } },
    { color: 'green', draw(x) {
      x.moveTo(GIANT.x + GIANT_R, GIANT.y); x.arc(GIANT.x, GIANT.y, GIANT_R, 0, 6.283);
      // Land the pen ON the ring, at its ROTATED angle-0 point, exactly as the blue
      // orbit above does. `GIANT.x + rx` is that point only for an unrotated ellipse;
      // at rot -0.3 it sits 18 units off the curve, so the subpath opened with a stray
      // spur running in from empty space — and, being a stroke that no longer ended
      // where it began, it stopped reading as a cycle to chainPolys and tourIsClosed.
      x.moveTo(GIANT.x + GIANT_RING.rx * Math.cos(GIANT_RING.rot),
               GIANT.y + GIANT_RING.rx * Math.sin(GIANT_RING.rot));
      x.ellipse(GIANT.x, GIANT.y, GIANT_RING.rx, GIANT_RING.ry, GIANT_RING.rot, 0, 6.283);
    } },
    { color: 'purple', draw(x) { bigDipper(x, ...DIPPER_BOX); } },
  ],
};

// The scene's word is a hardcoded constant, and loadWallScene() only runs at the
// night transition — so an unknown letter would surface mid-session, as a silent
// blank in the middle of the word the room exists to be read. Check it at BOOT
// instead: this can only ever fire for a developer editing MOON_SCENE.lines,
// and it fires before anyone is playing. Growing the word means growing GLYPHS.
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
// The reference frame every scene coordinate above is authored in. Named rather
// than inlined into resizeWall because the sleeping cat's pose is derived from a
// scene point too (syncPoseVars), and the two derivations have to share the fit or
// Hex and the ellipse she sits inside will disagree about where the middle is.
//
// H is 620 while the scene's ink stops at 320, and that half-empty box is the
// LAYOUT. The fit below centres it, so the padding under the drawing is what lifts
// the drawing clear of the shop — see the layout note on MOON_SCENE for the whole
// derivation. Two consequences worth knowing before touching this number:
//   - Shrinking H to "fit the art" does the opposite of what it looks like. On any
//     portrait phone the fit is width-limited, so H does not change the SCALE at
//     all; it only changes wallOffY, and a shorter box centres lower. H 360 would
//     drop the scene 130px straight back down behind the dock.
//   - 390x620 is also the aspect that keeps the fit width-limited in portrait,
//     which is what holds --pose-fit at 1.0 on phones (see POSE_SCENE_W).
const WALL_REF_W = 390, WALL_REF_H = 620;
let wW = 0, wH = 0;
// Scene->screen mapping is constant between resizes, so it's computed here
// rather than inside wallSceneMap — that ran ~400k times/sec at full night
// state (90 mice x 36 samples x 2 endpoints x 60fps), redoing the same
// Math.min and divisions every time.
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
// Puts the sleeping cat at the CENTRE of the blue crew's orbit, by publishing that
// point to CSS as an offset from the stage centre in screen px. It has to be CSS
// rather than an inline transform: the pose composes with the 1.8s zoom-out easing
// and the #sleepZ counter-scale, and those live in the stylesheet.
//
// #catPose flex-centres Hex on #stage, and #wall is inset:0 of that same #stage, so
// both are centred on the identical point — which means the offset she needs is
// just the scene-space offset from the scene's centre to ORB's, run through the
// wall's own fit. Two things fall out of that which are worth knowing:
//
//   x: (196 - 195) * scale — ONE scene unit. She was already standing on the
//      orbit's vertical axis before any of this; only the height was ever wrong.
//   y: (262 - 310) * scale — NEGATIVE now, 48 units up rather than the 148 down it
//      was, which is the whole point of the shorter scene: she used to be parked
//      behind the shop tray and is now above it by ~6px on a 390x844 phone. That
//      margin is thin, so treat ORB.cy as a number the dock's height is watching:
//      grow #shopScroll's 46vh cap and this is the first thing it eats.
//      On a phone the fit is width-limited, so `scale` is
//      w/390 and her pose now tracks the viewport's WIDTH. The old `39vh - 104px`
//      was height-driven, which meant every mobile URL-bar show/hide slid her (and
//      slid her through the 1.8s transition, 3.3s late). Width doesn't change when
//      the URL bar does, so on the phones this game is actually played on she now
//      holds still.
//
// It also publishes --pose-fit, and that one only became necessary BECAUSE of the
// above. Her SIZE comes from `#hexCat { width: min(55%, 300px) }` — a fraction of
// the VIEWPORT — while the orbit around her is fitted with min(w/390, h/620). Those
// two agree on every portrait phone by luck of the numbers (below the 300px cap,
// 55% of the width against a width-limited fit, so she is ~54 scene units wide on a
// Fold and on a 14 Pro Max alike) and diverge badly the moment the fit goes
// height-limited: a phone turned landscape put her at 120 scene units inside a
// 186-unit ellipse with the giant 11px off her flank. That mismatch was invisible
// while she sat below the orbit, and became the composition the instant she moved
// into the middle of it. So her night size is stated once, in the same units as
// everything else on the wall, and the multiplier is whatever it takes to get there.

// Her on-screen width at night, in SCENE units. Written as the derivation rather
// than as 53.625 because that is what makes "portrait phones are untouched" a fact
// instead of a hope: it IS what the CSS width above already produces at the pose's
// quarter scale on any phone under the 300px cap, so those phones resolve
// --pose-fit to 1.0000 and nothing about them moves. Retune it freely — this is now
// the authority on her night size, and the CSS width only decides the day's.
const POSE_SCENE_W = 0.55 * WALL_REF_W * 0.25;
// Called from resizeWall so it can never be computed off a stale mapping, and
// reached on the night latch before the first painted frame (syncPhase -> resizeWall).
function syncPoseVars() {
  const st = document.documentElement.style;
  st.setProperty('--pose-x', ((ORB.cx - WALL_REF_W / 2) * wallScale).toFixed(2) + 'px');
  st.setProperty('--pose-y', ((ORB.cy - WALL_REF_H / 2) * wallScale).toFixed(2) + 'px');
  // The COMPUTED width, deliberately not getBoundingClientRect(): the rect is
  // post-transform, so reading it here would feed this frame's own --pose-fit back
  // into the next one and creep on every resize. offsetWidth would dodge that too,
  // but #hexCat is an <svg> and offsetWidth is an HTMLElement property — it comes
  // back undefined and the NaN quietly lands on the fallback, which is exactly the
  // failure this comment exists to stop someone re-introducing.
  const layoutW = parseFloat(getComputedStyle(hexCatEl).width) * 0.25;   // 0.25 == `body.night #catPose`'s scale
  st.setProperty('--pose-fit', layoutW > 0
    ? (POSE_SCENE_W * wallScale / layoutW).toFixed(4) : '1');
}
window.addEventListener('resize', () => { if (nightActive()) resizeWall(); });

// `step` is a crew's mean point spacing in scene units, which is what converts the
// one wall speed into that crew's points/ms. WALL_WORD_INK is the word's total ink
// in scene units — the denominator of the legibility estimate, which has to be a
// DISTANCE now that speed is uniform, since a letter's points are worth more units
// the larger it is set.
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

// Where a crew's spread STARTS on its own tour. Without this every crew begins at
// its tour's point 0, and two crews that are the same shape at the same size then
// move as one animation played twice — MOON's two O's are exactly that: one closed
// loop each, one mouse each, identical scale, so the pair circled in lockstep for
// the whole night. The rotation is per crew, so the letters are drawn out of step
// with each other while each letter's own mice stay evenly spread along it.
//
// Golden-ratio spacing rather than a seeded draw: consecutive crews land ~0.618 of
// a lap apart, which is as far from agreeing as two offsets get, and the sequence
// never revisits a value — so the scene has no accidental pairs anywhere in it, not
// just in MOON. It also keeps position a pure function of (crew, index, time), with
// nothing to save, nothing to re-roll, and nothing for the server to send: every
// client derives the same wall from the same seed.
const crewPhase = idx => ((idx + 1) * 0.6180339887498949) % 1;

// WHICH SHAPE EACH MOUSE WALKS. The cast is the whole WALL_CAP of them and every
// one is drawn from the first frame (see wallMiceCount), so this is a STAFFING
// question now, not a running order: the list decides how the headcount is spread
// across the scene's crews, and nothing about the order is visible. It used to be
// arrival order as well — the cast was drawn as a prefix and mouse k climbed on when
// lifetime total crossed its rung, so this list WAS the reveal.
//
// Per-COLOUR caps, each the shape's own count rather than a share of one pot. The
// word's cap is 9, one golden mouse per letter, so every letter is staffed and no
// letter is ever staffed twice. Within a colour, every shape is staffed before any
// shape gets a second mouse: sharing by tour length alone never staffs the small
// ones (the comet's nucleus is 10 points against 429 for its tail fan, so its share
// rounds to zero and the circle is never drawn).
//
// The colours are then interleaved by how full each one is. That was what made the
// scene develop together rather than one colour completing before the next began;
// with no arrival ramp left it survives as the flattening step, and as the order the
// per-crew phase offsets below are handed out in.
function rebuildWallCast() {
  wallCast = [];
  // Every colour, always. A Word of Mouse research used to filter yellow out of this
  // list until bought, which meant the nine letters could only ever arrive together,
  // in the frame of the purchase — see the note where that row used to be.
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
    // One pass staffing every crew, then extra mice to whichever crew is furthest
    // behind its share of the ink. Yellow needs no special case: its cap is exactly
    // its crew count, so the first pass alone gives each letter its one mouse and
    // the top-up loop never runs.
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
  // Phases, SPREAD along the path. A ping-pong cycle visits every position twice,
  // once outbound and once returning, so spacing phases across the whole cycle
  // lands mice in coincident pairs — phase p and phase 1-p are the same point,
  // moving opposite ways. Confining the spacing to the outbound half spreads them
  // along the path instead. Closed tours map phase to position one-to-one and so
  // take the full span.
  //
  // Then the whole crew is ROTATED by crewPhase(idx), which is what stops identical
  // glyphs moving as one. See the note on crewPhase.
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

// ping-pong along the crew's tour; noise is locked to 0 so no wander term.
// Writes into a caller-supplied point rather than allocating: this runs ~200k
// times/sec at full night state and every caller reads .x/.y immediately and
// never retains the result, so the ~600k short-lived {x,y} per second were
// pure GC pressure — the thing that shows up as periodic frame drops on a
// phone rather than a uniformly lower framerate. Lerp in scene space, map to
// screen once at the end (was mapping both endpoints, then lerping).
// DISTANCE TRAVELLED, not elapsed time. Phase used to be `t * speed`, which means
// changing the speed dial rescales the whole of history: the old speed rung (+8)
// multiplied every mouse's position along its tour by 20/12 at once and teleported
// the entire wall. Integrating instead — units accumulated so far, plus the new
// rate from here on — makes a speed change continuous for every mouse and crew.
//
// The (base, anchor) pair used to be integrated HERE, per phone, with a comment
// noting the seam that left: a later rate change re-anchored at each phone's own
// frame, and a phone joining after one replayed the whole night at the new rate,
// so the room stopped agreeing about where the mice were. Paper Lantern is exactly
// that later rate change, so the pair moved where that note said to put it — onto
// the authority (HexSimState.wallBase/wallAt), banked once on the purchase and
// carried by every snapshot. This is now a pure read of shared state, which is
// what the rest of the wall already was.
//
// The RATE is cached per frame rather than read inside wallUnits, for the reason
// wallSceneMap's mapping is: this sits on the ~200k-lookups/sec path (every mouse
// x every trail sample x 60fps) and wallSpeed() is a fold read plus a clamp. It is
// invariant within a frame — only a purchase moves it, and a purchase arrives
// between frames.
//
// GLOW is cached alongside it and for the same reason, plus one of its own: it is
// no longer constant across a phase, so drawWallPoint and drawWallMouse reading it
// per sprite would each re-derive the same easing curve. Both are refreshed by
// syncWallFrame(now), which is the ONE place per frame the wall asks what time it
// is — the hand-over's position is a function of the shared clock, not of anything
// this file accumulates.
let wallFrameSpeed = 0, wallFrameGlow = 1;
function syncWallFrame(now) {
  wallFrameSpeed = wallSpeed(mods);
  wallFrameGlow = wallGlowAt(game, mods, now);
}
const wallUnits = t => wallUnitsAt(game, wallFrameSpeed, t);

// A proctor reset starts a new run: the sim clears the odometer for us, but the
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
// Half the 3.1 the wall shipped with. Night is a pulled-back camera and the
// mice were reading closer than the scene wanted; at 1.55 the body is ~7.6px
// wide and the wall reads as a swarm at distance rather than a parade of
// individuals. drawWallMouse's stroke widths are all r-relative, so they thin
// with it — at this size the keyline is sub-pixel in CSS units and survives
// only as an anti-aliased edge. That is the intended look, not a rounding
// accident. Sizes quoted elsewhere (NIGHT_POP_SCALE) are measured against this,
// so re-measure them if it moves again.
const WALL_MOUSE_R = 1.55;

// Same silhouette as mouseSVG (the click-pop particle) — drawn from the very
// same traced rings (SIL_LO/BODY_LO in mouse-geom.js), so the two cannot drift
// apart: there is no second copy of the geometry here to fall out of date, the
// way the hand-transcribed bezier list that used to live in this function did.
// LO is the simplified trace, because a wall mouse is ~7.6px across and the
// full-detail rings cost fill rate for points no one can resolve.
//
// The keyline is not a stroke. It's the silhouette ring painted underneath and
// showing around the slightly smaller body ring — the same inversion mouseParts
// uses, and the reason the line thickens at the nose and thins along the back
// exactly as drawn. Stroking would give an even outline and lose that.
//
// `r` keeps its old meaning — roughly the body's vertical half-size — so no
// call site needs retuning. The divisor moved from 10 to 13.15 only because
// that is the new drawing's own body half-height in its coordinate box; at a
// given `r` the mouse is now a little narrower and a little rounder than the
// old one, which is the shape change, not a scale bug.
//
// The art faces +x at rest, so `angle` (radians, canvas convention) is the
// heading to rotate it toward; 0 keeps the old unrotated look.
// `alpha` (default 1) multiplies the whole sprite rather than any one part: the
// Counting Mice cross-fade needs the body, outline and eye to arrive together,
// and the save/restore already scoping the transform scopes it for free.
const WALL_MOUSE_CX = 30.5, WALL_MOUSE_CY = 16.35, WALL_MOUSE_UNIT = 13.15;
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
  // the inner rings punch their holes (the gap under the chin, the eye of the
  // tail's curl) instead of painting over them.
  const rings = layer => {
    wctx.beginPath();
    for (const ring of layer) {
      wctx.moveTo((ring[0] - cx) * s, (ring[1] - cy) * s);
      for (let i = 2; i < ring.length; i += 2)
        wctx.lineTo((ring[i] - cx) * s, (ring[i + 1] - cy) * s);
      wctx.closePath();
    }
  };

  rings(SIL_LO); wctx.fillStyle = MOUSE_KEYLINE; wctx.fill('evenodd');
  rings(BODY_LO); wctx.fillStyle = color; wctx.fill('evenodd');

  // eye — keyline-colored, like the drawing: a hole punched in the body, not a
  // dark dot of its own. At wall size it is the one mark that still reads.
  wctx.beginPath();
  wctx.arc((MOUSE_EYE.cx - cx) * s, (MOUSE_EYE.cy - cy) * s, MOUSE_EYE.r * s, 0, 6.283);
  wctx.fillStyle = MOUSE_KEYLINE; wctx.fill();
  wctx.restore();
}

// Reused scratch points for the per-frame position math (see wallPosAt).
const wallHead = { x: 0, y: 0 }, wallScratch = { x: 0, y: 0 };
// Pre-Counting-Mice: a drifting light. Colourless and shapeless on purpose, so it
// sits among the starfield rather than announcing itself as a creature.
const WALL_POINT_COLOR = '#e9edf7';
// `a` fades the whole speck and `rs` scales it; both default to 1 so the steady
// pre-Counting-Mice state is untouched. The cross-fade uses them to swell the
// speck as it goes out, so the light looks like it BECAME the mouse rather than
// two sprites trading places on the same pixel.
// PAPER LANTERN dims this too, through `m`: before the lantern the specks are the
// ONLY thing on the wall (no trail, no sprites), so the row's brightness half has
// to land here or the unlit night looks exactly like the lit one.
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

// COUNTING MICE. The upgrade that turns the drifting specks into neon mice is the
// night's first real reveal, so it gets a beat instead of a swap between two
// frames. Each speck swells, sheds a spark ring, and resolves into its mouse —
// and they go in order of distance from the sleeping cat, so the change ripples
// outward from Hex rather than landing everywhere at once.
//
// wallNeonAt is set ONLY by the live purchase (see buyUpgrade). A reload with the
// upgrade already owned leaves it null and draws neon immediately: same principle
// as `.booting` and the night cutscene — earned beats play once, restored state
// never replays them.
const WALL_NEON_MS = 620;      // per-mouse cross-fade
const WALL_NEON_RIPPLE = 900;  // ms for the ripple to reach the outermost mouse
let wallNeonAt = null;
export function startWallNeon() {
  if (!wW) resizeWall();
  // Fires off a snapshot edge, so it can land before this frame's drawWall has
  // primed the rate — and it walks the cast to order the ripple.
  syncWallFrame(wallNow());
  wallNeonAt = wallNow();
  // Origin is Hex, not the middle of the canvas — the cat sits well below centre, and
  // the point of the beat is that the counting is coming from them.
  const wr = wallCv.getBoundingClientRect(), cr = hexCatEl.getBoundingClientRect();
  const cx = cr.left + cr.width / 2 - wr.left, cy = cr.top + cr.height / 2 - wr.top;
  const order = wallCast.map(m => {
    wallPosAt(m, wallNeonAt, wallScratch);
    return { m, d: Math.hypot(wallScratch.x - cx, wallScratch.y - cy) };
  }).sort((a, b) => a.d - b.d);
  const span = Math.max(1, order.length - 1);
  order.forEach((o, k) => { o.m.neonDelay = WALL_NEON_RIPPLE * k / span; });
}
// How far through its own cross-fade one mouse is, or null when the beat is not running.
// Shared by the sprite and by both ink paths, so a mouse's trail recolours on exactly the
// same curve its body arrives on.
function flipU(m, now) {
  if (wallNeonAt === null) return null;
  return Math.max(0, Math.min(1, (now - wallNeonAt - (m.neonDelay || 0)) / WALL_NEON_MS));
}
// Counting Mice now lands with trails already 84 long, so the ink cannot just switch
// palette on the frame `neon` flips — that reads as a hard cut across the whole wall
// while the bodies are still fading in. Blending per mouse on its own `u` makes the
// recolour part of the same gesture. Cheap: one lerp per mouse per frame, and only
// during the ~1.5s the beat runs.
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
// TRAIL GROWTH. The tail is not recorded, it is SAMPLED: segment j is where the mouse
// was j * trailDt ago, recomputed from the tour every frame. So raising mods.trail used
// to make the whole extension appear in one frame, sticking out behind the mouse across
// ground it had already covered — the length changed but nothing was drawn.
//
// Widening the window at exactly ONE SAMPLE PER trailDt fixes it without recording
// anything, and the arithmetic is why: the oldest sample shown sits at
// now - trailN * trailDt, so if trailN climbs at 1/trailDt while `now` climbs at 1, that
// product is CONSTANT. The tail tip stays frozen at the point the mouse occupied when the
// upgrade landed, and the trail lengthens only as the head runs away from it — which is
// the same thing as saying it only grows over new ground.
//
// Time to finish is therefore the honest one: the added length, played at the speed the
// mouse actually travels. Lucid Dreaming I's +34 takes 2.7s, and IV's +84 takes 6.7s.
//
// null until the first frame so a RESTORED save snaps to its full length instead of
// spending eight seconds growing 98 samples of trail nobody bought just now — the same
// rule wallNeonAt and `.booting` follow. Shrinking is instant: the only thing that
// shrinks trail is a dev preset walking back to day, which is not a beat.
let wallTrailShown = null;
function wallGrowTrail(dt) {
  if (wallTrailShown === null || wallTrailShown > mods.trail) { wallTrailShown = mods.trail; return; }
  if (wallTrailShown < mods.trail) wallTrailShown = Math.min(mods.trail, wallTrailShown + dt / WALL.trailDt);
}
let wallInkDirty = false, wallLastNow = 0;
export function drawWall(now) {
  if (!wW) resizeWall();
  // Clamped to the cast rather than taking WALL_CAP at its word. The two agree once
  // loadWallScene has run, but the cast is EMPTY before it does, and a scene with
  // fewer crews than headcount (a layout edit, a dropped element) would leave the
  // tail indices undefined.
  const N = Math.min(wallMiceCount(), wallCast.length);
  const dt = wallLastNow ? Math.min(now - wallLastNow, 100) : 16;
  wallLastNow = now;
  syncWallFrame(now);
  wallGrowTrail(dt);
  // Read once per frame (see syncWallFrame): every ink alpha below is scaled by it,
  // so the unlit night dims the drawing as well as the drawers, and the lantern's
  // hand-over brings both up together.
  const glow = wallFrameGlow;
  const neon = !!mods.neon;
  // Retired as soon as it has run its course, so the steady state is the same
  // straight drawWallMouse call it was before the beat existed.
  if (wallNeonAt !== null && now - wallNeonAt > WALL_NEON_MS + WALL_NEON_RIPPLE) wallNeonAt = null;
  const flipping = neon && wallNeonAt !== null;

  // SCENT TRAIL. The rolling trail is redrawn from scratch every frame and so can
  // never accumulate; persistence needs a layer that survives the frame. It has to
  // be a SEPARATE surface: the mice are redrawn every frame too, and anything
  // surviving on the main canvas would smear their bodies into blobs instead of
  // leaving a line behind them.
  //
  // Only ONE segment per mouse per frame goes onto it — where it actually moved —
  // not the whole rolling tail. Redrawing the tail into an accumulating layer
  // saturates the same pixels to opaque within a few frames.
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
  // Fractional, and CEIL rather than floor for the loop bound: the final step is clamped
  // to the fraction so the oldest point lands exactly at now - wallTrailShown * trailDt.
  // Flooring instead left the tail tip sawtoothing over one sample's worth of travel
  // (~1.3px) while it was supposed to be standing still.
  const trailF = wallTrailShown, trailN = Math.ceil(trailF), maxSeg = 16;
  // lineCap is invariant across every mouse and segment — set once per frame,
  // not per segment (that was ~189k redundant assignments/sec at full state).
  // lineWidth can't be hoisted the same way any more: the 1-stroke word tours
  // are centrelines that make ONE pass where the old raster tours made many, so
  // the word's ink has to be widened to fill the same letter silhouette. Still
  // one assignment per mouse, not per segment.
  wctx.lineCap = 'round';
  for (let i = 0; i < N; i++) {
    const m = wallCast[i];
    // head position: computed once and reused for both the trail's first
    // sample and the mouse itself (drawWall used to compute it twice).
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
  // NOTE: legibility detection lived here and existed only to print the proctor
  // line. Removed with the text rather than left as dead code. The wall simply
  // becoming readable is the signal now. If the design doc's "gentle one-time
  // shimmer" gets built, the formula to re-add is the one behind
  // wallCoverage(): word mice x (wallSpeed/1000) x visible ms / word ink,
  // crossing LEGIBLE_COV.
}

