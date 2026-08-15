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
export const PLANT_R = 7.5; // snake-plant pickup radius
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
  plants?: Pt[];
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
  plants: Pt[];
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
  L.plants = L.plants || [];
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
  for (const m of L.plants) eat(m[0], m[1]);
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
  // THE TUTORIAL. Four bands, four DIFFERENT jobs, in the order a player meets
  // them — so the first level teaches the whole vocabulary instead of one trick
  // four times. Each stage is a hard gate with its own legible death, and the
  // deaths are all different, which is what makes the level teach:
  //   1. a SHORT bridge over a small gap   — bare: she drops in, bowl, stuck
  //   2. a WALL in mid-air                 — bare: she sails off the right edge
  //   3. a LONG bridge, near full stretch  — bare: she drops in, bowl, stuck
  //   4. a LID over the wrong hole         — bare: she falls in the empty one
  //
  // No jump can ever substitute for a bridge here: every far lip sits 1 unit
  // ABOVE its near lip, and arcs only fall, so both gaps are honestly
  // uncrossable at any speed. That is also why the two gaps can differ in size
  // without differing in difficulty — the lesson is band LENGTH, not timing.
  //
  // A plant sits past each gate (ramp flat, far ledge, between the two holes),
  // so the cake stays locked unless all four jobs were actually done — and the
  // three ugly-looking bits of geometry are all there to keep those plants
  // honest, each one added after the beam search cheated past them:
  //   · the BOWLS floor the level's two dead columns. Empty vertical space is
  //     where shortcuts live: one catch band under a gap otherwise turns the
  //     whole fall into a free ride to somewhere much later.
  //   · the upper bowl's right arm CLIMBS to meet the ramp's lip, sealing the
  //     pocket under the ramp — a band caught her in the small gap and flew her
  //     underneath the ramp and straight out onto stage 3, skipping the wall.
  //   · the far ledge is a closed SLAB, not a line. A plant on a one-segment
  //     ledge is grabbable from directly beneath it (pickup radius 9.7 against
  //     zero thickness), so a catch band slung under the big gap collected it
  //     without ever crossing. Twelve units of belly puts it out of reach.
  { name: '1 · Four Ways to Help', budget: 4,
    start: [-12, 9],
    terrain: [
      // stage 1 — the small gap. Far lip sits 1 unit HIGH, so no jump crosses.
      [[-14, 10], [30, 17]],
      [[-20, 60], [20, 72], [60, 58], [92, 46]], // miss the small gap and this holds her
      // stage 2 — the ramp that throws her off the right edge of the world
      [[54, 16], [76, 34], [92, 34]],
      // stage 3 — the catch floor, then the big gap
      [[55, 116], [115, 96]],
      [[-15, 118], [5, 115], [5, 128], [-15, 131], [-15, 118]],
      [[0, 138], [24, 146], [48, 138]], // miss the big gap and this holds her
      [[-24, 110], [-24, 148]],  // left wall: kills her speed, drops her to 4
      // stage 4 — two holes, one cake
      [[-22, 150], [26, 162]],
      [[42, 161], [58, 166]],
      [[42, 161], [42, 190]],     // back wall of the wrong pocket
      [[74, 165], [90, 170]],
      [[74, 165], [74, 190]],     // back wall of the cake pocket
      [[20, 192], [31, 198], [42, 192]],
      [[58, 192], [66, 198], [74, 192]] ],
    goal: [66, 196],
    plants: [[86, 30], [-6, 114], [50, 165]],
    solution: [ [[30, 17], [54, 16]], [[105, 20], [105, 60]],
                [[55, 116], [5, 115]], [[26, 162], [42, 161]] ] },

  // The first level built for the locked party rule: four
  // switchback floors, one band-sized hole in each, so 4 gaps = 4 bridges =
  // 4 players. The walls between floors are the state-erasers (she hits one,
  // loses all speed, drops to the next floor), which makes each floor's gap an
  // independent stage no single band can shortcut across. A snake plant hangs
  // just under each bridge line: riding the sagging band scoops it, while any
  // ballistic hop over the gap sails above it — so every gap must actually be
  // BRIDGED, not jumped, and the cake stays locked until all four were.
  // Bare, she tours all four floors and falls out the bottom: the level
  // demonstrates itself.
  { name: '2 · Mind the Gap', budget: 4,
    start: [-2, 14],
    terrain: [
      // Each floor is a steep run (so she restarts snappily from a wall-drop's
      // dead stop — shallower than ~0.12 and the idle pump can strand her
      // creeping uphill) into a short SLIGHTLY-UPHILL shelf before the lip: a
      // speed governor that keeps lip speed under ~40, below which a hop's arc
      // can neither clear a 42-unit gap nor dip low enough to graze the plant.
      // floor A, rightward
      [[-6, 15], [24, 20], [40, 17.5]],
      [[82, 21.5], [96, 24.5]],
      [[103, 9], [103, 37]],     // right wall: kills her speed, drops her to B
      // floor B, leftward
      [[104, 58], [70, 68], [56, 65.5]],
      [[14, 69.5], [0, 72.5]],
      [[-7, 56], [-7, 85]],      // left wall, drops her to C
      // floor C, rightward
      [[-8, 101], [26, 111], [40, 108.5]],
      [[82, 112.5], [96, 115.5]],
      [[103, 99], [103, 128]],   // right wall, drops her to D
      // floor D, leftward — the cake sits on its far ledge
      [[104, 147], [70, 157], [56, 154.5]],
      [[14, 158.5], [0, 161.5]] ],
    goal: [6, 157.5],
    // The plants sit ON the far shelves, not in the gaps. A plant hanging in a
    // gap can be grazed by anything flying through it (a diagonal launcher
    // band, a fall threading the gap column — both found by the beam search).
    // A shelf can't be reached any way but ACROSS its gap: every shelf column
    // has solid floor directly above, and the corridor below is 40+ units
    // down — beyond the ~34 units of rise even a speed-capped launch can buy.
    // So plant A gates "crossed gap A", B and C likewise, and the cake on the
    // last shelf gates gap D: four crossings, and no crossing without a band
    // on that floor.
    plants: [[89, 22], [7, 70], [89, 113]],
    solution: [ [[40, 17.5], [82, 21.5]], [[56, 65.5], [14, 69.5]],
                [[40, 108.5], [82, 112.5]], [[56, 154.5], [14, 158.5]] ] },

  { name: '3 · Snake Plant Slalom', budget: 3,
    start: [10, 22],
    terrain: [ [[-4, 20], [30, 30]],
               [[6, 34], [6, 204], [104, 210], [104, 34]] ],
    goal: [96, 205],
    plants: [[32, 72], [76, 118], [32, 164]],
    solution: [ [[29.4, 6.8], [40.4, 47.6]], [[28.2, 85.3], [40.8, 88.6]],
                [[87, 132.3], [45.9, 160.8]] ] },

  // "THE SKIM": build speed in a chute, popper fires her nearly flat through a
  // long low slot, and the bands are lifts that keep her skimming.
  { name: '4 · The Skim', budget: 3, maxSpeed: 135,
    start: [8, 12],
    terrain: [ [[-6, 10], [26, 22]],
               [[26, 22], [10, 56], [14, 96], [32, 112], [44, 118]],
               [[46, 102], [148, 108]],
               [[150, 126], [162, 176], [150, 186], [128, 180]] ],
    goal: [148, 179],
    cushions: [ { x: 46, y: 138, w: 100 } ],
    plants: [[74, 134], [116, 112]],
    pops: [ { x: 48, y: 122, deg: -6, spd: 112 } ],
    solution: [ [[123.5, 98.3], [99.1, 130.1]] ] },

  // A sealed pinball box: piñatas, pillow floors, plants gating the cake, and
  // the only exit is the drain hole. Bands are deflector plates.
  { name: '5 · The Puzzle Box', budget: 4, maxSpeed: 140,
    start: [8, 12],
    terrain: [ [[-6, 10], [32, 20]],
               [[46, 28], [104, 32]],
               [[8, 42], [8, 182], [40, 188]],
               [[64, 188], [104, 182], [104, 32]],
               [[36, 196], [52, 210], [68, 198]] ],
    goal: [52, 206],
    plants: [[28, 70], [78, 104], [16, 164]],
    bumpers: [ { x: 56, y: 62 }, { x: 84, y: 78 }, { x: 22, y: 106 },
               { x: 62, y: 128 }, { x: 88, y: 152 } ],
    cushions: [ { x: 10, y: 180, w: 28 }, { x: 66, y: 180, w: 36 } ],
    solution: [ [[59.8, 75.3], [14, 71.3]], [[38.1, 93.3], [4.9, 112.8]] ] },

  { name: '6 · Piñata Alley', budget: 3,
    start: [8, 14],
    terrain: [ [[-6, 12], [38, 24]],
               [[4, 30], [4, 190], [106, 196], [106, 30]] ],
    goal: [96, 191],
    plants: [[24, 92], [86, 150]],
    // curtains, not obstacles: the gaps are narrower than she is, so she MUST bounce
    bumpers: [ { x: 16, y: 62 }, { x: 34, y: 62 }, { x: 52, y: 62 },
               { x: 70, y: 62 }, { x: 88, y: 62 },
               { x: 25, y: 122 }, { x: 43, y: 122 }, { x: 61, y: 122 },
               { x: 79, y: 122 }, { x: 97, y: 122 } ],
    solution: [ [[97.5, 121.4], [114.6, 94.6]], [[20.8, 59.6], [22.7, 93.4]] ] },

  { name: '7 · Pillow Fort',
    start: [8, 10],
    terrain: [ [[-5, 8], [46, 20]],
               [[96, 40], [96, 190]],
               [[52, 44], [52, 120]],
               [[0, 144], [24, 168], [48, 160]] ],
    goal: [24, 165],
    cushions: [ { x: 56, y: 190, w: 40 } ],
    solution: [ [[58, 126], [95, 102]] ] },

  { name: '8 · Pop Goes Goomba',
    start: [8, 54],
    terrain: [ [[-5, 52], [46, 62]],
               [[40, -14], [66, -8]] ],
    goal: [48, -13],
    cushions: [ { x: 36, y: 150, w: 36 } ],
    pops: [ { x: 98, y: 126, deg: -96, spd: 142 },
            { x: 94, y: 80, deg: -97, spd: 142 },
            { x: 85, y: 34, deg: -102, spd: 142 } ],
    solution: [ [[54, 80], [92, 118]] ] },

  // SPACE CADET: a pinball cabinet. She starts loaded in the shooter lane up the
  // right edge; three kickers walk her up it and the dome slings her into the
  // playfield, where she rattles off the piñatas and drains — a whole show that
  // collects only the free chime in the right lane. The left wall answers the
  // plunger with two channels: wall-hugging descents thread the slot under the
  // awning into a RELAY popper that walks her back up, where the dome turns the
  // launch into a re-orbit, so the table LOOPS and the plants can be taken in
  // different orders. Outlane drops instead hit the KICKBACK, whose tilted fire
  // escapes the relay's grab and threads the roofed pocket — no fall can reach
  // that plant, the awning blocks it.
  //
  // KNOWN DEBT, eyes open: this one collapses to 1 band, so it fails the party
  // rule exactly like levels 3–8, and it replaced Pachinko Drop (which passed).
  // Shipped anyway as a deliberate step toward levels that are ROUTING choices
  // rather than precision shots: two distinct winning rides with opposite plant
  // orders (lane→pocket→bank at 67% tolerance to ±5u slop, bank-first at 33%),
  // where a band picks which way the machine goes instead of threading a window.
  // Reconciling that with "requires 4" — several routes that each need 4 bands —
  // is the open problem. A first requires-4 restaging of this table (shooter →
  // dome → four wall-drop rows, each with a 20-unit gap) was abandoned to the
  // sag rule already in DESIGNING.md: the rows delivered her to each lip under
  // the ~24 lip-speed threshold, so she settled into the bridge's sag valley
  // and rocked there instead of crossing. Give every row an uphill shelf first.
  { name: '9 · Space Cadet', budget: 4, maxSpeed: 140,
    start: [103, 178],
    terrain: [
      // table shell: left wall, rounded top, the orbit shoulder, shooter-lane wall
      [[6, 152], [6, 66], [9, 50], [16, 36], [28, 25], [44, 18], [62, 17],
       [78, 22], [92, 31], [102, 43], [108, 58], [110, 80], [110, 184], [96, 186]],
      // shooter-lane divider — the mouth up top is where she leaves the lane
      [[96, 62], [96, 186]],
      // flippers funnelling into the drain: everything ends up in the hole
      [[6, 152], [40, 178], [51, 188], [62, 178], [96, 152]],
      // awning: roofs the pocket plant so no fall can collect it, and stops short
      // of the wall so wall-hugging descents thread the slot down to the relay
      [[11, 72], [32, 76]],
    ],
    goal: [51, 185],
    // target bank / right inner lane (the bare ride takes this one — the free
    // chime that says "the machine works, now steer it") / roofed pocket (up-only)
    plants: [[34, 55], [92, 115], [22, 88]],
    bumpers: [ { x: 40, y: 60 }, { x: 60, y: 52 }, { x: 50, y: 78 } ],
    // slingshots: their gaps are the splitter — centre drains, edges are lanes
    cushions: [ { x: 14, y: 128, w: 24 }, { x: 64, y: 128, w: 24 } ],
    pops: [ { x: 103, y: 178, deg: -90, spd: 170 },
            { x: 103, y: 130, deg: -90, spd: 170 },
            { x: 103, y: 82,  deg: -90, spd: 170 },
            { x: 8, y: 146, deg: -80, spd: 150 },   // kickback → pocket
            { x: 8, y: 90,  deg: -90, spd: 150 } ], // relay → re-orbit
    solution: [ [[104, 51], [108, 101]], [[70, 147], [94, 121]] ] },

  // The 2D line maze finale: four lanes of forced poppers aimed in alternation.
  // Bands can't help her travel — the only verb is to WALL a lane so she
  // rebounds and drops into the lane below. The first level whose true minimum
  // is 4 bands, so a 4-player team all genuinely participate.
  { name: '10 · The Popper Grid', budget: 4,
    start: [-6, 8],
    terrain: [ [[-8, 7], [12, 18]],
               [[21, 6], [21, 34]],
               [[28, 174], [48, 192], [68, 174]] ],
    goal: [48, 190],
    plants: [[53, 63], [28, 97], [68, 131]],
    pops: [ ...popLane(46, +1), ...popLane(80, -1),
            ...popLane(114, +1), ...popLane(148, -1) ],
    solution: [ [[70, 34], [70, 60]], [[10, 68], [10, 94]],
                [[86, 102], [86, 128]], [[26, 136], [26, 162]] ] },
];

export const GOOMBA_LEVELS: GoombaLevelInit[] = RAW_LEVELS.map(initLevel);
