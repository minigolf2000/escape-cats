// Figma SHAPES as terrain, and `cut` layers that take terrain away.
//
// Terrain used to have to be a Line, and the reason was sound: a Line is a
// zero-height node whose stored geometry IS the segment, while `(0,0)-(w,0)` on
// a pen path is the top edge of a bounding box that can be nowhere near what
// was drawn. That argument never applied to a RECTANGLE or an ELLIPSE, whose
// outlines ARE their box — so those two are read here exactly, and the pen is
// still refused.
//
// `cut` is the other half, and it is the piece that makes a ring level
// drawable. A doorway in a wall is not a shape anyone wants to draw as two
// shapes; it is one shape with a hole punched through it. So a layer named
// `cut` is a shape that SUBTRACTS: every terrain polyline is clipped against
// it, splitting where it enters and rejoining where it leaves. Two crossed
// rectangles over two concentric circles is then eight arcs, which is a level.
//
// Everything here works in WORLD units (the caller has already divided by the
// 10 px/unit scale), except the matrices, which are Figma's own px-space
// affines — so `inside()` scales back up before applying one.

const S = 10; // px per world unit, as in clipboard.js
const ROUND = (v) => Math.round(v * 10) / 10;

/** Invert a 2x3 affine laid out [a b tx / c d ty]. Null if singular. */
export function invert(m) {
  const det = m[0] * m[4] - m[1] * m[3];
  if (!det || !Number.isFinite(det)) return null;
  const a = m[4] / det, b = -m[1] / det, c = -m[3] / det, d = m[0] / det;
  return [a, b, -(a * m[2] + b * m[5]), c, d, -(c * m[2] + d * m[5])];
}

const apply = (m, x, y) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];

/** How many facets a curve of this many px gets: ~3 world units a chord. */
const facets = (px) => Math.max(8, Math.min(256, Math.ceil(px / (3 * S))));

/**
 * A rectangle's outline as a CLOSED polyline, honouring its corner radius.
 *
 * The radius is not decoration here. Two terrain segments meeting at a sharp
 * inside corner wedge her (nothing closer than 4.4 u = 2x her radius), so a
 * rounded corner is a physically different object from a square one, and a
 * rounded-rectangle node that came back square would be a silent lie about
 * whether the level stalls her.
 */
export function rectPoly(m, w, h, radius = 0) {
  const r = Math.max(0, Math.min(radius || 0, w / 2, h / 2));
  const pts = [];
  if (r < 0.5) {
    for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]) pts.push(apply(m, x, y));
  } else {
    const n = facets((Math.PI * r) / 2);
    // centres of the four corner arcs, with the angle each sweeps FROM
    const corners = [
      [w - r, r, -Math.PI / 2], [w - r, h - r, 0],
      [r, h - r, Math.PI / 2], [r, r, Math.PI],
    ];
    for (const [cx, cy, a0] of corners)
      for (let i = 0; i <= n; i++) {
        const a = a0 + (Math.PI / 2) * (i / n);
        pts.push(apply(m, cx + r * Math.cos(a), cy + r * Math.sin(a)));
      }
    pts.push(pts[0]);
  }
  return pts.map(([x, y]) => [ROUND(x / S), ROUND(y / S)]);
}

/** An ellipse's outline as a closed polyline. */
export function ellipsePoly(m, w, h) {
  const rx = w / 2, ry = h / 2;
  const n = facets(Math.PI * (rx + ry));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    const [x, y] = apply(m, rx + rx * Math.cos(a), ry + ry * Math.sin(a));
    pts.push([ROUND(x / S), ROUND(y / S)]);
  }
  return pts;
}

/**
 * An "is this world point inside me?" test for one `cut` shape.
 *
 * Built from the node's own inverse transform, so rotation and flips come free
 * and the caller never has to think about them — the test is done in the
 * shape's local box, where a rectangle is `0..w x 0..h` and an ellipse is the
 * unit circle.
 */
export function cutTester(kind, m, w, h, radius = 0) {
  const inv = invert(m);
  if (!inv || w <= 0 || h <= 0) return null;
  if (kind === "ellipse") {
    const rx = w / 2, ry = h / 2;
    return (X, Y) => {
      const [x, y] = apply(inv, X * S, Y * S);
      const u = (x - rx) / rx, v = (y - ry) / ry;
      return u * u + v * v <= 1;
    };
  }
  const r = Math.max(0, Math.min(radius || 0, w / 2, h / 2));
  return (X, Y) => {
    const [x, y] = apply(inv, X * S, Y * S);
    if (x < 0 || y < 0 || x > w || y > h) return false;
    if (r < 0.5) return true;
    const dx = Math.max(0, Math.max(r - x, x - (w - r)));
    const dy = Math.max(0, Math.max(r - y, y - (h - r)));
    return dx * dx + dy * dy <= r * r;
  };
}

/**
 * Clip every polyline against every cut, returning the surviving pieces.
 *
 * The AUTHORED vertices are kept exactly; the only points this adds are the two
 * where a surface crosses a cut's edge. (An earlier pass densified to one point
 * a unit and re-simplified afterwards, which quietly re-faceted every arc to
 * whatever the simplifier liked rather than to what was drawn.)
 *
 * A crossing is FOUND by sampling and then bisected, rather than solved: a cut
 * can be a rounded rect or an ellipse under an arbitrary affine, so there is no
 * one closed form, and sampling also catches the case a solver needs written
 * separately — a long segment that enters AND leaves a cut with both of its
 * endpoints in open air.
 */
export function applyCuts(polys, tests) {
  if (!tests.length) return polys;
  const inside = (p) => tests.some((t) => t(p[0], p[1]));
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  /** The boundary point between an outside `a` and an inside `b`. */
  const edge = (a, b) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inside(lerp(a, b, mid))) hi = mid; else lo = mid;
    }
    const p = lerp(a, b, lo);
    return [ROUND(p[0]), ROUND(p[1])];
  };

  const out = [];
  for (const poly of polys) {
    if (poly.length < 2) continue;
    let run = [], was = inside(poly[0]);
    const flush = () => { if (run.length >= 2) out.push(run); run = []; };
    if (!was) run.push(poly[0]);
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1], b = poly[i];
      // ~half a unit a sample: every cut worth drawing is a doorway, and the
      // narrowest thing she fits through is 4.4 units wide.
      const n = Math.max(2, Math.min(128, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2)));
      let prev = a;
      for (let k = 1; k <= n; k++) {
        const p = k === n ? b : lerp(a, b, k / n);
        const now = inside(p);
        if (now !== was) {
          if (now) { run.push(edge(prev, p)); flush(); }
          else run = [edge(p, prev)];
          was = now;
        }
        prev = p;
      }
      if (!was) run.push(b);
    }
    flush();
  }
  return out;
}
