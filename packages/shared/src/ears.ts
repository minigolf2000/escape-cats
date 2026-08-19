// TEAM EARS — the four cat-ear headbands, as pixels.
//
// There are four physical pairs in the room (gold, teal, pink, purple) and a
// team wears one of them, so a team's colour is a PROP before it is a UI token:
// a player who looks up from the phone has to find the matching headband on a
// table, and the proctor sorting phones has to match a box on screen to a head
// across the room. That is the whole reason this table exists and the reason
// the colours are the ones they are — they are matched to the props, not picked
// from a palette. Recolour the props, recolour these.
//
// The drawing is deliberately not an image asset: it renders at any size from
// one string, it has no load flash on a phone, and the ears are drawn to sit ON
// the border of whatever box they belong to (see teamEarsSvg) — which an image
// cannot do without being cut to one specific box.

export interface TeamEars {
  /** Human name of the colour — the thing you say out loud: "grab the pink ears". */
  hue: string;
  /** The outline, and the colour the owning box paints its border and title. */
  ink: string;
  /** The wash inside the ear. Only a hint of colour: the ear reads as part of
   * the box, and a solid fill turns it back into a sticker stuck on top. */
  tint: string;
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
  t1: { hue: "Gold", ink: "#f0c23c", tint: "#e6b02e" },
  t2: { hue: "Teal", ink: "#3cc6e6", tint: "#22a6c8" },
  t3: { hue: "Pink", ink: "#ff9ec7", tint: "#ff92c2" },
  t4: { hue: "Purple", ink: "#b673e0", tint: "#9b3fc4" },
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
  /** The box's background, used to fill the ear. Only a FALLBACK: the ear fills
   * with --ear-fill when the box sets it, which is what lets a box whose
   * background changes (the proctor's drop zones under a drag) carry its ears
   * with it. Pass the resting background and set the var for the other states. */
  panel?: string;
}

/**
 * One pair of ears, as markup to drop INSIDE the box they belong to (which
 * needs `position: relative` and `earsHeight()` of room above it).
 *
 * The trick that makes the box look eared rather than decorated is in the two
 * paths, and it is worth stating because it is easy to "tidy" away:
 *
 *   - the FILL is closed BELOW the border line (the base overshoots by the
 *     border width) and painted in the box's own background, so the box's
 *     border disappears underneath the ear's base instead of drawing a lid
 *     across it;
 *   - the STROKE is an OPEN path — it starts and ends at the base and is never
 *     closed — so its two ends run straight into the border line on either
 *     side. Close it and the ear becomes a sticker sitting on a complete box.
 *
 * Two shapes, no gradients and no ids: nothing here is per-instance, so the
 * same pair can be drawn as many times on a page as there are boxes.
 */
export function teamEarsSvg(
  team: string | null | undefined,
  opts: EarsOptions = {},
): string {
  const ears = earsFor(team);
  if (!ears) return "";
  const width = opts.width ?? 96;
  const sw = opts.strokeWidth ?? 2;
  const inset = opts.inset ?? 10;
  const panel = opts.panel ?? "#14161d";
  const height = earsHeight(width);
  return (
    ear(ears, "l", width, height, sw, inset, panel) +
    ear(ears, "r", width, height, sw, inset, panel)
  );
}

/** The outer edge, up to the tip, down the inner edge — leaning outward, so a
 * wide box still reads as a head rather than a box with two antennae. */
const EAR_PATH = "M6 92 C 1 58 5 26 23 3 C 52 27 86 60 118 92";
/** The inner ear, floating inside that outline. */
const INNER_PATH = "M26 86 C 22 60 26 36 35 18 C 58 40 84 64 106 86 Z";

function ear(
  e: TeamEars,
  side: "l" | "r",
  width: number,
  height: number,
  sw: number,
  inset: number,
  panel: string,
): string {
  // The right ear is the left one mirrored about the viewBox — one path, and no
  // chance of the pair drifting into two slightly different ears.
  const flip = side === "r" ? ` transform="scale(-1,1) translate(-124,0)"` : "";
  const edge = side === "l" ? `left:${inset}px` : `right:${inset}px`;
  return `<svg width="${width}" height="${height}" viewBox="0 0 124 100" aria-hidden="true"
 style="position:absolute;top:${-(height - sw)}px;${edge};pointer-events:none">
<g${flip}>
<path d="${EAR_PATH} L118 100 L6 100 Z" style="fill:var(--ear-fill,${panel})"/>
<path d="${INNER_PATH}" fill="${e.tint}" opacity=".16"/>
<path d="${EAR_PATH}" fill="none" stroke="${e.ink}" stroke-width="${((sw * 124) / width).toFixed(2)}" stroke-linecap="butt" stroke-linejoin="round"/>
</g></svg>`;
}
