#!/usr/bin/env node
// Builds figma-levels.svg — a PACK, laid out side by side as one artboard each,
// in the same vocabulary as the design pack. It is a TRACING TEMPLATE, and the
// word is chosen: paste it into Figma and every shape arrives as a VECTOR.
//
// Measured, not assumed (`figma.createNodeFromSvg`, which is what a paste runs):
// a `<line>` becomes a VECTOR, and so do `<rect>` and `<ellipse>`. Figma's SVG
// import keeps the NAME off the `id` and throws the node type away. The reader
// refuses a vector `t` on purpose — `(0,0)-(width,0)` on one is the top edge of
// a bounding box that can be nowhere near the shape drawn — so a level pasted
// from here does not read back until its terrain is redrawn with the Line,
// Rectangle or Ellipse tool and its toys swapped for kit instances.
//
// Which is still worth a great deal: the names and the positions are already
// right, so redrawing is tracing rather than transcribing. Just do not expect a
// round trip out of it. For that, build the nodes through the plugin API (the
// Figma MCP does this) where the types are yours to choose.
//
// There are no levels in this repo, so point it at a pack: --pack <file>,
// GOOMBA_PACK=<file>, or a pack.json in tools/goomba/ (gitignored). The output
// is gitignored too — a committed copy could only be a stale render.
//
//   node levels-to-svg.mjs            # all levels
//   node levels-to-svg.mjs 1 2 9      # just these
//
// This is the *out* direction, and it is one-way. The *in* direction reads the
// same names back off a Figma selection — see README.md.

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allIndexes, levelAt } from "../lib.mjs";
import { newDoc, slug, S, BG, GUIDE, INK } from "./svgkit.mjs";

const picked = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n));
const idxs = picked.length ? picked : allIndexes();

const GAP = 120; // px between artboards
const PAD = 40;  // px of margin inside one, past the level's own bounds

const d = newDoc();
let cursorX = PAD;
let sheetH = 0;

for (const li of idxs) {
  const L = levelAt(li);
  // The artboard IS the level's world. A level that carries a `frame` had that
  // world AUTHORED — it came from a Figma frame, and the empty space inside it
  // is a design decision — so it is used verbatim rather than re-padded, which
  // is what makes export -> paste -> export a fixed point instead of a world
  // that grows by PAD every pass. Without one, fall back to the derived bounds
  // plus a margin, which is what every level here has always got.
  const b = L.frame ?? {
    x0: L.bounds.x0 - PAD / S, y0: L.bounds.y0 - PAD / S,
    x1: L.bounds.x1 + PAD / S, y1: L.bounds.y1 + PAD / S,
  };
  const w = (b.x1 - b.x0) * S;
  const h = (b.y1 - b.y0) * S;
  const ox = cursorX - b.x0 * S; // px of world x=0 inside this artboard
  const oy = 60 - b.y0 * S;

  // The artboard. A pasted <rect> arrives as a rect, not a Frame — select it
  // plus its contents and hit ⌘⌥G ("Frame selection") to promote it, or let
  // the plugin/MCP path build real Frames in the first place.
  // The frame name is the whole contract: "L--" plus the level's own title, and
  // nothing else — no number (`levelLabel` makes those from the pack position;
  // one written into a frame name could only go stale). The reader turns the
  // hyphens back into spaces, so a round trip keeps the name it shipped with.
  // The caption under it is a Text layer, which every reader ignores, so it can
  // carry the number this pass happens to be printing.
  d.rect("frame", cursorX, 60, w, h,
         { id: "L--" + slug(L.name), fill: BG, stroke: GUIDE, dash: "12 10" });
  d.label(cursorX, 44, `${li + 1} · ${L.name}`, { size: 15, weight: 700, fill: INK });

  for (const p of L.terrain) d.poly(ox, oy, p);
  for (const c of L.cushions) d.cushion(ox + c.x * S, oy + c.y * S, c.w);
  for (const pp of L.pops) d.popper(ox + pp.x * S, oy + pp.y * S, pp.spd, pp.deg);
  for (const bp of L.bumpers) d.bumper(ox + bp.x * S, oy + bp.y * S);
  for (const m of L.cans) d.can(ox + m[0] * S, oy + m[1] * S);
  d.start(ox + L.start[0] * S, oy + L.start[1] * S);
  d.goal(ox + L.goal[0] * S, oy + L.goal[1] * S);

  // No bands. A frame used to carry the level's baked solution as dashed
  // `band` layers, and the readers turned them back into `solution` — an answer
  // key drawn by hand, stale the moment the geometry moved beneath it. The
  // frame is the GEOMETRY now; what solves it is for players to find.

  d.label(cursorX, 60 + h + 22,
          L.cans.length + " cans" +
          (L.pops.length ? " · " + L.pops.length + " poppers" : "") +
          (L.bumpers.length ? " · " + L.bumpers.length + " bumpers" : ""),
          { size: 11 });

  cursorX += w + GAP;
  sheetH = Math.max(sheetH, 60 + h + 60);
}

const here = dirname(fileURLToPath(import.meta.url));
await writeFile(
  join(here, "figma-levels.svg"),
  d.render(Math.round(cursorX + PAD), Math.round(sheetH),
           "Goomba Glider levels " + idxs.map((i) => i + 1).join(",") +
           " — generated by tools/goomba/figma/levels-to-svg.mjs"),
);
console.log("figma-levels.svg  " + idxs.length + " artboards  " +
            Math.round(cursorX + PAD) + "x" + Math.round(sheetH) + "px  " +
            d.count() + " nodes");
