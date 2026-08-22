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
// shared vertex in a pasted level grew two stubs — 2.2 units of halo and 0.75
// of core, poking past the joint and through whatever the next segment was
// heading into — where a hand-authored polyline has one clean `lineJoin`.
// That is the "pasted levels look slightly off" difference, and it is entirely
// in the SHAPE OF THE DATA rather than in either renderer.
//
// So: chain consecutive segments that share an endpoint EXACTLY. Exactly, not
// nearly — welding ends that a designer left apart would silently redraw their
// level, and the gap between two segments is often the point (a 45-58 u gap is
// how a level says "one band goes here"). Coordinates are already rounded to
// the codec's tenths by the time they arrive, so an exact compare is comparing
// the same numbers the level will ship with.

/** Round-trip-safe key for a vertex that is already at codec precision. */
const key = ([x, y]) => `${x},${y}`;

/**
 * Two-point segments, in the order Figma listed them -> polylines.
 *
 * Greedy and order-preserving: walk the segments once, extending the polyline
 * in hand while its far end keeps matching the next segment's near end, and
 * start a new one when it stops. A segment drawn in the opposite direction
 * still chains — a Figma Line's direction is which way the designer dragged,
 * which is not information about the surface — but nothing is reordered or
 * searched for, so the same paste always yields the same level.
 */
export function stitchTerrain(segs) {
  const out = [];
  for (const seg of segs) {
    const cur = out[out.length - 1];
    if (cur) {
      const end = cur[cur.length - 1];
      // The incoming segment, oriented to continue the current run.
      if (key(seg[0]) === key(end)) { cur.push(seg[1]); continue; }
      if (key(seg[1]) === key(end)) { cur.push(seg[0]); continue; }
    }
    out.push([seg[0], seg[1]]);
  }
  return out;
}
