// The game's shared mouse art: one silhouette, one palette, every renderer
// (click-pops, the golden mouse, the night wall) builds from these.

import {
  MOUSE_BOX, MOUSE_VIEWBOX, MOUSE_EYE, MOUSE_COIN_VIEWBOX,
  SIL_HI, BODY_HI, EAR_HI, NOSE_HI, TAIL_HI, SIL_LO, BODY_LO, TAIL_LO,
} from "./mouse-geom.js";
export { MOUSE_BOX, MOUSE_VIEWBOX, MOUSE_EYE, SIL_LO, BODY_LO, TAIL_LO };

// ONE mouse design, shared by the click-pop and the night wall (drawWallMouse):
// the hand-drawn mouse from the art file, traced to polygons in mouse-geom.js
// rather than redrawn as beziers (the wobble is what reads as drawn).
//
// The BODY COLOURS are this table's, not the art file's, and they did NOT move
// with the v2 drawing. The v2 sheet ships four mice; the wall needs five, and
// every one of these keys is fixed per role — yellow spells the word, and
// MOON_SCENE hardcodes the other four one per scenery element. Repainting from
// a four-colour sheet would have cost a scenery element its own hue, so the
// swap took the SHAPE and left the table alone. Two invariants ride on these
// exact values: yellow == --gold (the golden mouse), green sits close to
// --neon. Don't repaint them without reading MOON_SCENE first.
export const MOUSE_COLORS = { yellow: '#ffd44d', blue: '#5fb0ff', pink: '#ff6fa5', green: '#5fe0a0', purple: '#b48cff' };
export const MOUSE_COLOR_LIST = Object.values(MOUSE_COLORS);

// The two ACCENT marks, and unlike the body they are constants: the artist
// draws the same hot pink ear and nose, and the same near-black eye, on all
// four of her mice whatever the body under them is. So they are properties of
// the DRAWING rather than of the palette, and a recoloured body never touches
// them. The one place this reads oddly is our pink mouse, whose body sits close
// enough to the accent that the ear goes quiet — the artist's own pink mouse
// avoids that by being a much lighter pink than ours.
export const MOUSE_ACCENT = '#FF64BB';
export const MOUSE_EYE_INK = '#302B2A';

// The keyline is the one phase-dependent thing: the art file draws every icon
// twice, dark line for the white day page and white line for the night one.
// Same geometry, so it is a colour swap, not a second trace.
export const MOUSE_KEYLINE_DAY = '#312B2A';
export const MOUSE_KEYLINE_NIGHT = '#F4F4F2';
// Kept under the old name because the night wall is night-only and every one of
// its call sites means "the wall's keyline" rather than "the current phase's".
export const MOUSE_KEYLINE = MOUSE_KEYLINE_NIGHT;

// Rings -> an SVG path `d`. Even-odd is what makes any inner ring cut a hole
// instead of painting over it, so every consumer must set fill-rule="evenodd".
// The canvas renderer gets it from its default nonzero winding only because the
// traced rings already wind in opposite directions.
const toPath = rings => rings.map(r => {
  let d = `M${r[0]} ${r[1]}`;
  for (let i = 2; i < r.length; i += 2) d += `L${r[i]} ${r[i + 1]}`;
  return d + "Z";
}).join("");

export const MOUSE_SIL_D = toPath(SIL_HI);
export const MOUSE_BODY_D = toPath(BODY_HI);
export const MOUSE_EAR_D = toPath(EAR_HI);
export const MOUSE_NOSE_D = toPath(NOSE_HI);
export const MOUSE_TAIL_D = toPath(TAIL_HI);

