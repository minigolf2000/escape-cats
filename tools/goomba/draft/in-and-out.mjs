// LOOP THE LOOP II — "In and Out" — parametric build from the Figma sketch
// (file vRN6Q44ReIaESP5wv8M2dI, node 172:1565).
//
// Two concentric terrain rings cut open by a plus-shaped cross (four doorways
// per ring, N/E/S/W). Between them an annulus tube with a CCW popper conveyor;
// inside the inner ring a CW carousel. Start above the N doorways, plant below
// the S doorways. Every number is measured off the frame (px/10) or is a
// regularisation of hand-placement noise to exact 4-fold symmetry.

export const P = {
  cx: 64.8, cy: 70.2,          // ring centre  (Ellipse 1/2 share it)
  // Drawn rIn 37.9 / rOut 48.25; moved IN and OUT so both popper rings clear
  // the inner wall by 6 units (audit() below).
  rIn: 36.5, rOut: 49.5,
  gap: 4.65,                   // half-width of the cross bars, exactly as drawn
                               // (93px). The chute is what buys this back.
  // The SOUTH doorway alone: at the bottom of a ring the flow is HORIZONTAL and
  // the doorway vertical, so she must turn inside a 9.3-unit window, twice, 13
  // units apart. null means "same as the others".
  gapS: null,
  chute: 4.0,                  // half-width of the start chute
  chuteLo: -3, chuteHi: 7,     // ...and its extent, relative to start y
  seg: 3.2,                    // target arc-chord length for the ring facets

  // Above the drawn 13.6: a chute bar ending within 4.4 (2 x her radius) of the
  // outer arc is a wedge she stalls in.
  start: [64.8, 6],      // dead centre of the chute
  goal: [64.8, 129.0],

  // Annulus conveyor, CCW: twelve stations at 30 deg, phased 15 so none sits
  // over a doorway. At 60-deg steps the chord plus the ballistic bulge (inward,
  // over the bottom half) clips the inner ring and a station becomes an
  // up-column trap; 30 deg dips 1.5.
  rA: 44.5, aN: 12, aPhase: 15, aSpd: 145,
  // Degrees of arc around the BOTTOM (+90) left with no station. Widen it and
  // the conveyor stops being a closed loop and becomes a ride that ENDS at the
  // exit.
  aGapS: 0,
  // ...or keep those stations and make them WEAK: a popper is a flat
  // assignment, so a station firing at 40 drops her back in the trough barely
  // moving, where the bowl's lowest point is the doorway. `aSlowS` is the arc.
  aSlowS: 0, aSpdS: 40,

  // THE DRAIN: one popper at dead centre, aimed straight down. A popper grabs
  // her to its OWN centre before firing, so whatever reaches it leaves from
  // (cx, cy) travelling down — the middle of both south doorways. Neither ring
  // reaches it (r 28.5 and 44.5 against an 8.2 reach): the EXIT, not a shortcut.
  midPop: true, midSpd: 100,
  // A SHELF for the drain, off by default: its target is only the 8.2 popper
  // reach, and a band aimed at a bare popper is far harder to land than one
  // that SLIDES her into it. Two arms sloping down to the drain, with a throat
  // the straight drop still falls through.
  midFunnel: 0, funW: 18, funH: 8, funGap: 5,
  // Inner carousel. `iMode`: 'chord' aims each station at the NEXT one (she
  // flies the diagonals of a square); 'wall' aims TANGENTIALLY plus `iOut`
  // degrees outward, so she is thrown at the wall and rides the inside of it.
  rI: 28.5, iSpd: 145, iN: 8, iMode: 'wall', iOut: 0,
  // `iPhase` decides whether a station sits in the fall shaft. A station must
  // stay ~10 units clear of it laterally (8.2 reach plus her radius), lateral
  // is rI*|cos(theta)|, so none may come within 20.5 deg of +/-90: a 41-deg
  // forbidden band top and bottom. 22.5 is the middle of the only window at
  // eight stations; six cannot pay back what riding terrain costs.
  iPhase: 22.5,   // 90-deg legs are 41.3 long; below spd 131 the vertical leg
                         // cannot reach the next station (up-column trap).

  // WHERE A CAN CAN HIDE. Her pickup reach is 9.7, and three rides cost
  // nothing: the annulus conveyor, the inner carousel, and the BARE FALL down
  // the middle. A can within 9.7 of any of them is a chime, not a constraint.
  // The annulus cannot hide one at all — the tube tops out 6.5 from the free
  // orbit — so cans 1 and 2 are free wherever they sit. The inner circle has
  // two real pockets, both hard against the wall at the doorway angles.
  cans: [
    [28.5, 47.3],   // annulus, NW leg  — free, and unavoidably so
    [86.3, 33.3],   // annulus, NE leg  — ditto
    [50, 70],       // inside, the WEST band. Riding the wall makes the WALL the
                    // free ride, so the pockets are inboard: two vertical bands
                    // either side of the fall shaft, x 48-52 and 76-80. Keep
                    // the two inner cans on OPPOSITE sides of the shaft so no
                    // single chord can sweep both.
    [76, 70.2],     // inside, level with the centre, just east of the drain:
                    // 11.2 from the bare fall line, 1.5 clear of the 9.7 pickup,
                    // the closest a can gets to the middle now that the middle
                    // is the way out.
  ],
};

