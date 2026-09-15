// Goomba Glider level types + physics constants — the ONLY copy. The client
// animates a run with the same sim the server scored it with, so a constant
// that differed would show as the cat teleporting at the finish line.
//
// There are no levels here: a level is a Figma frame, and an event's pack lives
// in its lobby DO. See tools/goomba/DESIGNING.md.

export const G = 140; // gravity, units/s^2
export const R = 2.2; // Goomba's collision radius
export const START_VX = 20; // the little push when PLAY is hit
/** Her speed ceiling, and it BINDS on most levels — a tuning parameter, not a
 * safety limit. ONE value for the whole game; change it and every level needs
 * replaying. */
export const MAX_SPEED = 145;
export const BAND_MAX = 58; // one silly band's worth of stretch
export const BAND_MIN = 6;
/** Four bands per level for the whole ROOM, and no rule about whose: any player
 * may lay any of them and lift any of them (`canPlaceBand` in sim.ts). */
export const MAX_BANDS = 4;
export const SUB = 1 / 240; // physics substep
export const RUN_MAX = 15; // seconds before we call a run stuck
export const KIND_GROUND = 0,
  KIND_BAND = 1,
  KIND_CUSH = 2;
export const E_KIND = [0.02, 0.32, 1.3]; // restitution: ground, band, cushion
/**
 * Walls give a little back, floors stay near-dead (or she bounces down a
 * run-out instead of sliding to the plant). Chosen by the CONTACT NORMAL, not a
 * second terrain kind: `groundE` ramps from E_KIND[0] to this between 45° and
 * vertical, so nothing shallower than 45° changes.
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

import type { LevelSource } from "./library";

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
 * How a level is NAMED to players: pack index + 1, then its name. The number
 * is computed here and stored nowhere — the pack's order IS the numbering, so
 * never type a number into a `name`.
 */
export const levelLabel = (index: number, name: string): string =>
  `${index + 1} · ${name}`;

export interface GoombaLevel {
  /** Just the name — no number. See `levelLabel`, which adds the position. */
  name: string;
  start: Pt;
  goal: Pt;
  terrain: Pt[][];
  /** Watering cans: all of them must be collected before the goal unlocks. */
  cans?: Pt[];
  cushions?: GoombaCushion[];
  pops?: GoombaPopper[];
  bumpers?: GoombaBumper[];
  /**
   * The box the level was DRAWN in (the Figma frame, in level units). Padding
   * around the ink is a design decision — room to lay a band out past a wall —
   * so it must survive. `initLevel` UNIONS it with the derived box, never
   * replaces it.
   */
  frame?: { x0: number; y0: number; x1: number; y1: number };
  /** Derived by initLevel — the ink, its margins, and `frame` if there is one. */
  bounds?: { x0: number; y0: number; x1: number; y1: number };
  startAngle?: number;
  /** Stable identity, from the row this level was loaded from — what SAVED
   * PROGRESS is keyed on (`library.ts`). Absent only for the `#hash` level,
   * which is a scratch level and is deliberately never remembered. */
  id?: string;
  /** Which layer this came from: the shipped list, the power user's local
   * overlay, or the URL hash. */
  source?: LevelSource;
  /** "Not a level the game shipped" — the selector draws a dashed card. Set
   * for both editable layers; predates `source` and is kept because it is a
   * PRESENTATION flag and the card has no business asking which layer. */
  pasted?: boolean;
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

/** World bounds + popper aim vectors + start-pad angle. */
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
  // The authored frame, unioned in with no margin of its own (a frame is
  // somebody saying how much). Union, not replace: idempotent, and a frame
  // drawn tighter than its ink adds nothing.
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
        // Normalised to point RIGHT: the idle cat is drawn with face = 1, and
        // a floor drawn right-to-left would hand atan2 π and draw her upside
        // down. Same rule as `tanX * st.face < 0` in physics.ts.
        const dx = bx - ax,
          dy = by - ay;
        L.startAngle = dx < 0 ? Math.atan2(-dy, -dx) : Math.atan2(dy, dx);
        break;
      }
    }
  return L as GoombaLevelInit;
}

/**
 * The levels the game is playing right now — the ONE array every rule reads.
 * Starts EMPTY and is MUTATED in place, never rebound: every module holds this
 * binding. The client fills it once at boot by composing the three layers
 * (shipped + local overlay + `#hash`) and again on every overlay edit; see
 * `library.ts` and the client's `library.js`.
 */
export const GOOMBA_LEVELS: GoombaLevelInit[] = [];

/**
 * Swap the whole pack in place. Returns the new length, which every
 * `completed` array has to agree with (`GoombaSim.reconcile`).
 */
export function setGoombaLevels(list: GoombaLevel[]): number {
  GOOMBA_LEVELS.length = 0;
  for (const L of list) GOOMBA_LEVELS.push(initLevel(L));
  return GOOMBA_LEVELS.length;
}
