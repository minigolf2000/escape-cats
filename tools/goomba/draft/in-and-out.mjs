// LOOP THE LOOP II — "In and Out" — parametric build from the Figma sketch
// (file vRN6Q44ReIaESP5wv8M2dI, node 172:1565), read via the Figma MCP server.
//
// Two concentric terrain rings cut open by a plus-shaped cross: four doorways
// per ring, at N/E/S/W. Between the rings, an annulus tube with an 8-popper
// counter-clockwise conveyor. Inside the inner ring, a 4-popper CLOCKWISE
// carousel. Start above the N doorways, plant below the S doorways.
//
// Every number below is either measured off the Figma frame (px/10) or is a
// deliberate regularisation of hand-placement noise to exact 4-fold symmetry.

export const P = {
  cx: 64.8, cy: 70.2,          // ring centre  (Ellipse 1/2 share it)
  // Drawn: rIn 37.9, rOut 48.25 (Ellipse 1 = 758px dia, Ellipse 2 = 965px).
  // Both rings moved to satisfy audit() below -- the inner one IN, the outer one
  // OUT, because the two popper rings must each clear the inner wall by 6 units
  // and 43.4 - 29.2 = 14.2 was not enough room for both.
  rIn: 36.5, rOut: 49.5,
  gap: 4.65,                   // half-width of the cross bars, exactly as drawn
                               // (93px). The chute is what buys this back.
  // The SOUTH doorway on its own. At the bottom of a ring the flow is
  // HORIZONTAL and the doorway is vertical, so she has to convert her direction
  // inside a 9.3-unit window — twice, 13 units apart. Measured, only 3.6% of
  // single-band placements get her out of the annulus that way. `gapS` widens
  // just that one door; null means "same as the others".
  gapS: null,
  chute: 4.0,                  // half-width of the start chute
  chuteLo: -3, chuteHi: 7,     // ...and its extent, relative to start y
  seg: 3.2,                    // target arc-chord length for the ring facets

  // Raised from the drawn 13.6: the outer ring grew, and a chute bar ending
  // 1.5 units above an arc is a wedge she can stall in (nothing may come closer
  // than 4.4 = 2 x her radius). At 6 the bars finish well clear of it.
  start: [64.8, 6],      // dead centre of the chute
  goal: [64.8, 129.0],

  // Annulus conveyor, running CCW. TWELVE stations at a uniform 30 deg, phased
  // 15 deg so none sits over a doorway. The sketch's eight (diagonal +/- 30)
  // leave 60-degree leaps, and a 60-degree chord at r 43.4 dips to 37.6 while
  // the ballistic bulge adds ~2.3 more INWARD across the two lower diagonals
  // (over the bottom half, "above the chord" points at the centre). That clips
  // the inner ring and the station becomes an up-column trap. 30 deg dips 1.5.
  rA: 44.5, aN: 12, aPhase: 15, aSpd: 145,
  // Degrees of arc around the BOTTOM (+90) left with no station. The trough at
  // the foot of the annulus is already a bowl whose lowest point is the south
  // doorway, so anything landing there wants to drain out of it — but the two
  // stations flanking the bottom sit 11.5 units either side of the shaft and
  // re-grab her before she can. Widen this and the conveyor stops being a
  // closed loop and becomes a one-way ride that ENDS at the exit.
  aGapS: 0,
  // ...or keep them and make them WEAK. A popper is a flat assignment, so a
  // station firing at 40 puts her back in the trough barely moving, where the
  // bowl's own lowest point is the doorway. The loop stays closed; the exit
  // stops being a needle. `aSlowS` is the arc it applies over.
  aSlowS: 0, aSpdS: 40,

  // THE DRAIN. One popper at the dead centre of the board, aimed straight down.
  // A popper grabs her to its OWN centre before firing, so whatever reaches it
  // leaves from exactly (cx, cy) travelling exactly down — which is the middle
  // of both south doorways. It turns "thread two 9.3-unit holes while moving
  // sideways at 119" into "touch the middle". Neither ring goes near it (the
  // carousel rides at r 28.5, the conveyor at 44.5, against an 8.2 reach), so
  // reaching it stays a job; it is the EXIT, not a shortcut.
  midPop: true, midSpd: 100,
  // A SHELF for the drain, off by default until it is measured. The drain works
  // perfectly once she touches it, but its target is only the 8.2 popper reach —
  // a 16-unit disc in a 73-unit room — and a band aimed at a bare popper is the
  // worst-scoring job there is (~3% on finger slop; a shelf that SLIDES her into
  // one scores 65%). So: two arms sloping down to the drain, with a gap at the
  // throat wide enough that the straight drop still falls through.
  midFunnel: 0, funW: 18, funH: 8, funGap: 5,
  // inner carousel: 4 stations on the diagonals, tangential CW
  // Inner carousel. `iMode` is the whole character of the inner room:
  //   'chord' — each station aims at the NEXT one, so she flies the diagonals
  //             of a square and the circle is just where the stations sit.
  //   'wall'  — each station aims TANGENTIALLY, plus `iOut` degrees outward, so
  //             she is thrown at the wall and rides the inside of it.
  rI: 28.5, iSpd: 145, iN: 8, iMode: 'wall', iOut: 0,
  // `iPhase` is what decides whether a station sits in the fall shaft, and it
  // matters more than the COUNT does. A station must stay ~10 units clear of
  // the shaft laterally (its 8.2 reach plus her radius), and lateral is
  // rI*|cos(theta)| — so no station may come within 20.5 degrees of +/-90.
  // That is a 41-degree forbidden band at the top and another at the bottom.
  // Six stations sit 60 apart, which straddles a 41-degree band comfortably;
  // eight sit 45 apart, which only just does.
  // 22.5 is the middle of the only window that works at eight stations. SIX is
  // not available, and not for want of a phase: at 60 apart the shaft window is
  // twice as wide (20 degrees against 10), but six stations cannot pay back
  // what riding terrain costs — she bleeds 127 -> 45 u/s in a quarter lap and
  // drops out at 1.17s. Seven sustains it and is odd; eight is the first even
  // count that both laps and clears the shaft.
  iPhase: 22.5,   // 90-deg legs are 41.3 long; below spd 131 the
                         // vertical leg cannot reach the next station and the
                         // carousel becomes an up-column trap (loop).

  // WHERE A CAN CAN HIDE, measured (hide-probe.mjs). Her pickup reach is 9.7,
  // and there are three rides that cost nothing: the annulus conveyor, the
  // inner carousel, and the BARE FALL down the middle. A can within 9.7 of any
  // of them is a chime, not a constraint.
  //
  // The annulus cannot hide one AT ALL — the tube tops out 6.5 from its own
  // orbit, so cans 1 and 2 are free wherever they sit and stay where they were
  // drawn. The inner circle has exactly two real pockets, both hard against the
  // wall at the doorway angles, plus a 0.8-wide sliver between the fall shaft
  // and the carousel's east leg.
  cans: [
    [28.5, 47.3],   // annulus, NW leg  — free, and unavoidably so
    [86.3, 33.3],   // annulus, NE leg  — ditto
    [50, 70],       // inside, the WEST band. It was at (96.5,62), hard against
                    // the east wall, which was the only pocket there was while
                    // the carousel flew chords. Riding the wall makes the WALL
                    // the free ride, so the pockets moved inboard: two vertical
                    // bands either side of the fall shaft, x 48-52 and 76-80,
                    // 10-14 clear. Put the two inner cans on OPPOSITE sides of
                    // the shaft so no single chord can sweep both.
    [76, 70.2],     // inside, level with the centre and just east of the drain.
                    // It was at 74.5, which the popper at the middle moved to
                    // EXACTLY 9.7 from the bare fall line — the pickup radius to
                    // the digit. 76 is 11.2, the 1.5 of margin everything else
                    // on this board keeps, and still the closest a can gets to
                    // the middle now that the middle is the way out.
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
 * Aim a popper at the NEXT station, not along the tangent.
 *
 * The sketch draws every popper tangential, which is only the chord when the
 * step is infinitesimal. At the 60-degree steps that leap the doorways the
 * tangent is 30 degrees off, and she flies straight out of the ring through
 * the very doorway the step was meant to cross. A popper fires at EXACTLY
 * spd*0.82 from its own centre (physics.ts), so the leg is clean ballistics
 * and the aim is solvable: pick the flatter of the two arcs that lands on the
 * next station.
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
  // THE START CHUTE. START_VX = 20 is unconditional and never spent, so a bare
  // drop drifts 24.6 units sideways over the 105-unit fall from cat to plant --
  // far more than any doorway worth drawing. Two short vertical bars either side
  // of her spend it instead: she crosses to the right bar in 0.14s, comes off it
  // at 0.15 restitution (E_WALL) doing -3, and the remaining fall drifts her
  // only 3.6 back the other way. Total excursion ~2.8 units, so the doorways can
  // stay the width they were drawn.
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
    // RIDING THE WALL rather than crossing the room. From inside a circle a
    // tangential throw drifts OUTWARD — the tangent to r_I lies outside it — so
    // she meets the wall a little downrange at a shallow angle and is then held
    // against it, because at 118.9 u/s her arc is far flatter than the circle
    // (v^2/r = 412 against gravity's 140, so the wall pushes her inward and she
    // follows it). The stations stop being waypoints and become the thing that
    // pays back what friction takes, ~25% a lap.
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
 * A popper has no line of sight — it grabs anything whose CENTRE is within
 * `POP_R + R` = 8.2 of it, and terrain does not block that. So on concentric
 * rings the only thing separating the annulus conveyor from the inner carousel
 * is arithmetic, and it is not automatic: her centre presses to `rIn - 2.2`
 * against the inner wall from the inside, and to `rIn + 2.2` from the annulus
 * side, so BOTH rings need 6 units of clearance from that wall:
 *
 *     rA - rIn > 6      an annulus station must not reach inside
 *     rIn - rI > 6      a carousel station must not reach into the annulus
 *
 * At the drawn radii (rI 29.2, rIn 37.9, rA 43.4) the first is -0.5 — an
 * annulus popper snatches her off the inner wall, which is how one band bought
 * a whole second ring in the first shortcut the beam search found. The rule
 * also brackets rIn from BOTH sides, which is why shrinking the inner circle is
 * only half the fix: shrink it far enough and the carousel starts reaching OUT.
 *
 * This is pure geometry, so the margin is deterministic — nothing jitters it —
 * but keep ~1.5 units anyway: a 145 u/s substep covers 0.6 units, so she can
 * momentarily sink that far into a wall before the contact resolves.
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