const D = Math.PI / 180;

/** One ring, cut into four quadrant arcs by the cross. */
function ringArcs(cx, cy, R, gap, seg, gapS) {
  const a = Math.asin(Math.min(1, gap / R)) / D;   // half-angle of an E/W cut
  const b = Math.acos(Math.min(1, gap / R)) / D;   // start of the arc off N
  const bS = Math.acos(Math.min(1, (gapS ?? gap) / R)) / D;  // ...and off S
  // quadrant arcs, in degrees (y-down): NE, SE, SW, NW
  const spans = [[-b, -a], [a, bS], [180 - bS, 180 - a], [-(180 - a), -(180 - b)]];
  const step = (seg / R) / D;
  return spans.map(([t0, t1]) => {
    const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) / step));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = (t0 + (t1 - t0) * (i / n)) * D;
      pts.push([+(cx + R * Math.cos(t)).toFixed(2), +(cy + R * Math.sin(t)).toFixed(2)]);
    }
    return pts;
  });
}

const at = (cx, cy, r, deg) => [+(cx + r * Math.cos(deg * D)).toFixed(2), +(cy + r * Math.sin(deg * D)).toFixed(2)];

/**
 * Aim a popper at the NEXT station, not along the tangent: at the 60-degree
 * steps that leap the doorways the tangent is 30 degrees off and she flies out
 * through the doorway. A popper fires at EXACTLY spd*0.82 from its own centre
 * (physics.ts), so the leg is clean ballistics — take the flatter arc.
 */
function aimAt(from, to, spd) {
  const v = spd * 0.82, g = 140;
  const dx = to[0] - from[0], dy = to[1] - from[1];
  if (Math.abs(dx) < 1e-6) return dy > 0 ? 90 : -90;   // straight up/down
  const k = (g * dx * dx) / (2 * v * v);
  const disc = dx * dx - 4 * k * (k - dy);
  if (disc < 0) return (Math.atan2(dy, dx) / D);       // out of range: point at it
  const r = Math.sqrt(disc);
  const u = Math.abs((-dx + r) / (2 * k)) < Math.abs((-dx - r) / (2 * k))
    ? (-dx + r) / (2 * k) : (-dx - r) / (2 * k);
  const a = Math.atan(u) / D;
  return dx > 0 ? a : a + 180;
}

/** A closed ring of stations, each aimed at the next one round. */
function ring(cx, cy, r, degs, spd) {
  const pts = degs.map((d) => at(cx, cy, r, d));
  return pts.map((p, i) => ({
    x: p[0], y: p[1],
    deg: +aimAt(p, pts[(i + 1) % pts.length], spd).toFixed(2),
    spd,
  }));
}