// The mouse as SVG markup. `fill` is any paint; `line` is the keyline colour.
// Draw order silhouette -> tail -> body -> ear -> nose -> eye is load-bearing:
// the keyline is not a stroke but the silhouette showing around a slightly
// smaller body, which is how the artist's uneven line thickens at the nose and
// thins along the back. The tail goes between the two because it is keyline all
// the way through and it OVERLAPS the rump: painted under the body fill, the
// straight edge that closes its ring disappears and the curl reads as one piece
// with the animal. The three marks go on last because they sit ON the body.
//
// `tail` false drops it — for the coin, which is a square box on the BODY and
// would otherwise clip the curl at its own frame (see currencyIconSVG). Every
// caller that draws the mouse whole must pair the tail with MOUSE_VIEWBOX;
// MOUSE_BOX cuts it off.
export const mouseParts = (fill, line = MOUSE_KEYLINE_NIGHT, tail = true) =>
  `<path d="${MOUSE_SIL_D}" fill="${line}" fill-rule="evenodd"/>
   ${tail ? `<path d="${MOUSE_TAIL_D}" fill="${line}" fill-rule="evenodd"/>` : ""}
   <path d="${MOUSE_BODY_D}" fill="${fill}" fill-rule="evenodd"/>
   <path d="${MOUSE_EAR_D}" fill="${MOUSE_ACCENT}" fill-rule="evenodd"/>
   <path d="${MOUSE_NOSE_D}" fill="${MOUSE_ACCENT}" fill-rule="evenodd"/>
   <circle cx="${MOUSE_EYE.cx}" cy="${MOUSE_EYE.cy}" r="${MOUSE_EYE.r}" fill="${MOUSE_EYE_INK}"/>`;

// Currency icon — the mouse coin next to every price. ONE constant body colour
// (--neon, unclaimed by both phases' cost colours, so it cannot read as an
// afford cue) and a literal `fill`, not currentColor, so .cost's red/green can
// never touch it — Cookie Clicker's own rule: only the number flips. The
// keyline follows the theme, since it is on screen in both phases.
//
// CROPPED TO THE HEAD (MOUSE_COIN_VIEWBOX) — v1's answer, back for v1's reason.
// The mouse has a tail again, and at 16px the whole animal is the wrong picture:
// framing it costs a fifth of the body to buy about 2px of spiral, and a box
// wide enough to hold it at size hands the icon the width of every shop row.
// What survives a 16px crop is what the head carries — the ear, the eye and the
// nose, three marks in three colours — so the coin shows those and the tail is
// for the sizes that can hold it.
//
// `tail` is false here for bytes, not for looks: the curl sits well left of the
// crop and would be clipped away regardless. Sized by HEIGHT (1em) in CSS, so a
// 1.11:1 box cannot outgrow the line it sits on and shop rows stay put.
export const currencyIconSVG = () =>
  `<svg class="coin" viewBox="${MOUSE_COIN_VIEWBOX}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${mouseParts("var(--neon)", "var(--mouse-line)", false)}</svg>`;

// Per-click particle: a mouse pops out of the tap, arcs under gravity, spins,
// fades — Cookie Clicker's flying-cookie feedback, retoyed.
// MOUSE_VIEWBOX, not MOUSE_BOX: the pop draws the whole animal, tail included.
// .mousePop's width and updatePops' centring offset are set against this box's
// aspect — move one and move both, or the pop stops leaving the finger.
export const mouseSVG = (c, line) =>
  `<svg viewBox="${MOUSE_VIEWBOX}" xmlns="http://www.w3.org/2000/svg">${mouseParts(c, line)}</svg>`;

// Where the BODY's centre sits across the pop's box, 0..1. The tail pushed the
// box's left edge out past the body, so the middle of the element is no longer
// the middle of the mouse; updatePops centres on THIS instead, or a pop leaves
// the finger off to one side. Read off MOUSE_VIEWBOX so a re-placed tail carries
// it — nothing here is a typed constant.
const [vbX, , vbW] = MOUSE_VIEWBOX.split(" ").map(Number);
export const MOUSE_POP_PIVOT = (MOUSE_BOX.w / 2 - vbX) / vbW;

// Night pops are about twice a wall mouse (WALL_MOUSE_R), deliberately: tap
// feedback at the finger answers to arm's-length legibility, not the wall's
// camera distance. 0.25 would line the two up again.
export const NIGHT_POP_SCALE = 0.5;
