// The game's shared mouse art: one silhouette, one palette, every renderer
// (click-pops, the golden mouse, the night wall) builds from these.

// ONE mouse design, shared by the click-pop particle and the night wall (see
// drawWallMouse) — was two separate systems (a plush-toy SVG here, a plain
// ellipse there) with two separate palettes; unified to a single shape and a
// single color table. The wall's usage is fixed-per-role (yellow always
// spells the word; each scenery element hardcodes one of the other four —
// see MOON_SCENE), so these are canonical hex values, not a random draw;
// click-pops draw from the same table uniformly at random for cosmetic
// variety. Chosen over the previous click-only "toy bin photo" palette
// because it reuses the game's existing accents instead of adding new hues:
// yellow == --gold (also the golden-mouse bonus's color), green sits close to
// --neon (the core UI teal). The two palettes were already near-identical —
// this just resolves the small deltas (a bluer green, a warmer pink) toward
// whichever hex already has a job to do elsewhere in the game.
export const MOUSE_COLORS = { yellow: '#ffd44d', blue: '#5fb0ff', pink: '#ff6fa5', green: '#5fe0a0', purple: '#b48cff' };
export const MOUSE_COLOR_LIST = Object.values(MOUSE_COLORS);

// The canonical mouse geometry, in a 54x28 box facing right. Named here rather
// than inlined into mouseSVG because there are now THREE renderers of this same
// animal — the click-pop particle, the golden mouse (goldenMouseSVG), and the
// night wall (drawWallMouse, which re-expresses these very numbers as canvas
// path calls). Anything that draws a mouse builds from these, so a tweak to the
// silhouette lands everywhere at once instead of in two places out of three.
export const MOUSE_TAIL_D = "M12 17 C4 21 2 10 8 7";
export const MOUSE_BODY_D = "M51 16 C46 8 37 4 27 5 C16 6 10 10 10 16 C10 21 17 24 27 24 C37 24 47 21 51 16 Z";
export const MOUSE_EAR = { cx: 33, cy: 7, r: 4.6 };
export const MOUSE_EYE = { cx: 42, cy: 12, r: 1.8 };
export const MOUSE_KEYLINE = "#f4f4f2";

// The mouse as SVG markup. `fill` is any paint — a flat hex for the click-pops,
// a gradient url() for the golden one. There used to be a `k` keyline scale here
// for the saucer, which drew this shrunk inside a dome; the saucer is gone and
// every caller wanted 1.
export const mouseParts = fill =>
  `<path d="${MOUSE_TAIL_D}" fill="none" stroke="${fill}" stroke-width="2.6" stroke-linecap="round"/>
   <path d="${MOUSE_BODY_D}" fill="${fill}" stroke="${MOUSE_KEYLINE}" stroke-width="2" stroke-linejoin="round"/>
   <circle cx="${MOUSE_EAR.cx}" cy="${MOUSE_EAR.cy}" r="${MOUSE_EAR.r}" fill="${fill}" stroke="${MOUSE_KEYLINE}" stroke-width="2"/>
   <circle cx="${MOUSE_EYE.cx}" cy="${MOUSE_EYE.cy}" r="${MOUSE_EYE.r}" fill="#0a0b10"/>`;

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
// Cropped to the head (nose/ear/eye), not the full 54x28 body — tested both at
// real size (~15-18px CSS): the full silhouette's tail-to-nose taper is too
// thin a shape to survive that small and just reads as a flat pill, where
// CC's cookie stays legible that tiny because it's already roughly circular.
// The head crop is closer to square, and its ear-ring + eye dot give it two
// distinguishing marks at a glance, the way the cookie's choc-chip flecks do.
export const currencyIconSVG = () =>
  `<svg class="coin" viewBox="21 1 30 26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${mouseParts("var(--neon)")}</svg>`;

// Per-click particle: a plush mouse pops out of the tap, arcs under gravity,
// spins, fades — Cookie Clicker's flying-cookie feedback, retoyed. Body keeps
// the sticker-style white keyline so it reads as the same art family as Hex.
export const mouseSVG = c =>
  `<svg viewBox="0 0 54 28" xmlns="http://www.w3.org/2000/svg">${mouseParts(c)}</svg>`;

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
