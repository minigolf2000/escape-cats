#!/usr/bin/env node
// Builds figma-pack.svg — the kit you paste INTO Figma to design levels with.
//
// Why a script and not a hand-drawn SVG: the curve pieces are computed arcs and
// the gauges carry real numbers out of DESIGNING.md, so both want to stay
// correct when a constant moves. Run `node make-pack.mjs` and re-paste.
//
// The zero-height-rotated-line invariant, and why it matters, is in svgkit.mjs.

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newDoc, arc, hill, S, BG, GUIDE, PINK, R_GOOMBA } from "./svgkit.mjs";

const d = newDoc();
const W = 3600, H = 2440;

// The game's page purple, behind everything, so the sheet reads the way a
// level does. Named with a leading _ so no importer ever picks it up.
d.rect("_bg", 0, 0, W, H, { id: "_bg", fill: BG });

// ==========================================================================
// SECTION A — slopes. The whole terrain vocabulary is "a line at an angle".
// ==========================================================================
d.heading(40, 34, "TERRAIN — every piece is a Line (L). Drag an end, rotate freely, never reach for the pen.");
d.label(40, 56, "Slope is the only thing that matters. Under ~0.12 she stalls creeping uphill; vertical hands back 0.15 while floors stay dead at 0.02.");

const SLOPES = [
  [0, "0 · flat"],
  [0.12, "0.12 · shallowest run that restarts her"],
  [0.25, "0.25 · a normal run"],
  [0.4, "0.4"],
  [0.6, "0.6"],
  [1, "1.0 · 45°"],
];
SLOPES.forEach(([m, name], i) => {
  const x = 40 + i * 260;
  d.poly(x, 110, [[0, 0], [20, 20 * m]]);
  d.label(x, 96, name, { size: 11 });
});
d.poly(40 + 6 * 260, 110, [[0, 0], [0, 28]]);
d.label(40 + 6 * 260 - 8, 96, "wall · 28 u", { size: 11 });
d.label(40 + 6 * 260 - 8, 410, "walls hand a little back", { size: 11 });
d.label(40 + 6 * 260 - 8, 426, "(E 0.15); floors stay dead (0.02)", { size: 11 });

// ==========================================================================
// SECTION B — curves. A "smooth" surface is a fan of lines; nothing else.
// ==========================================================================
d.heading(40, 500, "CURVES — a fan of lines. The sim flattens terrain to segments, so to her this IS smooth.");
d.label(40, 522, "Only rule: keep neighbouring segments ≥ 4.4 u apart (2 × her radius) or she wedges in the corner and the run stalls out.");

d.poly(40, 580, arc(26, 58, 8, true));
d.label(40, 566, "crest · 8 lines · she launches off it", { size: 11 });

d.poly(400, 580, arc(26, 58, 8, false));
d.label(400, 566, "quarter-pipe · 8 lines · catches her and flattens her out", { size: 11 });

d.poly(820, 660, hill(64, 7, 14));
d.label(820, 566, "smooth hill · 14 lines over 64 u", { size: 11 });

// ==========================================================================
// SECTION C — composites. The shapes that survive the shortcut hunt.
// ==========================================================================
d.heading(40, 790, "COMPOSITES — patterns that hold up under verify.mjs. Copy the whole group.");

d.label(40, 830, "V-basin · floor every dead column with one, or a single catch band turns the whole fall into a free ride to somewhere much later.", { size: 11 });
d.poly(40, 860, [[0, 0], [40, 14], [80, -2]]);

d.label(40, 1080, "gap module · a steep run into a short UPHILL shelf pins bare lip speed to ~24, so a 45–58 u gap needs a real band. The can sits ON the far shelf — never hanging in the gap, where anything flying through can graze it.", { size: 11 });
d.poly(40, 1110, [[0, 0], [30, 5], [46, 2.5]]);
d.poly(40, 1110, [[88, 6.5], [102, 9.5]]);
d.band(40 + 46 * S, 1110 + 2.5 * S, 40 + 88 * S, 1110 + 6.5 * S);
d.can(40 + 95 * S, 1110 + 5 * S);
d.label(40 + 52 * S, 1110 + 1 * S, "42 u", { size: 11, fill: PINK });

d.label(40, 1290, "closed slab · 12 u of belly. A can on a", { size: 11 });
d.label(40, 1306, "one-segment ledge is grabbable from directly", { size: 11 });
d.label(40, 1322, "beneath it — 9.7 u of reach vs zero thickness.", { size: 11 });
d.poly(40, 1360, [[0, 0], [20, 0], [20, 12], [0, 12], [0, 0]]);
d.can(40 + 10 * S, 1360 - 1 * S);

d.label(900, 1290, "switchback · the wall kills most of her speed and hands her to", { size: 11 });
d.label(900, 1306, "the floor below, running the other way. End a floor ≥6 u", { size: 11 });
d.label(900, 1322, "short of a wall or she wedges in the notch.", { size: 11 });
d.poly(1160, 1360, [[0, 0], [0, 28]]);
d.poly(1160, 1360, [[-0.6, 31], [-32, 41]]);

