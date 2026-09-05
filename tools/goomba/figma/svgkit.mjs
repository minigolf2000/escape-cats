// Shared SVG emitters for make-pack.mjs (the design kit) and levels-to-svg.mjs
// (a pack's levels). THE ONE INVARIANT: every terrain segment is a ZERO-HEIGHT
// horizontal <line> carrying its slope in a rotate() transform — what Figma's
// Line tool (L) produces, whose geometry sits in the plain node record. A
// diagonal vector path keeps its points in a compressed blob and cannot be read
// back. The sim flattens terrain to segments anyway (`segsFor` in
// packages/shared/src/goomba/physics.ts), so separate segments are physically
// identical to a polyline.

export const S = 10; // px per world unit. Levels are ~110x200 units.

export const BG = "#150a2a";   // the game page purple (index.html body)
export const INK = "#f3e9d6";   // terrain, exactly as drawTerrain strokes it
export const MINT = "#57e6c9";
export const PINK = "#ff5db1";
export const CAN = "#ffd166";
export const PLUM = "#ff9dce";
export const AMBER = "#ffd166";
export const RUST = "#ff5db1";
export const GUIDE = "#8a80b0";
export const TEXT = "#c9bdf0";

// True radii, so a glyph in Figma is the size of the thing it stands for.
export const R_GOOMBA = 2.2, R_CAN = 9.7, R_POP = 8.2, R_BUMP = 5.5;
/** Copies of G and the popper fire scale from `packages/shared/src/goomba/
 * levels.ts`, so a gauge can PRINT a number. The sim never reads this file; if
 * `G` or the 0.82 in `stepRun` moves, move these and re-run make-pack. */
export const G_GRAV = 140, POP_FIRE = 0.82;

const r = (v) => Math.round(v * 100) / 100;

