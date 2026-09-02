// The game's shared mouse art: one silhouette, one palette, every renderer
// (click-pops, the golden mouse, the night wall) builds from these.

import { MOUSE_BOX, MOUSE_EYE, SIL_HI, BODY_HI, SIL_LO, BODY_LO } from "./mouse-geom.js";
export { MOUSE_BOX, MOUSE_EYE, SIL_LO, BODY_LO };

// ONE mouse design, shared by the click-pop and the night wall (drawWallMouse):
// the hand-drawn mouse from the art file, traced to polygons in mouse-geom.js
// rather than redrawn as beziers (the wobble is what reads as drawn). The
// COLORS are this table's, not the art file's: the wall's usage is fixed per
// role (yellow spells the word; each scenery element hardcodes one of the
// others), yellow == --gold (the golden mouse), and green sits close to --neon.
export const MOUSE_COLORS = { yellow: '#ffd44d', blue: '#5fb0ff', pink: '#ff6fa5', green: '#5fe0a0', purple: '#b48cff' };
export const MOUSE_COLOR_LIST = Object.values(MOUSE_COLORS);

// The keyline is the one phase-dependent thing: the art file draws every icon
// twice, dark line for the white day page and white line for the night one.
// Same geometry, so it is a colour swap, not a second trace.
export const MOUSE_KEYLINE_DAY = '#312B2A';
export const MOUSE_KEYLINE_NIGHT = '#F4F4F2';
// Kept under the old name because the night wall is night-only and every one of
// its call sites means "the wall's keyline" rather than "the current phase's".
export const MOUSE_KEYLINE = MOUSE_KEYLINE_NIGHT;

// Rings -> an SVG path `d`. Even-odd is what makes the inner rings cut holes
// (the gap under the chin, the loop of the tail's curl), so every consumer must
// set fill-rule="evenodd". The canvas renderer gets it from its default nonzero
// winding only because the traced rings already wind in opposite directions.
const toPath = rings => rings.map(r => {
  let d = `M${r[0]} ${r[1]}`;
  for (let i = 2; i < r.length; i += 2) d += `L${r[i]} ${r[i + 1]}`;
  return d + "Z";
}).join("");

export const MOUSE_SIL_D = toPath(SIL_HI);
export const MOUSE_BODY_D = toPath(BODY_HI);

// The mouse as SVG markup. `fill` is any paint; `line` is the keyline colour.
// Draw order silhouette -> body -> eye is load-bearing: the keyline is not a
// stroke but the silhouette showing around a slightly smaller body, which is
// how the artist's uneven line thickens at the nose and thins along the back.
export const mouseParts = (fill, line = MOUSE_KEYLINE_NIGHT) =>
  `<path d="${MOUSE_SIL_D}" fill="${line}" fill-rule="evenodd"/>
   <path d="${MOUSE_BODY_D}" fill="${fill}" fill-rule="evenodd"/>
   <circle cx="${MOUSE_EYE.cx}" cy="${MOUSE_EYE.cy}" r="${MOUSE_EYE.r}" fill="${line}"/>`;

// Currency icon — the mouse coin next to every price. ONE constant colour
// (--neon, unclaimed by both phases' cost colours, so it cannot read as an
// afford cue) and a literal `fill`, not currentColor, so .cost's red/green can
// never touch it — Cookie Clicker's own rule: only the number flips. Cropped to
// the head: at ~16px the full silhouette is mostly tail and the curl closes
// into a blob. The keyline follows the theme, since it is on screen in both phases.
export const currencyIconSVG = () =>
  `<svg class="coin" viewBox="23 1 31 27" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${mouseParts("var(--neon)", "var(--mouse-line)")}</svg>`;

// Per-click particle: a mouse pops out of the tap, arcs under gravity, spins,
// fades — Cookie Clicker's flying-cookie feedback, retoyed.
export const mouseSVG = (c, line) =>
  `<svg viewBox="0 0 ${MOUSE_BOX.w} ${MOUSE_BOX.h}" xmlns="http://www.w3.org/2000/svg">${mouseParts(c, line)}</svg>`;

// Night pops are about twice a wall mouse (WALL_MOUSE_R), deliberately: tap
// feedback at the finger answers to arm's-length legibility, not the wall's
// camera distance. 0.25 would line the two up again.
export const NIGHT_POP_SCALE = 0.5;
