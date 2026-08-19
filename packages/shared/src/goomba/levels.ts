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

// One row of the popper grid in the finale: every popper in a lane aims the
// same way, which makes the lane a one-way street she cannot leave under her
// own power.
const GRID_X = [16, 32, 48, 64, 80, 96];
const popLane = (y: number, dir: number): GoombaPopper[] =>
  GRID_X.map((x) => ({ x, y, deg: dir > 0 ? 0 : 180, spd: 76 }));

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
  // ships that way (budget 3, a 3-band solution) alongside levels 2 and 3 —
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

  // The floor is pitched 20 units over 98 (0.204), not the 6 it used to be.
  // The old 0.061 was under the ~0.12 stranding threshold, and worse, under
  // what it takes to beat the snowboard pump: the pump shoves her the way she
  // FACES, so a soft leftward landing near the left wall pumped her into the
  // corner and stalled there — 741 of 3312 sampled left-side arrivals never
  // reached the plant. At 0.204 gravity outvotes the pump and every one of
  // those 3312 slides down to the plant on the right. It cost nothing: the
  // 3-band solution still wins (1.3s faster) and the level still needs 3.
  { name: '2 · Watering Can Slalom', budget: 3,
    start: [10, 22],
    terrain: [ [[-4, 20], [30, 30]],
               [[6, 34], [6, 190], [104, 210], [104, 34]] ],
    goal: [96, 205],
    cans: [[32, 72], [76, 118], [32, 164]],
    solution: [ [[29.4, 6.8], [40.4, 47.6]], [[28.2, 85.3], [40.8, 88.6]],
                [[87, 132.3], [45.9, 160.8]] ] },

  { name: '3 · Piñata Alley', budget: 3,
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

  { name: '4 · Pop Goes Goomba',
    start: [8, 54],
    terrain: [ [[-5, 52], [46, 62]],
               [[40, -14], [66, -8]] ],
    goal: [48, -13],
    cushions: [ { x: 36, y: 150, w: 36 } ],
    pops: [ { x: 98, y: 126, deg: -96, spd: 142 },
            { x: 94, y: 80, deg: -97, spd: 142 },
            { x: 85, y: 34, deg: -102, spd: 142 } ],
    solution: [ [[54, 80], [92, 118]] ] },

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
  { name: '5 · Space Cadet', budget: 4, maxSpeed: 140,
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

  // The 2D line maze finale: four lanes of forced poppers aimed in alternation.
  // Bands can't help her travel — the only verb is to WALL a lane so she
  // rebounds and drops into the lane below. The first level whose true minimum
  // is 4 bands, so a 4-player team all genuinely participate.
  { name: '6 · The Popper Grid', budget: 4,
    start: [-6, 8],
    terrain: [ [[-8, 7], [12, 18]],
               [[21, 6], [21, 34]],
               [[28, 174], [48, 192], [68, 174]] ],
    goal: [48, 190],
    cans: [[53, 63], [28, 97], [68, 131]],
    pops: [ ...popLane(46, +1), ...popLane(80, -1),
            ...popLane(114, +1), ...popLane(148, -1) ],
    solution: [ [[70, 34], [70, 60]], [[10, 68], [10, 94]],
                [[86, 102], [86, 128]], [[26, 136], [26, 162]] ] },
];

export const GOOMBA_LEVELS: GoombaLevelInit[] = RAW_LEVELS.map(initLevel);