/** A fresh document. Everything is px in; callers scale world units by S. */
export function newDoc() {
  const out = [];
  const seen = new Map();
  const uid = (base) => {
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return base + "-" + n;
  };

  const push = (s) => out.push(s);

  /** One terrain segment: a rotated zero-height line. */
  const seg = (x1, y1, x2, y2, o = {}) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    push(
      '<line id="' + (o.id || uid(o.name || "t")) + '" x1="0" y1="0" x2="' +
        r(len) + '" y2="0" transform="translate(' + r(x1) + " " + r(y1) +
        ") rotate(" + r(deg) + ')" stroke="' + (o.stroke || INK) +
        '" stroke-width="' + (o.sw ?? 3) + '" stroke-linecap="round"' +
        (o.dash ? ' stroke-dasharray="' + o.dash + '"' : "") + "/>",
    );
  };

  /** A chain of segments from world-unit points, at a px origin. */
  const poly = (ox, oy, pts, o = {}) => {
    for (let i = 0; i + 1 < pts.length; i++)
      seg(ox + pts[i][0] * S, oy + pts[i][1] * S,
          ox + pts[i + 1][0] * S, oy + pts[i + 1][1] * S, o);
  };

  const label = (x, y, s, o = {}) =>
    push(
      '<text id="' + uid("_lbl") + '" x="' + r(x) + '" y="' + r(y) +
        '" font-family="Inter, Helvetica, Arial, sans-serif" font-size="' +
        (o.size || 13) + '" font-weight="' + (o.weight || 400) + '" fill="' +
        (o.fill || TEXT) + '">' + esc(s) + "</text>",
    );
  const heading = (x, y, s) => label(x, y, s, { size: 19, weight: 700, fill: INK });

  const group = (name, body) => {
    push('<g id="' + uid(name) + '">');
    body();
    push("</g>");
  };

  const circle = (cx, cy, rad, o = {}) =>
    push(
      '<circle cx="' + r(cx) + '" cy="' + r(cy) + '" r="' + r(rad) + '" fill="' +
        (o.fill || "none") + '" stroke="' + (o.stroke || "none") +
        '" stroke-width="' + (o.sw ?? 2) + '"' +
        (o.dash ? ' stroke-dasharray="' + o.dash + '"' : "") + "/>",
    );

  const rawline = (x1, y1, x2, y2, o = {}) =>
    push(
      '<line x1="' + r(x1) + '" y1="' + r(y1) + '" x2="' + r(x2) + '" y2="' +
        r(y2) + '" stroke="' + (o.stroke || INK) + '" stroke-width="' +
        (o.sw ?? 2) + '" stroke-linecap="round"' +
        (o.dash ? ' stroke-dasharray="' + o.dash + '"' : "") + "/>",
    );

  const rect = (name, x, y, w, h, o = {}) =>
    push(
      '<rect id="' + (o.id || uid(name)) + '" x="' + r(x) + '" y="' + r(y) + '" width="' +
        r(w) + '" height="' + r(h) + '"' + (o.rx ? ' rx="' + r(o.rx) + '"' : "") +
        ' fill="' + (o.fill || "none") + '" stroke="' + (o.stroke || "none") +
        '" stroke-width="' + (o.sw ?? 2) + '"' +
        (o.dash ? ' stroke-dasharray="' + o.dash + '"' : "") + "/>",
    );

  // --- toys: every glyph is SYMMETRIC about its anchor, so a reader can take
  // the group's bbox centre. The popper's arrow stays inside its trigger circle
  // so the bbox stays square.

  const start = (x, y) => group("start", () => {
    circle(x, y, R_GOOMBA * S, { fill: MINT });
    rawline(x - 4 * S, y, x + 4 * S, y, { stroke: MINT, sw: 1 });
    rawline(x, y - 4 * S, x, y + 4 * S, { stroke: MINT, sw: 1 });
  });

  const goal = (x, y) => group("goal", () => {
    circle(x, y, 3.4 * S, { stroke: PINK, sw: 3 });
    circle(x, y, 1.2 * S, { fill: PINK });
  });

  const can = (x, y) => group("can", () => {
    circle(x, y, R_CAN * S, { stroke: CAN, sw: 1.5, dash: "6 6" });
    circle(x, y, 1.6 * S, { fill: CAN });
  });

  const bumper = (x, y) => group("bumper", () => {
    circle(x, y, R_BUMP * S, { stroke: RUST, sw: 3 });
    circle(x, y, 1.2 * S, { fill: RUST });
  });

  // Just `pop`: speed is one constant (POP_SPD), never a trailing number.
  const popper = (x, y, spd, deg = 0) => group("pop", () => {
    circle(x, y, R_POP * S, { stroke: AMBER, sw: 1.5, dash: "5 5" });
    circle(x, y, 2 * S, { stroke: AMBER, sw: 3 });
    const a = (deg * Math.PI) / 180, tip = 6.4 * S;
    const tx = x + Math.cos(a) * tip, ty = y + Math.sin(a) * tip;
    rawline(x, y, tx, ty, { stroke: AMBER, sw: 3 });
    for (const s of [1, -1]) {
      const b = a + s * 2.5;
      rawline(tx, ty, tx + Math.cos(b) * 2.2 * S, ty + Math.sin(b) * 2.2 * S,
              { stroke: AMBER, sw: 3 });
    }
  });

  /** Cushions are horizontal-only, so they are a rect: x = left, y = the line. */
  const cushion = (x, y, w) =>
    rect("cushion", x, y - 0.8 * S, w * S, 1.6 * S, { fill: PLUM, rx: 0.8 * S });

  /** A dashed band for make-pack's teaching diagrams. NOT a level part: the
   * readers ignore a layer named `band`. */
  const band = (x1, y1, x2, y2, colour) =>
    seg(x1, y1, x2, y2, { name: "band", stroke: colour || PINK, sw: 4, dash: "14 10" });

  const render = (w, h, note) =>
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
        '" viewBox="0 0 ' + w + " " + h + '">',
      "  <!-- " + note + " -->",
      ...out.map((l) => "  " + l),
      "</svg>",
      "",
    ].join("\n");

  return { seg, poly, label, heading, group, circle, rawline, rect, start, goal,
           can, bumper, popper, cushion, band, render, uid, count: () => out.length };
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A circular arc as `n` chords, starting at the origin and running down-right.
 * convex = a crest she launches off (flat, then steepening).
 * concave = a quarter-pipe that catches her (steep, then flattening).
 */
export function arc(rad, sweepDeg, n, convex) {
  const A = (sweepDeg * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    if (convex) {
      const t = (A * i) / n;
      pts.push([rad * Math.sin(t), rad * (1 - Math.cos(t))]);
    } else {
      const t = A - (A * i) / n; // slope is tan(t): steep at the top, flat at the end
      pts.push([rad * (Math.sin(A) - Math.sin(t)), rad * (Math.cos(t) - Math.cos(A))]);
    }
  }
  return pts;
}

/**
 * A banked piece of track tangent to a point and a HEADING (`loop` is a 270°
 * instance). `dir` +1 banks clockwise on screen, -1 anticlockwise; `degrees` is
 * how far she turns, so a 70° dive into a 45° climb is `bank(x, y, 70, rad,
 * 115, -1)`. Points are the WALL; she rides `rad - R` inside it, which is why
 * the centre is offset by that and not by `rad`.
 *
 * Chaining, both geometry:
 * - Reversing the curvature needs AIR between pieces: where a bowl (holds from
 *   below) meets a loop (holds from above) both surfaces are R from her at
 *   once — the 4.4 u wedge exactly.
 * - A piece she FLIES into carries no material BEHIND its entry: upstream of
 *   the tangent point the circle is inside her parabola and she hits it.
 *   (`loop`'s `back` is for a POPPER entry, which teleports her past it.)
 */
