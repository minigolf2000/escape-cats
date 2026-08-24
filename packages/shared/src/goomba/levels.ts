// Goomba Glider level data + physics constants — the ONLY copy.
//
// The single-file prototype these grew from is deleted; levels are designed by
// editing THIS file and running the tools in tools/goomba/ (start with its
// DESIGNING.md — the loop, the locked 4-band rule, and the anti-shortcut
// vocabulary live there).
//
// The client animates a run with this sim while the server has already scored
// it with the same sim, so a constant changed in only one place would show as
// a cat teleporting at the finish line — there is deliberately no other place.

export const G = 140; // gravity, units/s^2
export const R = 2.2; // Goomba's collision radius
export const START_VX = 20; // the little push when PLAY is hit
/** Her speed ceiling, and it BINDS — she rides pinned to it for part of the
 * run on most levels, so it is a tuning parameter, not a safety limit.
 *
 * ONE value for the whole game. A level used to be able to override it and
 * exactly one ever did (The Long Way Up, at 145), which bought a per-level
 * field in the type, a flag bit and an i16 in every share link, and a `@145`
 * suffix in the Figma frame-name contract — all to carry a single number that
 * is really a property of how the game feels. The override is gone and 145 is
 * the constant, so the level that wanted it keeps its exact ride.
 *
 * It cost Slalom, which was built against the old 120 and does not survive the
 * faster cap; it was retired rather than shipped dead. If you change this
 * number, every level is retuned by it — re-run the gate on all of them. */
export const MAX_SPEED = 145;
export const BAND_MAX = 58; // one silly band's worth of stretch
export const BAND_MIN = 6;
/** The team's band budget: four silly bands per level, for the whole room.
 * Every level ships with these four slots and no more — but WHO lays them is
 * nobody's business, so any player may lay any of the four and take any of them
 * back (`canPlaceBand` in sim.ts). The per-player quota that used to divide
 * these four between the players in the room is gone. */
export const MAX_BANDS = 4;
export const SUB = 1 / 240; // physics substep
export const RUN_MAX = 15; // seconds before we call a run stuck
export const KIND_GROUND = 0,
  KIND_BAND = 1,
  KIND_CUSH = 2;
export const E_KIND = [0.02, 0.32, 1.3]; // restitution: ground, band, cushion
/**
 * Walls get a little of their own back, floors do not.
 *
 * `E_KIND[KIND_GROUND]` is one number for every piece of terrain, but a floor
 * and a wall want opposite things from it. A floor has to be near-dead or she
 * bounces down a run-out instead of settling and sliding to the plant (level
 * 3's whole last stage is that slide). A wall at 0.02 stops her like wet
 * cement, which reads as a bug rather than a rule — you expect a rubbery cat
 * to come off it with *something*.
 *
 * So restitution against terrain is chosen by the CONTACT NORMAL rather than
 * by a second terrain kind: `|nx|` is 1 for a vertical wall and 0 for a level
 * floor, and `wallness()` below ramps between the two. Nothing shallower than
 * 45° changes at all, which is what keeps floors and ridden slopes exactly as
 * they were — The Long Way Up's slope and every run-out floor still behave
 * identically.
 */
export const E_WALL = 0.15;
/** cos of the steepest surface still treated as pure floor (45°). */
export const WALL_N0 = 0.7071;
/** Terrain restitution for a contact whose unit normal has x-component nx. */
export function groundE(nx: number): number {
  const w = (Math.abs(nx) - WALL_N0) / (1 - WALL_N0);
  return E_KIND[0] + (E_WALL - E_KIND[0]) * (w < 0 ? 0 : w > 1 ? 1 : w);
}
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

/**
 * How a level is NAMED to players: where it sits in the pack, then its own
 * name. `index` is the pack index, so the first level reads "1 · ...".
 *
 * The number is computed HERE, at display time, and is stored nowhere. It used
 * to be typed into the `name` string of every level, which made the position
 * and the name one editable thing and meant that inserting, deleting or
 * reordering a single level was a rename of every level after it — done by
 * hand, in a file, for a number the array already knew. Now the pack's order
 * IS the numbering: drag a card and the grid renumbers itself for free.
 *
 * So a level's `name` is just its name. Don't type a number into one.
 */
