// TEAM EARS — the four cat-ear headbands, as pixels. A team's colour is a
// PROP first: these are matched to the four physical headbands (gold, teal,
// pink, purple), not picked from a palette. Recolour the props, recolour these.
// SVG rather than an image so it sits ON the box's border at any size.

export interface TeamEars {
  /** Human name of the colour — the thing you say out loud: "grab the pink ears". */
  hue: string;
  /** The outline, and the colour the owning box paints its border and title. */
  ink: string;
  /** The wash inside the ear — a hint only; a solid fill reads as a sticker. */
  tint: string;
}

/** Keyed by team id (TEAMS in ./lobby). t0 is deliberately absent: it is not
 * a team and nobody wears a fifth colour; `earsFor` returns null and no ears
 * are drawn. */
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

/** From the viewBox; callers reserve `earsHeight()` above the box from the
 * same number the drawing uses. */
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
  /** Inset from the box's left/right edge — enough to clear the border radius. */
  inset?: number;
  /** The box's background, as FALLBACK fill: `--ear-fill` wins when the box
   * sets it, so a box whose background changes (drag states) sets the var
   * per state. */
  panel?: string;
}

/**
 * One pair of ears, as markup to drop INSIDE the box (which needs
 * `position: relative` and `earsHeight()` of room above it).
 *
 * Both paths are load-bearing: the FILL closes BELOW the border line in the
 * box's own background, so the border vanishes under the ear's base; the
 * STROKE is an OPEN path, so its ends run into the border line. Close it and
 * the ear becomes a sticker on a complete box. No ids or gradients, so the
 * pair can be drawn any number of times on one page.
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

/** Outer edge up to the tip, down the inner edge — leaning outward. */
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
  // The right ear is the left one mirrored, so the pair cannot drift apart.
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