export function bank(x, y, headingDeg, rad, degrees, dir = 1, n) {
  const h = (headingDeg * Math.PI) / 180;
  const u = [Math.cos(h), Math.sin(h)];
  const nrm = dir > 0 ? [-u[1], u[0]] : [u[1], -u[0]];
  const c = [x + (rad - R_GOOMBA) * nrm[0], y + (rad - R_GOOMBA) * nrm[1]];
  const a0 = (Math.atan2(y - c[1], x - c[0]) * 180) / Math.PI;
  const k = n || Math.max(2, Math.round(Math.abs(degrees) / 7.2));
  const pts = [];
  for (let i = 0; i <= k; i++) {
    const a = ((a0 + (dir * degrees * i) / k) * Math.PI) / 180;
    pts.push([c[0] + rad * Math.cos(a), c[1] + rad * Math.sin(a)]);
  }
  return { pts, c, rad, end: pts[pts.length - 1], endHeading: headingDeg + dir * degrees };
}

/**
 * A LOOP-THE-LOOP: plain terrain, a fan of chords she rides from the INSIDE,
 * where the wall's push is the centripetal force. Too slow and she drops off
 * the ceiling through the middle — a readable death, not a jam.
 *
 * At the top she needs `v² ≥ G·(rad − R)`; `minSpd` solves that over the arc
 * she rides and is the popper `spd`. Budget ~30% over it: the fan is a brake
 * (every chord junction is a collision) and a coarse fan brakes harder.
 *
 * - `back`: material carries on BEHIND the entry, so the popper fires along a
 *   surface instead of off a tip.
 * - The gap is on the far side of the entry: a closed ring is a solid wall from
 *   outside, so a loop is a `Ɔ`. Entering at 225° and riding 270° puts the
 *   mouth on the left — in at its top lip, out at its bottom lip a whole radius
 *   clear of the entry.
 * - `coarse`: a `gap` in the ROOF is a band's job, and a band end snaps to the
 *   nearest vertex within 5 u. One long chord at each lip puts the next rival
 *   9 u off, so a jittered end takes the LIP and not a neighbour that leaves
 *   the tip as a kerb. Half-measures are worse than either end.
 *
 * Angles are screen angles: 0 right, 90 down, 270 up (y is DOWN). `dir` 1 is
 * clockwise on screen. Points come back centred on (0,0), in world units.
 */
export function loop(rad, o = {}) {
  const {
    entry = 225, sweep = 270, back = 20, dir = 1,
    gap = 0, gapAt = 270, coarse = 30, n = 50,
  } = o;
  const rd = (a) => (a * Math.PI) / 180;
  const P = (a) => [rad * Math.cos(rd(a)), rad * Math.sin(rd(a))];
  const step = 360 / n;
  const fan = (a, b) => {
    const k = Math.max(1, Math.round(Math.abs(b - a) / step));
    const pts = [];
    for (let i = 0; i <= k; i++) pts.push(P(a + ((b - a) * i) / k));
    return pts;
  };

  const s0 = entry - dir * back, s1 = entry + dir * sweep;
  let arms, gapTips = [];
  if (gap > 0) {
    const near = gapAt - dir * gap / 2, far = gapAt + dir * gap / 2;
    arms = [
      [...fan(s0, near - dir * coarse), P(near)],
      [P(far), ...fan(far + dir * coarse, s1)],
    ];
    gapTips = [P(near), P(far)];
  } else arms = [fan(s0, s1)];

  // The centripetal wire, solved over the arc she rides rather than assumed to
  // bind at the top: she needs v² ≥ −G·rr·sin(phi) to stay on the wall at phi,
  // and gets there with v² = v0² + 2·G·rr·(sin phi − sin entry). Worst phi wins.
  const rr = rad - R_GOOMBA;
  let need = 0;
  for (let a = 0; a <= sweep; a += 1) {
    const phi = entry + dir * a;
    need = Math.max(need, G_GRAV * rr * (2 * Math.sin(rd(entry)) - 3 * Math.sin(rd(phi))));
  }

  return {
    arms,
    gapTips,
    /** Where the entry popper goes: on her riding circle, not on the wall. */
    popper: [rr * Math.cos(rd(entry)), rr * Math.sin(rd(entry))],
    /** ...aimed along the ride. */
    deg: (Math.atan2(dir * Math.cos(rd(entry)), -dir * Math.sin(rd(entry))) * 180) / Math.PI,
    /** ...at no less than this. Give it ~30% over, for the fan's own drag. */
    minSpd: Math.sqrt(need) / POP_FIRE,
  };
}

/** Half-sine bump — a "smooth" hill, which is really just n lines. */
export function hill(w, h, n) {
  const pts = [];
  for (let i = 0; i <= n; i++)
    pts.push([(w * i) / n, -h * Math.sin((Math.PI * i) / n)]);
  return pts;
}

/** Level name -> an XML-safe layer id. The reader reverses this. */
export const slug = (name) =>
  String(name)
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // Piñata -> Pinata
    .replace(/·/g, "")
    .replace(/\s+/g, " ").trim().replace(/ /g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "");
