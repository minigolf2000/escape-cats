// Shared SVG emitters for the Figma bridge — used by make-pack.mjs (the design
// kit you paste in) and levels-to-svg.mjs (the shipped levels, as frames).
//
// THE ONE INVARIANT, and the reason this file exists: every terrain segment is
// emitted as a ZERO-HEIGHT horizontal <line> carrying its slope in a rotate()
// transform — the exact node shape Figma's own Line tool (L) produces. Such a
// node's geometry is fully described by position + width + rotation, all of
// which sit in the plain node record. A diagonal *vector path* keeps its points
// in a compressed blob instead, so a pen-drawn level can't be read back out.
// Lines cost nothing either: the sim flattens terrain to segments anyway
// (`segsFor` in packages/shared/src/goomba/physics.ts), so a bag of separate
// segments is physically identical to an authored polyline.

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

  // --- toys ---------------------------------------------------------------
  // Every glyph is SYMMETRIC about its anchor, so a reader can take the
  // group's bounding-box centre and be exactly right. The popper is symmetric
  // too: its aim arrow lives inside the trigger circle, so the bbox stays
  // square while the rotation stays visible.

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

  const popper = (x, y, spd, deg = 0) => group("pop" + Math.round(spd), () => {
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

  /** A dashed band, for the teaching diagrams in make-pack.mjs ("a band goes
   * here"). NOT a level part: a level frame carries no bands, and the readers
   * ignore a layer named `band` — a level's geometry is the whole of it and
   * what solves it is for players to find. */
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
