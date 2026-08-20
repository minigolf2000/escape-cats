// Goomba Glider level data + physics constants — the ONLY copy.
//
// The single-file prototype these grew from is deleted; levels are designed by
// editing THIS file and running the tools in tools/goomba/ (start with its
// DESIGNING.md — the loop, the locked 4-band party rule, and the anti-shortcut
// vocabulary live there).
//
// The client animates a run with this sim while the server has already scored
// it with the same sim, so a constant changed in only one place would show as
// a cat teleporting at the finish line — there is deliberately no other place.

export const G = 140; // gravity, units/s^2
export const R = 2.2; // Goomba's collision radius
export const START_VX = 20; // the little push when PLAY is hit
export const MAX_SPEED = 120;
export const BAND_MAX = 58; // one silly band's worth of stretch
export const BAND_MIN = 6;
/** Team budget: 4 players × 1 band. This is the LOCKED party rule — every level
 * ships with 4 band slots, and how they are shared out is not up to the team:
 * no player may hold more than ⌈MAX_BANDS / players in the room⌉ of them at
 * once (`bandQuota` in sim.ts). Four players means exactly one each. */
export const MAX_BANDS = 4;
export const SUB = 1 / 240; // physics substep
export const RUN_MAX = 15; // seconds before we call a run stuck
export const KIND_GROUND = 0,
  KIND_BAND = 1,
  KIND_CUSH = 2;
export const E_KIND = [0.02, 0.32, 1.3]; // restitution: ground, band, cushion
export const FR_KIND = [0.18, 0.06, 0.02]; // friction
export const POP_R = 6; // party-popper trigger radius
export const POP_R2 = (POP_R + R) * (POP_R + R);
export const POP_COOLDOWN = 0.8;
export const CAN_R = 7.5; // watering-can pickup radius
export const BUMP_R = 5.5,
  BUMP_E = 1.18,
  BUMP_MIN = 58; // piñata bumper: pinball-style radial kick

export type Pt = [number, number];

export interface GoombaPopper {
  x: number;
  y: number;
  deg: number;
  spd: number;
  /** Derived by initLevel. */
  ux?: number;
  uy?: number;
  vx?: number;
  vy?: number;
}

export interface GoombaCushion {
  x: number;
  y: number;
  w: number;
}

export interface GoombaBumper {
  x: number;
  y: number;
}

export interface GoombaLevel {
  name: string;
  /** Historical per-level allowance. The shipped game ignores it — the party
   * rule locks every level to MAX_BANDS slots — but the design bench still
   * reads it, so it rides along in the mirror. */
  budget?: number;
  maxSpeed?: number;
  start: Pt;
  goal: Pt;
  terrain: Pt[][];
  /** Watering cans: all of them must be collected before the goal unlocks. */
  cans?: Pt[];
  cushions?: GoombaCushion[];
  pops?: GoombaPopper[];
  bumpers?: GoombaBumper[];
  solution?: [Pt, Pt][];
  /** Derived by initLevel. */
  bounds?: { x0: number; y0: number; x1: number; y1: number };
  startAngle?: number;
}

/** A level with every optional collection and derived field filled in. */
export interface GoombaLevelInit extends GoombaLevel {
  cans: Pt[];
  cushions: GoombaCushion[];
  pops: Required<GoombaPopper>[];
  bumpers: GoombaBumper[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
  startAngle: number;
}

/** World bounds + popper aim vectors + start-pad angle — the prototype's
 * initLevel, verbatim. */
export function initLevel(L: GoombaLevel): GoombaLevelInit {
  L.cushions = L.cushions || [];
  L.pops = L.pops || [];
  L.cans = L.cans || [];
  L.bumpers = L.bumpers || [];
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9;
  const eat = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const poly of L.terrain) for (const [x, y] of poly) eat(x, y);
  for (const c of L.cushions) {
    eat(c.x, c.y);
    eat(c.x + c.w, c.y);
  }
  for (const pp of L.pops) {
    eat(pp.x - 6, pp.y - 6);
    eat(pp.x + 6, pp.y + 6);
  }
  for (const m of L.cans) eat(m[0], m[1]);
  for (const bp of L.bumpers) {
    eat(bp.x - BUMP_R, bp.y - BUMP_R);
    eat(bp.x + BUMP_R, bp.y + BUMP_R);
  }
  eat(L.goal[0], L.goal[1]);
  eat(L.start[0], L.start[1]);
  L.bounds = { x0: x0 - 8, y0: y0 - 16, x1: x1 + 8, y1: y1 + 8 };
  for (const pp of L.pops) {
    const rad = (pp.deg * Math.PI) / 180;
    pp.ux = Math.cos(rad);
    pp.uy = Math.sin(rad);
    pp.vx = pp.ux * pp.spd;
    pp.vy = pp.uy * pp.spd;
  }
  L.startAngle = 0;
  for (const poly of L.terrain)
    for (let i = 0; i + 1 < poly.length; i++) {
      const [ax, ay] = poly[i],
        [bx, by] = poly[i + 1];
      if (
        L.start[0] >= Math.min(ax, bx) &&
        L.start[0] <= Math.max(ax, bx) &&
        Math.abs(bx - ax) > 1
      ) {
        L.startAngle = Math.atan2(by - ay, bx - ax);
        break;
      }
    }
  return L as GoombaLevelInit;
}

