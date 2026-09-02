// Figma draws terrain one Line at a time. This puts the chains back together.
//
// Physically a bag of two-point segments is already the same surface (`segsFor`
// in physics.ts flattens every polyline). It does not LOOK the same: each
// polyline is stroked with round caps, three times over, and a round cap
// overhangs by half the stroke — so every unstitched joint grows a 2.2-unit
// halo stub through whatever the next segment heads into.
//
// It WELDS rather than matching exactly: hand-drawn joints are never exact
// (measured on one real level, seven joints, ONE exact, the rest 0.3–1.8 u
// apart), so an exact rule chains nothing real. WELD is 2.0 — above every real
// joint, and below the game's own 4.4 u wedge rule (2 × her radius), under
// which nothing was ever a deliberate separation. A 45–58 u "one band goes
// here" gap is never touched.

/** Endpoints closer than this are the same point, drawn twice by a human. */
const WELD = 2.0;

const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= WELD;
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
 * T-junctions: pull a loose END onto the surface it was drawn against. A
 * platform butting into a wall lands near the wall's MIDDLE, nowhere near
 * either endpoint, so end-to-end welding never sees it — and under a 15 px
 * stroke a 0.9 u overhang is invisible in Figma while in game it hangs off a
 * 4.4 u halo. Same WELD. Does NOT chain the two; only removes the overhang.
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
 * Two-point segments, in Figma's order -> polylines. Chains grow from BOTH
 * ends and accept a segment drawn in either direction (which way a Line points
 * is which way it was dragged — two lines can share a corner at both their
 * START points). Deterministic: original scan order, lowest index wins. A
 * welded joint keeps the chain's point and DROPS the incoming near-duplicate;
 * nothing moves by more than WELD.
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
  // Ends last: chaining gets first refusal on every endpoint, so two segments
  // that should be one surface are never turned into a T instead.
  return snapTees(out);
}
