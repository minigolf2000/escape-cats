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

const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= WELD;

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
 * original order and the lowest-index neighbour always wins, so the same paste
 * always yields the same level.
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
      for (let j = i + 1; j < segs.length; j++) {
        if (used[j]) continue;
        const [a, b] = segs[j];
        const tail = chain[chain.length - 1];
        const head = chain[0];
        if (near(a, tail)) chain.push(b);
        else if (near(b, tail)) chain.push(a);
        else if (near(b, head)) chain.unshift(a);
        else if (near(a, head)) chain.unshift(b);
        else continue;
        used[j] = true;
        grew = true;
      }
    }
    out.push(chain);
  }
  return out;
}
