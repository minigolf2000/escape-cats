// TEAM EARS — the four sequinned cat-ear headbands, as pixels.
//
// There are four physical pairs in the room (gold, teal, pink, purple) and a
// team wears one of them, so a team's colour is a PROP before it is a token:
// a player who looks up from the phone has to find the matching headband on a
// table, and the proctor sorting phones has to match a box on screen to a head
// across the room. That is the whole reason this table exists and the reason
// the colours are the ones they are — they are matched to the props, not
// picked from a palette. Recolour the props, recolour these.
//
// The drawing is deliberately not an image asset: it renders at any size from
// one string, it has no load flash on a phone, and the ears are drawn to sit ON
// the border of whatever box they belong to (see teamEarsSvg) — which an image
// cannot do without being cut to a specific box.

export interface TeamEars {
  /** Human name of the colour — the thing you say out loud: "grab the pink ears". */
  hue: string;
  /** Sequin gradient, tip to base. */
  light: string;
  mid: string;
  dark: string;
  /** The outline, and the colour the owning box paints its border and title. */
  ink: string;
}

/**
 * Keyed by team id — the same ids as TEAMS in ./lobby, so a surface that knows
 * which team a phone is on already knows which ears to draw.
 *
 * The testing room (t0) is deliberately absent: it is not a team, it has no
 * headbands on a table, and giving it a fifth colour would put a mark on screen
 * that nobody in the room is wearing. `earsFor` returns null for it and every
 * surface simply draws no ears.
 */
export const TEAM_EARS: Record<string, TeamEars> = {
  t1: { hue: "Gold",   light: "#ffe08a", mid: "#e6b02e", dark: "#a1731a", ink: "#f0c23c" },
  t2: { hue: "Teal",   light: "#8fe6f7", mid: "#22a6c8", dark: "#0e5f7d", ink: "#3cc6e6" },
  t3: { hue: "Pink",   light: "#ffd6e8", mid: "#ff92c2", dark: "#d2578f", ink: "#ff9ec7" },
  t4: { hue: "Purple", light: "#d79bf2", mid: "#9b3fc4", dark: "#5c1c7d", ink: "#b673e0" },
};

/** The ears for a team, or null for "no team / not a team" (unsorted, t0). */
export function earsFor(team: string | null | undefined): TeamEars | null {
  return (team && TEAM_EARS[team]) || null;
}

/**
 * The ear's aspect ratio, from its viewBox. Callers need the HEIGHT to reserve
 * room above the box (the ears stick out of it), and reserving it from the same
 * number the drawing uses is what keeps the two from drifting apart.
 */
const EAR_ASPECT = 100 / 124;

/** How tall a pair of ears of this width stands above the box. */
export function earsHeight(width: number): number {
  return Math.round(width * EAR_ASPECT);
}

export interface EarsOptions {
  /** Width of ONE ear, in px. The pair scales off this. */
  width?: number;
  /** The box's border width — the ear's base overlaps it by this much so the
   * two outlines meet rather than stack. Pass what the CSS actually uses. */
  strokeWidth?: number;
  /** How far in from the box's left/right edge each ear sits. Enough to clear
   * the border radius, or the ear grows out of thin air beside the corner. */
  inset?: number;
}

/**
 * One pair of ears, as markup to drop INSIDE the box they belong to (which
 * needs `position: relative` and `earsHeight()` of room above it).
 *
 * The trick that makes the box look eared rather than decorated is in the two
 * paths, and it is worth stating because it is easy to "tidy" away:
 *
 *   - the FILL is closed BELOW the border line (the base overshoots by the
 *     border width), so the box's own border disappears underneath the ear's
 *     base instead of drawing a lid across it;
 *   - the STROKE is an OPEN path — it starts and ends at the base and is never
 *     closed — so its two ends run straight into the border line on either
 *     side. Close it and the ear becomes a sticker sitting on a complete box.
 *
 * Everything is baked into the string rather than inherited through CSS vars,
 * because this same markup goes into a React tree, a template literal and an
 * innerHTML assignment, and a var that resolves in one of those and not the
 * others is the sort of bug nobody sees until the projector is on.
 */
export function teamEarsSvg(
  team: string | null | undefined,
  opts: EarsOptions = {},
): string {
  const ears = earsFor(team);
  if (!ears) return "";
  const width = opts.width ?? 96;
  const sw = opts.strokeWidth ?? 3;
  const inset = opts.inset ?? 10;
  const height = earsHeight(width);
  return `${ear(team as string, ears, "l", width, height, sw, inset)}${ear(
    team as string,
    ears,
    "r",
    width,
    height,
    sw,
    inset,
  )}`;
}

/** The outer edge, up to the tip, down the inner edge — leaning outward, so a
 * wide box still reads as a head rather than a box with two antennae. */
const EAR_PATH = "M6 92 C 1 58 5 26 23 3 C 52 27 86 60 118 92";

function ear(
  team: string,
  e: TeamEars,
  side: "l" | "r",
  width: number,
  height: number,
  sw: number,
  inset: number,
): string {
  // Gradient/pattern ids are per team+side+width. Two boxes on one page with
  // the same team at the same size DO collide — and that is harmless, because
  // colliding ids here always name identical defs. Anything that makes them
  // differ (per-instance tint, say) has to make this id unique first.
  const uid = `ear-${team}-${side}-${width}`;
  // The right ear is the left one mirrored about the viewBox — one path, and no
  // chance of the pair drifting into two slightly different ears.
  const flip = side === "r" ? ` transform="scale(-1,1) translate(-124,0)"` : "";
  const edge = side === "l" ? `left:${inset}px` : `right:${inset}px`;
  return `<svg width="${width}" height="${height}" viewBox="0 0 124 100" aria-hidden="true"
 style="position:absolute;top:${-(height - sw)}px;${edge};pointer-events:none">
<defs>
<linearGradient id="g-${uid}" x1="0" y1="0" x2=".35" y2="1">
<stop offset="0" stop-color="${e.light}"/><stop offset=".5" stop-color="${e.mid}"/>
<stop offset="1" stop-color="${e.dark}"/></linearGradient>
<pattern id="s-${uid}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">
<circle cx="4.5" cy="4.5" r="3.4" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1"/>
<circle cx="3.4" cy="3.2" r="1.1" fill="rgba(255,255,255,.5)"/>
<circle cx="6" cy="6.4" r="1" fill="rgba(0,0,0,.18)"/></pattern>
</defs>
<g${flip}>
<path d="${EAR_PATH} L118 100 L6 100 Z" fill="url(#g-${uid})"/>
<path d="${EAR_PATH} Z" fill="url(#s-${uid})"/>
<path d="M24 84 C 20 58 24 34 34 17 C 56 38 82 62 104 84 C 74 78 48 78 24 84 Z" fill="rgba(255,255,255,.10)"/>
<path d="${EAR_PATH}" fill="none" stroke="${e.ink}" stroke-width="${((sw * 124) / width).toFixed(2)}" stroke-linecap="butt" stroke-linejoin="round"/>
</g></svg>`;
}
