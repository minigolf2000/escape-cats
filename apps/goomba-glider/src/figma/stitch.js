// Figma draws terrain one Line at a time. This puts the chains back together.
//
// A surface a designer drew as a run of connected Lines arrives here as N
// separate two-point polylines. PHYSICALLY that is already correct and always
// was — `segsFor` in `goomba/physics.ts` flattens every polyline into
// independent segments before collision, so a bag of segments and an authored
// polyline are the same surface to her.
//
// It does not LOOK the same, and that is the whole reason this exists. The game
// strokes each polyline as its own path with `lineCap = "round"`, three times
// over: a 4.4-unit collision halo, the 1.5-unit cream core, then the pink
// centreline. A round cap overhangs its endpoint by HALF the stroke, so every
// joint in a pasted level grew two stubs — 2.2 units of halo and 0.75 of core,
// poking past the joint and through whatever the next segment was heading into
// — where a hand-authored polyline has one clean `lineJoin`.
//
// WHY THIS WELDS RATHER THAN MATCHING EXACTLY
// The first version of this required endpoints to be EXACTLY equal. That was
// measured against the GENERATED frames, whose coordinates come out of
// `levels-to-svg.mjs` and therefore agree to the last decimal — and it is
// useless on a hand-drawn one. Measured on "2 · The Long Way Up" as actually
// drawn in Figma: seven joints, ONE of them exact, the rest 0.3 to 1.8 units
// apart. A person dragging a line end lands near the last one, not on it, and
// the 15-unit stroke hides the difference. So exact matching chained almost
// nothing and the stubs came straight back.
//
// The tolerance is not a guess. This game's own design rule is that no two
// terrain segments may come closer than 4.4 units (2 × her 2.2 radius) or she
// wedges in the corner and the run stalls — so a pair of endpoints closer than
// that is never a deliberate separation, it is one joint drawn by hand. WELD
// sits at 2.0: above every real joint measured (worst 1.84) and well below the
// 4.4 floor where deliberate geometry starts. The band between the two is a
// no-man's-land this stays out of.
//
// It still refuses to close a real gap. A 45-58 unit gap is how a level says
// "one band goes here", and nothing near that is touched.

/** Endpoints closer than this are the same point, drawn twice by a human. */
const WELD = 2.0;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Tenths — the codec's precision, so a snapped point survives the round trip. */
const round = (v) => Math.round(v * 10) / 10;

/** Closest point on segment a-b to p, and how far away it is. */
function toSegment(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby;
  let t = l2 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const q = [a[0] + abx * t, a[1] + aby * t];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q };
}

/**
 * T-junctions: pull a loose END onto the surface it was drawn against.
 *
 * Chaining only ever joins end TO end, which is the wrong shape for the most
 * common thing anyone draws — a platform butting into a wall. That platform's
 * end lands near the middle of the wall, nowhere near either of the wall's own
 * endpoints, so no amount of end-to-end welding touches it.
 *
 * Measured in the file: level 1's start platform is stored at x 124 and its
 * wall at x 133, so the platform ends 0.9 units PAST the wall's centreline. In
 * Figma that is a sliver hidden under a 15 px stroke. In game the same 0.9
 * units hangs off a 4.4-unit collision halo, which is the stub sticking out of
 * the left wall — the geometry is faithful, the drawing is just three times
 * wider, and what was invisible at design time is not invisible at play time.
 *
 * So the end is snapped onto the wall's line. Same WELD, same reasoning: the
 * game's own rule puts deliberate geometry at 4.4 units apart or more, so
 * anything under 2 was meant to touch. This does NOT chain the two — a T is not
 * a chain, and they stay separate polylines with separate ends. It only removes
 * the overhang.
 */
function snapTees(polys) {
  for (let i = 0; i < polys.length; i++) {
    const chain = polys[i];
    for (const e of [0, chain.length - 1]) {
      let best = null;
      for (let j = 0; j < polys.length; j++) {
        if (j === i) continue;
        for (let k = 0; k + 1 < polys[j].length; k++) {
          const hit = toSegment(chain[e], polys[j][k], polys[j][k + 1]);
          if (hit.d > 0 && hit.d <= WELD && (!best || hit.d < best.d)) best = hit;
        }
      }
      if (best) chain[e] = [round(best.q[0]), round(best.q[1])];
    }
  }
  return polys;
}

/**
 * Two-point segments, in the order Figma listed them -> polylines.
 *
 * Chains grow from BOTH ends and accept a segment drawn in either direction,
 * because neither is information about the surface: which way a Line points is
 * which way the designer dragged it, and which end of a chain they drew first
 * is nothing at all. (The notch in The Long Way Up is exactly this — its floor
 * and its left wall share a corner at both their START points, which a
 * forward-only pass cannot see.)
 *
 * Deterministic despite that freedom: segments are always scanned in their
 * original order, and among candidates the NEAREST endpoint wins, ties going to
 * the lowest index — so the same paste always yields the same level.
 *
 * Nearest rather than first-found, because a curve can be drawn finer than the
 * weld tolerance and then "is this endpoint the joint?" stops having one
 * answer. A 90° arc cut into 24 lines has 0.5-unit chords, so BOTH ends of the
 * next segment sit inside WELD's 2 units, as do the two segments after it. A
 * first-match rule then chains whichever the loop happened to reach first,
 * which is the segment's drawn direction and its layer order — neither of which
 * is information about the surface — and the arc comes back scrambled, with
 * vertices moved by up to a whole WELD. Picking the nearest endpoint every time
 * reproduces the drawing exactly, in any order, at any tessellation. Nothing
 * changes for hand-drawn geometry: this game's 4.4-unit floor means only one
 * candidate is ever inside 2 units there, and the nearest one is that one.
 *
 * A welded joint keeps the point already in the chain and DROPS the incoming
 * near-duplicate, which is what actually closes the seam — the rest of the
 * incoming segment is untouched. Nothing moves by more than WELD.
 */
export function stitchTerrain(segs) {
  const used = new Array(segs.length).fill(false);
  const out = [];

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain = [segs[i][0], segs[i][1]];

    // Keep sweeping until a full pass adds nothing: one new link can put a
    // chain within reach of a segment an earlier pass had already walked past.
    for (let grew = true; grew; ) {
      grew = false;
      let best = null;
      for (let j = i + 1; j < segs.length; j++) {
        if (used[j]) continue;
        const [a, b] = segs[j];
        const tail = chain[chain.length - 1];
        const head = chain[0];
        // The four ways segment j could extend this chain, best one wins.
        for (const [d, end, add] of [
          [dist(a, tail), "tail", b],
          [dist(b, tail), "tail", a],
          [dist(b, head), "head", a],
          [dist(a, head), "head", b],
        ])
          if (d <= WELD && (!best || d < best.d)) best = { d, end, add, j };
      }
      if (best) {
        if (best.end === "tail") chain.push(best.add);
        else chain.unshift(best.add);
        used[best.j] = true;
        grew = true;
      }
    }
    out.push(chain);
  }
  // Ends last: chaining gets first refusal on every endpoint, so two segments
  // that should be one surface are never turned into a T instead.
  return snapTees(out);
}