export function buildLevel(p = P, extra = {}) {
  // THE START CHUTE. START_VX = 20 is unconditional, so a bare drop drifts 24.6
  // units sideways over the 105-unit fall. Two short vertical bars either side
  // of her spend it (E_WALL 0.15), holding the excursion to ~2.8 units so the
  // doorways can stay the width they were drawn.
  const chute = p.chute ? [
    [[p.cx - p.chute, p.start[1] + p.chuteLo], [p.cx - p.chute, p.start[1] + p.chuteHi]],
    [[p.cx + p.chute, p.start[1] + p.chuteLo], [p.cx + p.chute, p.start[1] + p.chuteHi]],
  ] : [];
  const funnel = p.midFunnel ? [
    [[p.cx - p.funW, p.cy - p.funH], [p.cx - p.funGap, p.cy]],
    [[p.cx + p.funW, p.cy - p.funH], [p.cx + p.funGap, p.cy]],
  ] : [];
  const terrain = [
    ...chute,
    ...funnel,
    ...ringArcs(p.cx, p.cy, p.rIn, p.gap, p.seg, p.gapS),
    ...ringArcs(p.cx, p.cy, p.rOut, p.gap, p.seg, p.gapS),
    ...(extra.terrain || []),
  ];
  // stations in flow order: the annulus runs CCW (theta decreasing), the inner
  // carousel runs CW (theta increasing) -- two counter-rotating loops.
  const aDeg = [];                                   // descending = CCW
  for (let i = 0; i < p.aN; i++) {
    const d = p.aPhase + 180 - (i * 360) / p.aN;
    const off = Math.abs(((d - 90) % 360 + 540) % 360 - 180);  // distance to +90
    if (off > (p.aGapS || 0) / 2) aDeg.push(d);
  }
  const annulus = ring(p.cx, p.cy, p.rA, aDeg, p.aSpd);
  if (p.aSlowS) for (let i = 0; i < aDeg.length; i++) {
    const off = Math.abs(((aDeg[i] - 90) % 360 + 540) % 360 - 180);
    if (off <= p.aSlowS / 2) annulus[i].spd = p.aSpdS;
  }
  // The carousel runs CW (theta increasing).
  const iDeg = [];
  for (let i = 0; i < (p.iN || 4); i++) iDeg.push((p.iPhase ?? -135) + (i * 360) / (p.iN || 4));
  const mid = p.midPop
    ? [{ x: p.cx, y: p.cy, deg: 90, spd: p.midSpd }]   // deg 90 is straight down
    : [];
  const inner = p.iMode === 'wall'
    // RIDING THE WALL: from inside a circle a tangential throw drifts OUTWARD,
    // so she meets the wall downrange at a shallow angle and is held against it
    // (v^2/r = 412 against gravity's 140). The stations only pay back what
    // friction takes, ~25% a lap.
    ? iDeg.map((d) => {
        const [x, y] = at(p.cx, p.cy, p.rI, d);
        return { x, y, deg: +(d + 90 - (p.iOut || 0)).toFixed(2), spd: p.iSpd };
      })
    : ring(p.cx, p.cy, p.rI, iDeg, p.iSpd);
  return {
    name: extra.name || 'In and Out',
    budget: 4,
    start: [...p.start],
    goal: [...p.goal],
    terrain,
    cans: p.cans.map((c) => [...c]),
    pops: [...annulus, ...inner, ...mid],
    solution: extra.solution || [],
  };
}

/**
 * TWO RINGS OF POPPERS MUST NOT REACH INTO EACH OTHER'S ROOM.
 *
 * A popper has no line of sight: it grabs anything whose CENTRE is within
 * `POP_R + R` = 8.2, through terrain. Her centre presses to `rIn ± 2.2` against
 * the inner wall from either side, so BOTH rings need 6 units from that wall:
 *
 *     rA - rIn > 6      an annulus station must not reach inside
 *     rIn - rI > 6      a carousel station must not reach into the annulus
 *
 * The rule brackets rIn from BOTH sides, so shrinking the inner circle is only
 * half a fix. Pure geometry, but keep ~1.5 units: a 145 u/s substep covers 0.6
 * units, so she can sink that far into a wall before the contact resolves.
 */
export function audit(p = P) {
  const REACH = 6 + 2.2;          // POP_R + R
  const R = 2.2;
  const rows = [
    ["annulus popper vs the inner room", p.rA - REACH - (p.rIn - R), "rA - rIn > 6"],
    ["carousel popper vs the annulus",   (p.rIn + R) - (p.rI + REACH), "rIn - rI > 6"],
    ["annulus popper vs the outer wall", p.rOut - p.rA - R, "she must fit at a station"],
    ["carousel station inside its ring", p.rIn - R - p.rI, "ditto, inner"],
  ];
  return rows.map(([name, clear, rule]) => ({
    name, rule, clear: +clear.toFixed(2), ok: clear >= 1.5,
  }));
}