// One lane of Cat's Cradle: every popper in a lane aims the same way, which
// makes the lane a one-way street she cannot leave under her own power. The
// two column sets are offset half a step from each other, so the lanes
// interlock and no vertical corridor runs clean through the lattice.
//
// The fire speed is what keeps a SPARSE lane alive. Columns are 24 apart while
// a popper's reach is only ~8 (POP_R + R), so the trigger circles never touch
// and a lane can only grab her while she is flying ALONG it: leaving at
// LANE_SPD × 0.82 ≈ 86 she crosses the 24 units to the next popper having
// dropped ~6, comfortably inside the grab. Slow the lane down and the chain
// breaks in the middle; that is the number to re-check before moving a column.
const LANE_SPD = 105;
const LANE_ODD = [26, 50, 74]; // lanes 1 and 3
const LANE_EVEN = [38, 62, 86]; // lanes 2 and 4, half a step over
const lane = (y: number, xs: number[], dir: number): GoombaPopper[] =>
  xs.map((x) => ({ x, y, deg: dir > 0 ? 0 : 180, spd: LANE_SPD }));

const RAW_LEVELS: GoombaLevel[] = [
  // Rebuilt from a hand sketch: a staircase of four ledges the eye reads
  // top-left → top-right → across → down-right, with the spider plant alone on
  // the ground far below. The shapes are the sketch's, transcribed 1:1.
  //
  //   1. the start pad, pitched down-right, ending in a small gap
  //   2. the V, top-right — can 1 rides in its throat, and its short right arm
  //      throws her off the right edge of the world
  //   3. the big chevron across the middle — the bowl that eats a missed
  //      bridge: she rocks in it and never climbs out
  //   4. the diagonal, lower-right, and the second can hanging under it
  //
  // DEBT, measured not inherited: this one is honestly a THREE-band level, and
  // ships that way (budget 3, a 3-band solution) alongside levels 3 and 4 —
  // `solve.mjs 0 1` and `0 2` both come back empty, `0 3` solves. It is not a
  // shortcut that wants patching: `node reach.mjs 0 3 --drop-can 1 --near
  // 72,82` reports ZERO cells a 4-band win reaches that a 3-band win does not,
  // so no position for the second can forces a 4th band. Two reasons, both
  // structural — a band stretches 58 units across a world only ~110 wide, and
  // the flat full-width ground is near-frictionless, so it delivers her to the
  // plant from anywhere on it. Requiring 4 would take geometry the sketch does
  // not have (a broken floor, a popper, a fence). Kept as drawn on purpose.
  //
  // The three jobs, each with its own legible death (drop-one, measured:
  // loop / fall / fall):
  //   1. BRIDGE the pad's gap  — drop it and she passes UNDER the V's left arm
  //      into the chevron, where she rocks until the run is called
  //   2. WALL the right shaft  — drop it and the V's short right arm throws her
  //      clean off the right edge of the world
  //   3. CATCH her under the diagonal — drop it and she lands on the diagonal
  //      instead, rides it out over the plant with only one can, and slides off
  //      the left end of the ground with the plant still locked
  { name: '1 · The Long Way Down', budget: 3,
    start: [8, 4],
    terrain: [
      [[6, 6], [41, 13]],               // the start pad
      [[58, 11], [77, 27], [91, 25]],   // the V — can 1 in its throat
      [[0, 46], [32, 56], [89, 35]],    // the chevron: the bowl that eats a miss
      [[61, 68], [106, 51]],            // the diagonal
      [[0, 121], [110, 121]] ],         // the ground, the plant near its left end
    goal: [27, 120],
    cans: [[84, 22], [72, 82]],
    solution: [ [[41, 13], [58, 11]], [[117, 32], [110, 73]],
                [[112, 74], [64, 95]] ] },

  // Rebuilt from a pair of hand sketches. The second one redrew the run-up: not
  // hops through empty air but a slope CURVING EVER UPWARD that Goomba rides,
  // party poppers shooting her along it, and jagged terrain the players' bands
  // smooth out. That is what this is. Above it the sketch's other beats stand
  // unchanged — big airtime up the right-hand side onto a bouncy hung high with
  // a fence beyond it, three watering cans strung across the sky tracing the
  // flight home, and the spider plant alone on the left.
  //
  // THE SLOPE IS ONE POLYLINE, a concave-up curve from (0,180) to the launcher's
  // perch at (92,71) — flat at the left, ~68° at the top — with three long rough
  // steps notched into it and a popper on the smooth pad before each. Every notch
  // is cut PERPENDICULAR to the slope, which is the whole trick: its far wall and
  // its ratchet teeth then face squarely back down-slope, so a Goomba riding up
  // meets them head-on and stops dead. (A notch with VERTICAL walls does not
  // work — the far wall becomes a rail that carries her UP past the rim on her
  // own tangential speed. That draft shipped nothing.) And because the slope
  // steepens, a Goomba who leaves the near rim along the tangent can never reach
  // the far rim at ANY speed: she is always below it and lands on the wall. So
  // the notches bite whether she arrives at 40 u/s or 140, and the players' only
  // verb is to string a chord rim-to-rim and let her skim across it.
  //
  // The four jobs — three chords up the slope, then the flight home:
  //   1. CHORD the first notch, the long shallow one off the start
  //   2. CHORD the second, mid-slope
  //   3. CHORD the third, the steep one under the launcher's perch
  //   4. STOP her at the end of the flight home. The launcher fires her almost
  //      straight up; she clips the bouncy's top-left corner on the way down
  //      (the one arrival speed that does) and is mirrored into a flat 90 u/s run
  //      to the left, sweeping all three cans. Bare, that run sails over the
  //      plant and off the left edge of the world; a wall in its path (x ≈ -2..9,
  //      a 12-unit window) kills the leftward speed and drops her into the basin.
  //      The cans ARE the hint — they are the flight path, drawn.
  //
  // Two numbers hold the level up. The notches are LONG (chords of 28-40) and
  // cover most of the slope, because the beam search's favourite trick is a band
  // laid steeper than the surface: it bridges one notch AND launches her off its
  // upper end over the next. Wide notches mean every arc lands in one. And every
  // rim vertex sits ~9 units clear of its neighbours, so a ±3u jittered band end
  // snaps back to the rim it was aimed at rather than to a tooth — that is what
  // makes a level of exact ballistics score 29/30 on finger slop.
  //
  // Full gate PASS: bare fails, four legal bands win at 3.9s, all four
  // load-bearing (drop-one → stall in notch 1, stall in notch 2, stall in notch
  // 3, off the left edge past the plant), jitter 29/30, no 1-band win over 9567
  // exhaustive placements, none in 30000/20000 sampled 2/3-band sets, and no
  // ≤3-band win from the beam search.
  { name: '2 · The Long Way Up', budget: 4, maxSpeed: 145,
    start: [4, 176],
    terrain: [
      // the slope: smooth pad, notch, pad, notch, pad, notch, pad to the launcher
      [[0, 180], [10, 178.5], [14.5, 187], [20, 185],
       [19, 182.5], [27, 181], [26, 179], [34, 177],
       [32.5, 175], [40, 172], [38.5, 170], [45, 167],
       [40, 159.5], [48, 150.5], [56, 154.5], [59.5, 150.5],
       [57.5, 149], [63.5, 144.5], [61.5, 143], [67.5, 138.5],
       [65.5, 137], [71.5, 132], [69.5, 131], [75, 126],
       [73, 124.5], [77, 123], [70, 117], [76, 105.5],
       [85.5, 108.5], [87, 104.5], [84.5, 103.5], [90, 99],
       [87, 98], [92.5, 93.5], [89.5, 92.5], [95, 88],
       [92, 87], [96, 86], [88, 80.5], [92, 71]],
      [[115, 28], [117, 50], [116, 72]],     // the fence: an overshoot dies here
      [[5, 150], [15, 160], [24, 150]],      // the spider plant's basin
    ],
    goal: [15, 159],
    // strung along the flight home, in the order she sweeps them
    cans: [[80, 57], [50, 72], [24, 98]],
    // each rides 2.2 off the surface (her own riding height) and aims 3° into the
    // slope, so she stays pressed to it instead of sailing over the next notch
    pops: [ { x: 5.7, y: 177.4, deg: -6, spd: 150 },
            { x: 42.4, y: 153.6, deg: -46, spd: 150 },
            { x: 71.1, y: 110.3, deg: -59, spd: 150 },
            { x: 92, y: 71, deg: -87, spd: 130 } ],  // the launcher
    bumpers: [{ x: 105, y: 60 }],              // the bouncy, hung high right
    solution: [ [[10, 178.5], [40, 159.5]], [[48, 150.5], [70, 117]],
                [[76, 105.5], [88, 80.5]], [[4, 104], [4, 136]] ] },

  // The floor is pitched 20 units over 98 (0.204), not the 6 it used to be.
  // The old 0.061 was under the ~0.12 stranding threshold, and worse, under
  // what it takes to beat the snowboard pump: the pump shoves her the way she
  // FACES, so a soft leftward landing near the left wall pumped her into the
  // corner and stalled there — 741 of 3312 sampled left-side arrivals never
  // reached the plant. At 0.204 gravity outvotes the pump and every one of
  // those 3312 slides down to the plant on the right. It cost nothing: the
  // 3-band solution still wins (1.3s faster) and the level still needs 3.
  { name: '3 · Watering Can Slalom', budget: 3,
    start: [10, 22],
    terrain: [ [[-4, 20], [30, 30]],
               [[6, 34], [6, 190], [104, 210], [104, 34]] ],
    goal: [96, 205],
    cans: [[32, 72], [76, 118], [32, 164]],
    solution: [ [[29.4, 6.8], [40.4, 47.6]], [[28.2, 85.3], [40.8, 88.6]],
                [[87, 132.3], [45.9, 160.8]] ] },

  { name: '4 · Piñata Alley', budget: 3,
    start: [8, 14],
    terrain: [ [[-6, 12], [38, 24]],
               [[4, 30], [4, 190], [106, 196], [106, 30]] ],
    goal: [96, 191],
    cans: [[24, 92], [86, 150]],
    // curtains, not obstacles: the gaps are narrower than she is, so she MUST bounce
    bumpers: [ { x: 16, y: 62 }, { x: 34, y: 62 }, { x: 52, y: 62 },
               { x: 70, y: 62 }, { x: 88, y: 62 },
               { x: 25, y: 122 }, { x: 43, y: 122 }, { x: 61, y: 122 },
               { x: 79, y: 122 }, { x: 97, y: 122 } ],
    solution: [ [[97.5, 121.4], [114.6, 94.6]], [[20.8, 59.6], [22.7, 93.4]] ] },

  // CAT'S CRADLE — the sparse staggered lattice, drawn from a sketch, that
  // replaced The Popper Grid (four DENSE lanes of six poppers 16 apart, plus an
  // entry chute and a V-basin; git history has the geometry). The finding it
  // proved survives it: alternating lanes of forced poppers make a 2D line maze
  // whose only verb is WALL A LANE, and that is the one structure whose true
  // minimum is 4 bands. What changed is the density. Three poppers a lane, 24
  // apart, so their trigger circles never touch, and the lanes interlock half a
  // step so no vertical corridor runs clean through. And there is NO TERRAIN AT
  // ALL: twelve poppers, three cans and the plant hang in the void, and the
  // players' four bands are the only surfaces in the world.
  //
  // ONE verb, four times: wall the END of a lane. She rebounds off the band
  // (band restitution ≈ .32 kills most of her speed) and keeps that backwards
  // drift for the whole 30-unit fall to the next lane — 10 to 20 units of it,
  // measured — which is exactly what the half-step stagger is for: with the
  // wall PAST a lane's last popper, that drift lands her on one of the
  // interlocked columns below instead of in a gap. Which column varies with how
  // far past the popper the wall sits — measured, lane 1 hands off half a step
  // BACK (74 → 62) while lanes 2 and 3 hand off half a step ON (38 → 26,
  // 74 → 86) — so sweep the position rather than computing it. Park a wall BEFORE a lane's last popper and the same drift drops her
  // through a gap and out of the level, short of that lane's can — which is
  // what makes this a maze rather than four free choices. The cans mark the
  // first drop shaft and the two lane exits, so the route has to be ridden in
  // order, and lane 4 delivers her to the plant on its own once she is in it.
  //
  // The four jobs, each with its own death (drop-one, measured):
  //   1. SLIDE her in, top-left — the one band that is not a wall. Bare she
  //      falls clean between lane 1's poppers AND lane 2's, lane 3 grabs her
  //      and shoots her off the right edge with one can (flew, 1/3). Drop this
  //      band from the solution and she never enters the lattice at all: she
  //      clips the lane-2 wall on the way past and falls out of the world
  //      (fall, 0/3).
  //   2. WALL lane 1's right end — drop it and lane 1 fires her off the right
  //      edge (flew, 0/3). Its shaft is the one with the hanging can.
  //   3. WALL lane 2's left end — drop it and lane 2 fires her out of the left
  //      edge holding two cans (left, 2/3).
  //   4. WALL lane 3's right end — the cruellest miss: drop it and she has
  //      collected everything and flies past the plant off the right edge
  //      (flew, 3/3).
  //
  // GATE: PASS (`node verify.mjs 4`) — bare fails, 4 legal bands win at ~3.7s,
  // every band load-bearing (fall/flew/left/flew), finger slop 30/30, no 1-band
  // win (exhaustive), none at 2 or 3 (30000/20000 sampled), none from the beam
  // search. Jitter measured ~95% on three unrelated seeds too, not just the
  // gate's — the walls are long (40-54) on purpose: ±3u on the ends of a
  // 26-unit wall tilts it 13°, which turns a rebound by 26° and throws the
  // landing off the popper below; the same slop on a 50-unit wall barely
  // moves it. Ride: 3.7s at 99% airborne, every one of the twelve poppers fired.
  { name: "5 · Cat's Cradle", budget: 4,
    start: [0, 0],
    terrain: [], // deliberate: the players' bands are the only surfaces here
    goal: [18, 112],
    // shaft can (hangs between lanes 1 and 2) / lane 2's left exit / lane 3's
    // right exit, out past the last popper — none of them on the bare fall
    cans: [[69, 35], [28, 50], [92, 83]],
    pops: [ ...lane(20, LANE_ODD, +1), ...lane(50, LANE_EVEN, -1),
            ...lane(80, LANE_ODD, +1), ...lane(110, LANE_EVEN, -1) ],
    solution: [ [[-6, 4], [22, 20]], [[83, -6], [83, 48]],
                [[15, 40], [15, 80]], [[98, 66], [98, 116]] ] },

  // SPACE CADET: a pinball cabinet, rebuilt to the reference table's bumper
  // layout (one lone bumper high in the dome + a tight nest of three, from the
  // design sketch) with pinball furniture mapped onto our toys: bouncy floors
  // are the flippers and slingshots, party poppers are the plunger kickers and
  // the outlane kickback. Three kickers walk her up the shooter lane, the dome
  // slings her across the playfield, the raised lane divider is the one-way
  // gate (playfield balls can't fall back in), and everything drains into the
  // basin between the flippers where the spider plant sits, gated by FIVE cans:
  //   loop  (40,38)  — under the dome, on the band-A shelf ride
  //   bank  (25,45)  — upper-left, swept only by band A's exit arc
  //   mid   (52,86)  — on the band-B ride line across midfield
  //   pocket(20,84)  — roofed by the awning; only a kickback lob bent by
  //                    band C and popped off the left slingshot gets up there
  //   save  (32,182) — under the left flipper; band D roofs the drain gap and
  //                    rolls her through it onto the basin's left arm
  // The intended ride is one 12-second tour: orbit → dome shelf (loop) → exit
  // arc (bank) → awning roll → midfield shelf (mid) → lane → kickback lob →
  // C-bend → slingshot pop (pocket) → wall ledge kicks her back right → drain
  // roof (save) → basin arm → plant. The wall ledge and the sealed awning are
  // anti-cycle geometry: poppers re-fire deterministically, so every pocket
  // exit is routed AWAY from the kickback or the table loops forever.
  //
  // GATE STATUS, eyes open (replaces the old 1-band-collapse debt): bare run
  // fails legibly, the solution is 4 legal bands, it wins at ~11.9s, every
  // band is load-bearing (drop-one fails four different ways), and minbands
  // found NO smaller win — 1 band exhaustive (0/9796), 2–3 bands sampled
  // (0/50000). What still fails is finger slop: ±3u jitter wins 0/30 — five
  // chained ballistic hand-offs each tolerate ~2-4u, and nothing re-centers
  // her between stages (the beam-search check never runs; the gate stops at
  // jitter). The fix direction (not attempted yet): funnel geometry between
  // stages — poppers erase her SPEED, but only V-basins erase her POSITION,
  // and the jitter check effectively demands both between every job.
  { name: '6 · Space Cadet', budget: 4, maxSpeed: 140,
    start: [103, 178],
    terrain: [
      // table shell: left wall, rounded top, the orbit shoulder, shooter-lane wall
      [[6, 152], [6, 66], [9, 50], [16, 36], [28, 25], [44, 18], [62, 17],
       [78, 22], [92, 31], [102, 43], [108, 58], [110, 80], [110, 184], [96, 186]],
      // shooter-lane divider — the mouth up top is where she leaves the lane;
      // its top reaches close enough to the dome shoulder that the launch still
      // exits along the shell but playfield balls can't fall back into the lane
      [[96, 50], [96, 186]],
      // outlane guides funnel toward the flipper pit; the flippers themselves
      // are the cushions below (bouncy floors, not walls)
      [[6, 152], [26, 172]],
      [[96, 152], [68, 172]],
      // drain basin under the gap between the flipper cushions — its left arm
      // reaches under the left flipper (the save excursion's floor) and turns
      // up into a corner wall that kills leftward skips dead
      [[14, 170], [18, 183], [51, 197], [66, 188]],
      // awning: runs wall-to-edge, roofing the pocket can (no fall collects
      // it) and turning left-side descents into a roll toward midfield
      [[6, 70], [32, 76]],
      // wall ledge: kicks pocket-exit falls back toward the flippers, so they
      // can't dribble down the wall into the kickback and orbit it forever
      [[6, 94], [16, 102]],
    ],
    goal: [51, 194],
    // loop (under the dome) / bank (upper-left, relay-arc only) / mid (band-B
    // ride line) / roofed pocket (up-only, under the awning) / drain save
    // (under the left flipper) — nothing on the bare tour
    cans: [[40, 38], [25, 45], [52, 86], [20, 84], [32, 182]],
    // (bumpers/cushions tuned so no free path reaches any of the five)
    // the drawing's four: a lone bumper high in the dome + a tight nest of three
    bumpers: [ { x: 28, y: 36 },
               { x: 48, y: 53 }, { x: 62, y: 49 }, { x: 54, y: 65 } ],
    // bouncy floors: two slingshots (their gaps are the splitter — centre
    // drains, edges are lanes) and two flippers flanking the drain gap
    cushions: [ { x: 22, y: 128, w: 5 }, { x: 68, y: 128, w: 10 },
                { x: 26, y: 172, w: 12 }, { x: 54, y: 172, w: 14 } ],
    pops: [ { x: 103, y: 178, deg: -90, spd: 170 },
            { x: 103, y: 130, deg: -90, spd: 170 },
            { x: 103, y: 82,  deg: -90, spd: 170 },
            { x: 8, y: 146, deg: -80, spd: 150 } ], // kickback → pocket lob
    solution: [ [[34, 46], [56, 46]], [[36, 90], [68, 90]],
                [[30, 90], [30, 96]], [[54, 168], [38, 179]] ] },

  // ── UP THE MIDDLE ───────────────────────────────────────────────────────
  // Grown over several rounds from a hand sketch, then finished by hand in the
  // editor. A narrow board on a 20×18 lattice: one wall of piñata bumpers at
  // x=55, one four-popper up-column at x=75 with the spider plant buried INSIDE
  // it at (75,48), and three cans thrown wide — far right (95,120), in the
  // column (75,84), and top (45,12).
  //
  // Every popper is load-bearing in the intended ride, and the ride is a lap
  // and a half:
  //   pop(6.5,120)↗ → pop(55,120)→ → can(95,120) far right → band A turns her
  //   back → pop(75,138) into the column → pop(75,102) → can(75,84) →
  //   pop(75,66) past the LOCKED plant → pop(75,30) out the top → band B tips
  //   her onto can(45,12) → pop(35,30)↙ throws her the full width of the board
  //   back into pop(6.5,120) → up the column a second time → pop(75,66) → the
  //   plant, now unlocked. 5.9s, three bands.
  //
  // WHY THE ↙ RETURN POPPER SITS WHERE IT DOES, because it is the one piece
  // that has been wrong twice and the reason is not obvious from the picture.
  // Its job is to catch her off the top can and throw her the length of the
  // board, so what matters is whether its aim has ROOM downrange:
  //   · at (55,30) it worked but was hard to hit — about half the bands that
  //     collected the top can fed it (1030/2186 sampled), though every one that
  //     did then landed in the bottom-left popper (1030/1030).
  //   · moving it to (35,30) alone inverted that. Easy to hit (73%) and fatal:
  //     0 of 5045 firing runs reached the bottom-left popper. A 135° launch is
  //     exactly diagonal, so from x=35 she travels left as fast as she falls
  //     and crossed the world's left edge about 41 units into a 90-unit drop.
  //     Aim sweep at that position: 105–125° lands, 130°+ exits left.
  //   · the fix was not the popper. Moving the FEED popper left, (15,120) →
  //     (6.5,120), moved the landing zone out to meet the 135° throw. Same
  //     popper, same aim, now a return again — the board got wider under it.
  // If either of those two x-coordinates moves, re-check this leg.
  //
  // The other edit that matters: the second feed popper is aimed −20°, nearly
  // flat, not −45° like the first. That is what carries her the long way out to
  // the far-right can, and it is why the bare run now gets one can on its own
  // before flying off the right edge.
  //
  // GATE STATUS, measured: bare fails (flew@2.12s), all three bands are
  // load-bearing with three different deaths (drop-one → flew / loop / left),
  // every band is in-bounds and under BAND_MAX (33.1 / 35.6 / 51.1), and finger
  // slop is 29/30 against a threshold of 18 — comfortably CLEAR, and the best
  // any board here has scored with a bumper in the loop. The one thing it
  // fails is the party rule: the true minimum is 3 bands, not 4. Two stages
  // still carry themselves — the bare feed chain hands her the far-right can
  // for free, and the up-column self-chains once she is in it — so those are
  // where geometry would have to go to force a fourth.
  //
  // The start shelf is the only terrain, and it is not decoration: a bare start
  // dot leaves with START_VX=20 and sails past the popper beneath it, and
  // `decodeLevel` rejects a level with no terrain at all, so the shelf is also
  // what lets this board travel as an editor link.
  { name: '7 · Up the Middle (testbed)', budget: 4,
    start: [3, 100],
    terrain: [ [[-1.5, 103], [3, 107]] ],  // the start shelf — the only terrain
    goal: [75, 48],
    cans: [[45, 12], [75, 84], [95, 120]],
    // Four, not five: the (55,102) bumper was deleted along the way — it is the
    // one the feed hop used to hit flat, and its absence is what opens the lane
    // from the bottom-left popper across the wall and into the column.
    bumpers: [
      { x: 55, y: 48 }, { x: 55, y: 66 }, { x: 55, y: 84 }, { x: 55, y: 138 },
    ],
    pops: [
      { x: 6.5, y: 120, deg: -45, spd: 110 }, // ↗ feed, off the start shelf
      { x: 55, y: 120, deg: -20, spd: 110 },  // → feed, second stage: nearly flat
      { x: 75, y: 138, deg: -90, spd: 130 },  // the up-column, four rungs
      { x: 75, y: 102, deg: -90, spd: 130 },
      { x: 75, y: 66, deg: -90, spd: 130 },
      { x: 75, y: 30, deg: -90, spd: 130 },
      { x: 35, y: 30, deg: 135, spd: 110 },   // ↙ the return, back down-left
    ],
    // A: catch her out of the flat feed and turn her into the column's base.
    // B: tip her off the column's apex onto the top can. C: the left-side
    // return that steers her out of the ↙ popper's throw and into the plant.
    solution: [ [[90, 108], [88, 141]], [[70, 0], [92, 28]], [[12, 65], [32, 18]] ] },
];

export const GOOMBA_LEVELS: GoombaLevelInit[] = RAW_LEVELS.map(initLevel);
