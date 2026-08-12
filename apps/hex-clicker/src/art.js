// The game's shared mouse art: one silhouette, one palette, every renderer
// (click-pops, the golden mouse, the night wall) builds from these.

import { MOUSE_BOX, MOUSE_EYE, SIL_HI, BODY_HI, SIL_LO, BODY_LO } from "./mouse-geom.js";
export { MOUSE_BOX, MOUSE_EYE, SIL_LO, BODY_LO };

// ONE mouse design, shared by the click-pop particle and the night wall (see
// drawWallMouse) — two renderers, one shape, one color table. The shape is now
// the hand-drawn mouse from the Hexxxygon art file, traced to polygons in
// mouse-geom.js rather than re-authored as beziers: the artist's line wobbles,
// and a clean bezier redraw loses exactly the thing that makes it read as drawn
// rather than generated.
//
// The COLORS are unchanged. The art file ships its mice in five hues of its own
// (a lime, an orange, a pink, a blue, a purple), but those are baked into the
// PNG and this table has jobs the PNG can't know about: the wall's usage is
// fixed-per-role (yellow always spells the word; each scenery element hardcodes
// one of the other four — see MOON_SCENE), yellow == --gold (also the golden
// mouse's color), and green sits close to --neon (the core UI teal). Tracing the
// silhouette but keeping these hex values is what lets the new drawing drop in
// without re-tuning the wall, the golden mouse, or the theme.
export const MOUSE_COLORS = { yellow: '#ffd44d', blue: '#5fb0ff', pink: '#ff6fa5', green: '#5fe0a0', purple: '#b48cff' };
export const MOUSE_COLOR_LIST = Object.values(MOUSE_COLORS);

// The keyline is the one thing that IS phase-dependent, because the art file
// draws every icon twice — once with a dark line for the white daytime page,
// once with a white line for the near-black night one. Same geometry both
// times, so it's a color swap here rather than a second trace.
// Night's value is the sticker-white the game already used everywhere; day's is
// the art file's own "Text/outline" swatch.
export const MOUSE_KEYLINE_DAY = '#312B2A';
export const MOUSE_KEYLINE_NIGHT = '#F4F4F2';
// Kept under the old name because the night wall is night-only and every one of
// its call sites means "the wall's keyline" rather than "the current phase's".
export const MOUSE_KEYLINE = MOUSE_KEYLINE_NIGHT;

// Rings -> an SVG path `d`. Even-odd is what makes the inner rings cut holes
// (the gap the body shows through, the loop of the tail's curl) instead of
// painting over them, so every consumer of these strings must set
// fill-rule="evenodd" — mouseParts does, and the canvas renderer gets the same
// behaviour for free from its own default nonzero winding only because the
// traced rings already wind in opposite directions.
const toPath = rings => rings.map(r => {
  let d = `M${r[0]} ${r[1]}`;
  for (let i = 2; i < r.length; i += 2) d += `L${r[i]} ${r[i + 1]}`;
  return d + "Z";
}).join("");

export const MOUSE_SIL_D = toPath(SIL_HI);
export const MOUSE_BODY_D = toPath(BODY_HI);

// The mouse as SVG markup. `fill` is any paint — a flat hex for the click-pops,
// a gradient url() for the golden one. `line` is the keyline color, defaulting
// to night's white so existing night-only callers read unchanged.
//
// Draw order is silhouette -> body -> eye, and it is load-bearing: the keyline
// is not a stroke, it's the silhouette showing around a slightly smaller body,
// which is how the artist drew it (a chunky, uneven line that thickens at the
// nose and thins along the back). Stroking the body path instead would give a
// mathematically even outline and lose that.
export const mouseParts = (fill, line = MOUSE_KEYLINE_NIGHT) =>
  `<path d="${MOUSE_SIL_D}" fill="${line}" fill-rule="evenodd"/>
   <path d="${MOUSE_BODY_D}" fill="${fill}" fill-rule="evenodd"/>
   <circle cx="${MOUSE_EYE.cx}" cy="${MOUSE_EYE.cy}" r="${MOUSE_EYE.r}" fill="${line}"/>`;

// Currency icon — the mouse-shaped coin next to every price. Checked Cookie
// Clicker's own live DOM for how they handle this: .price::before is a fixed
// 16x16 cookie sprite with NO ".disabled" variant anywhere in their CSS —
// only the price NUMBER'S color flips green/red on affordability, the icon
// never does. Same rule here: one constant color (--neon, the UI's existing
// teal accent — unclaimed by both day's green/red cost colors and night's
// gold/brown ones, so it can't be misread as an afford/can't-afford cue), and
// it's a literal `fill`, not `currentColor`, so .cost's color toggle can
// never touch it even by accident.
//
// Cropped to the head (ear/eye/snout), not the full body — tested both at real
// size (~15-18px CSS): the whole silhouette is mostly tail at that scale, and
// the curl closes into a blob. The head crop keeps the two marks that read
// smallest — the ear's disc and the eye dot — the way CC's cookie stays legible
// tiny because of its chip flecks.
//
// The keyline follows the theme here rather than being pinned to night's white,
// because unlike the wall this icon is on screen in both phases, sitting on the
// shop's own panel.
export const currencyIconSVG = () =>
  `<svg class="coin" viewBox="23 1 31 27" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${mouseParts("var(--neon)", "var(--mouse-line)")}</svg>`;

// Per-click particle: a mouse pops out of the tap, arcs under gravity, spins,
// fades — Cookie Clicker's flying-cookie feedback, retoyed.
export const mouseSVG = (c, line) =>
  `<svg viewBox="0 0 ${MOUSE_BOX.w} ${MOUSE_BOX.h}" xmlns="http://www.w3.org/2000/svg">${mouseParts(c, line)}</svg>`;

// Originally sized to match the wall mice's rendered footprint — the wall mouse
// measured ~15.2x7.2 CSS px against this particle's ~31x14.4 native tight-bbox,
// hence 0.5. That match no longer holds: WALL_MOUSE_R halved the wall mice to
// ~7.6px and this stayed put, so a night pop is now about twice a wall mouse.
// Deliberate. The pop is tap feedback in the foreground, spawned at the finger
// and gone in under a second, so it answers to legibility at arm's length
// rather than to the wall's camera distance; matching the wall would leave a
// ~7px smear that reads as nothing at all. Drop this to 0.25 if the two are
// ever meant to line up again.
export const NIGHT_POP_SCALE = 0.5;