export const levelLabel = (index: number, name: string): string =>
  `${index + 1} · ${name}`;

export interface GoombaLevel {
  /** Just the name — no number. See `levelLabel`, which adds the position. */
  name: string;
  /** Historical per-level allowance. The shipped game ignores it — the party
   * rule locks every level to MAX_BANDS slots — but the design bench still
   * reads it, so it rides along in the mirror. */
  budget?: number;
  start: Pt;
  goal: Pt;
  terrain: Pt[][];
  /** Watering cans: all of them must be collected before the goal unlocks. */
  cans?: Pt[];
  cushions?: GoombaCushion[];
  pops?: GoombaPopper[];
  bumpers?: GoombaBumper[];
  /**
   * The box the level was DRAWN in — the Figma frame, in level units.
   *
   * Padding around the geometry is a design decision, not slack: a wall with
   * forty units of empty world to its right is a wall players can lay a band
   * out past, and cropping to the ink takes that away. `bounds` is derived from
   * the ink, so without this the frame's own size was dropped on the way in and
   * the level re-cropped itself the moment it loaded.
   *
   * `initLevel` UNIONS it with the derived box, never replaces it: a frame
   * drawn tighter than its own contents can only ever have been an accident,
   * and honouring it would push terrain outside the world.
   */
  frame?: { x0: number; y0: number; x1: number; y1: number };
  /** Derived by initLevel — the ink, its margins, and `frame` if there is one. */
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
  // The authored frame, unioned in. Its edges take no margin of their own: the
  // margins above exist to give ink breathing room when nobody said how much,
  // and a frame is somebody saying. Union rather than replace, so this is
  // idempotent — running initLevel twice cannot shrink a world.
  const f = L.frame;
  if (f) {
    L.bounds.x0 = Math.min(L.bounds.x0, f.x0);
    L.bounds.y0 = Math.min(L.bounds.y0, f.y0);
    L.bounds.x1 = Math.max(L.bounds.x1, f.x1);
    L.bounds.y1 = Math.max(L.bounds.y1, f.y1);
  }
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
        // Normalised to point RIGHT, because the idle cat is always drawn
        // with face = 1: a floor drawn right-to-left in Figma stores its
        // points that way, and the raw atan2 would hand a flat floor π and
        // draw her upside down on it. The running physics already does this,
        // against her actual face (`tanX * st.face < 0` in physics.ts); this
        // is the same rule for the one frame before she has a face.
        const dx = bx - ax,
          dy = by - ay;
        L.startAngle = dx < 0 ? Math.atan2(-dy, -dx) : Math.atan2(dy, dx);
        break;
      }
    }
  return L as GoombaLevelInit;
}

/**
 * **The levels the game is playing right now**, and the ONE array every rule
 * reads: `scoreRun`, the placement rules, the phases, the selector and the phone
 * animation all index this and cannot tell where a level came from.
 *
 * It starts EMPTY. The pack lives in the lobby DO and arrives over the wire, so
 * a client that has not heard from the lobby yet has no levels — which is the
 * honest state, and every caller below is guarded for it.
 *
 * It is a MUTABLE array rather than a fresh binding on every change because
 * that is already the contract here: `adoptHashLevel` pushes a pasted level
 * onto it so the shipped sim plays it for real. Replacing the binding would
 * strand every module that imported the old one.
 */
export const GOOMBA_LEVELS: GoombaLevelInit[] = [];

/**
 * Swap the whole pack in place, preparing each level exactly as a shipped one.
 *
 * In PLACE — same array object — for the reason above. Returns the new length,
 * which is the number every `completed` array has to agree with; a caller that
 * changes the pack mid-room must reconcile that (see `GoombaSim.reconcile`).
 */
export function setGoombaLevels(list: GoombaLevel[]): number {
  GOOMBA_LEVELS.length = 0;
  for (const L of list) GOOMBA_LEVELS.push(initLevel(L));
  return GOOMBA_LEVELS.length;
}