d.label(40, 1600, "popper lane · 16 u apart against an ~8 u trigger radius, so crossing the lane always gets her grabbed and re-flung. Poppers erase state, which is what makes stages independent — the structural tool for a 4-band level.", { size: 11 });
for (let i = 0; i < 6; i++) d.popper(140 + i * 160, 1680, 76, 0);

// ==========================================================================
// SECTION D — toys, drawn at their true radius.
// ==========================================================================
d.heading(40, 1830, "TOYS — true radius, symmetric about their anchor. Select one and ⌥⌘K it: instances inherit the name, and the NAME is what carries the meaning.");

const TOYS = [
  ["start · her spawn", (x, y) => d.start(x, y)],
  ["goal · the cake", (x, y) => d.goal(x, y)],
  ["can · ring is her 9.7 u reach", (x, y) => d.can(x, y)],
  ["bumper · piñata, radial kick", (x, y) => d.bumper(x, y)],
  ["pop76 · rotate to aim it.", (x, y) => d.popper(x, y, 76, 0)],
];
TOYS.forEach(([cap, draw], i) => {
  const x = 140 + i * 260;
  draw(x, 1920);
  d.label(x - 95, 2030, cap, { size: 11 });
});
d.label(140 + 4 * 260 - 95, 2046, "Rename pop150 for a faster one.", { size: 11 });
d.cushion(1440, 1920, 24);
d.label(1440, 2030, "cushion · a rect, not a line. Horizontal only,", { size: 11 });
d.label(1440, 2046, "so rotation is ignored. Width = its span.", { size: 11 });

// ==========================================================================
// SECTION E — gauges. Numbers out of DESIGNING.md, at scale, so you can
// eyeball a level instead of doing arithmetic. All `_`-prefixed = ignored.
// ==========================================================================
d.heading(40, 2140, "GAUGES — the real numbers, at scale. Named with a leading _ so nothing here ever imports.");

const gauge = (x, y, w, text, o = {}) => {
  d.group("_gauge", () => {
    d.rawline(x, y, x + w, y, { stroke: o.stroke || GUIDE, sw: 2, dash: o.dash || "" });
    d.rawline(x, y - 8, x, y + 8, { stroke: o.stroke || GUIDE, sw: 2 });
    d.rawline(x + w, y - 8, x + w, y + 8, { stroke: o.stroke || GUIDE, sw: 2 });
  });
  d.label(x, y - 16, text, { size: 11 });
};
gauge(40, 2210, 58 * S, "58 u — one band at full stretch. It sags ~1 u per 20 u of span.", { stroke: PINK, dash: "10 7" });
gauge(40, 2280, 45 * S, "45 u — wider than this is unjumpable at normal speed, so 45–58 u is the “needs exactly one band” window.");
gauge(40, 2350, 6 * S, "6 u — shortest legal band.");
gauge(200, 2350, 4.4 * S, "4.4 u — two segments closer than this wedge her.");
gauge(480, 2350, 16 * S, "16 u — popper spacing in a lane.");

d.group("_gauge", () => {
  d.rawline(1040, 2210, 1040, 2210 + 34 * S, { stroke: GUIDE, sw: 2 });
  d.rawline(1032, 2210, 1048, 2210, { stroke: GUIDE, sw: 2 });
  d.rawline(1032, 2210 + 34 * S, 1048, 2210 + 34 * S, { stroke: GUIDE, sw: 2 });
});
d.label(1060, 2230, "34 u — the most rise a speed-capped launch buys.", { size: 11 });
d.label(1060, 2246, "Put a shelf higher than that above a corridor and", { size: 11 });
d.label(1060, 2262, "no fall or hop can reach it — only a band across.", { size: 11 });

d.group("_gauge", () => {
  d.circle(1700, 2320, R_GOOMBA * S, { stroke: GUIDE, sw: 2 });
  d.circle(1700, 2320, 5 * S, { stroke: GUIDE, sw: 1.5, dash: "5 5" });
});
d.label(1760, 2310, "her radius is 2.2 u; band ends snap onto terrain", { size: 11 });
d.label(1760, 2326, "within 5 u, and lips and corners win the snap.", { size: 11 });

// The world box. Draw your Frame over this and name it "L: <level name>".
d.rect("_world-110x200", 2300, 60, 110 * S, 200 * S, { stroke: GUIDE, dash: "12 10" });
d.label(2300, 34, "_world · 110 × 200 u. Draw a Frame (F) over this, name it “L: Your Level”, and design inside it.", { size: 12 });
d.label(2300, 50, "y is DOWN in this game, same as in Figma — so what you see is what she falls through.", { size: 12 });

// --- write ----------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
await writeFile(
  join(here, "figma-pack.svg"),
  d.render(W, H, "Goomba Glider design pack — generated by tools/goomba/figma/make-pack.mjs"),
);
console.log("figma-pack.svg  " + W + "x" + H + "px  " + d.count() + " nodes  (" + S + "px = 1 unit)");
