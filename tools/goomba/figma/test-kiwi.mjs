#!/usr/bin/env node
// Proof for kiwi.mjs — the OUT direction, in Figma's own clipboard format.
//
//   node test-kiwi.mjs
//
// What this can and cannot prove is worth being precise about, because the
// format is undocumented and the temptation is to believe a green test.
//
// It CAN prove the payload is well formed and means what we meant: the shipped
// reader (`clipboard.js`) decodes it, and the level that comes back is the level
// that went in — same terrain, same toys, same rotations, same names. That is
// not a weak check. It is the same reader a real Ctrl+C goes through, and it
// exercises the container, the borrowed schema, the compression, the transforms
// and the naming contract in one pass.
//
// It CANNOT prove FIGMA will accept it. Only a paste can, and only a person can
// paste. Two things in particular are theories until someone tries:
//   * both blocks are raw DEFLATE here, where a real copy zstd's the message.
//     The reader picks by magic; Figma's is assumed to.
//   * `derivedSymbolData` and the geometry `blobs` a real copy carries are
//     omitted, on the theory that "derived" means Figma rebuilds them.
// If a paste comes through blank or refuses, those are the two suspects, in
// that order — and this test staying green is exactly what tells you the
// problem is Figma's acceptance rather than our encoding.
import { figmaClipboardHtml, KIT, FILE_KEY } from "./kiwi.mjs";
import { levelFromFigmaClipboard } from "../../../apps/goomba-glider/src/figma/clipboard.js";
import { initLevel } from "../draft/_sim.mjs";
import { buildLevel } from "../draft/in-and-out.mjs";

let bad = 0;
const eq = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
};
const near = (what, got, want, tol = 0.15) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `  got ${got}, want ${want}`}`);
};

const L = initLevel(buildLevel());
const { html, nodes, bytes } = figmaClipboardHtml(L);
console.log(`a level -> Figma clipboard: ${nodes} nodes, ${bytes} base64 chars`);

const { level: back, warnings } = await levelFromFigmaClipboard(html);

console.log("\nround trip, through the shipped reader");
eq("the level name survives the `L:` frame", back.name, L.name);
eq("every can", back.cans.length, L.cans.length);
eq("every popper", back.pops.length, L.pops.length);

// The frame's origin is world (0,0), so everything comes back shifted by the
// frame's own offset. Compare RELATIVE to the start, which is the only thing
// that has to be true — `levels-to-svg.mjs` re-pads the same way.
const dx = back.start[0] - L.start[0], dy = back.start[1] - L.start[1];
const shifted = (p) => [+(p[0] + dx).toFixed(1), +(p[1] + dy).toFixed(1)];
eq("start and goal keep their offset", back.goal, shifted(L.goal));
eq("cans land where they were put", back.cans, L.cans.map(shifted));

// The one that would go wrong silently: a popper's aim. `deg = -rotation`, and
// getting the sign backwards produces a level that looks right and plays
// mirrored.
for (const i of [0, 5, 11]) {
  near(`popper ${i} aim survives (deg ${L.pops[i].deg})`, back.pops[i].deg, L.pops[i].deg, 0.6);
  near(`popper ${i} x`, back.pops[i].x, L.pops[i].x + dx, 0.15);
  near(`popper ${i} y`, back.pops[i].y, L.pops[i].y + dy, 0.15);
}

// Terrain goes out as one Line per segment and comes back stitched, so the
// POINT COUNT is the honest comparison, not the polyline count.
const pts = (t) => t.reduce((n, p) => n + p.length, 0);
const segs = (t) => t.reduce((n, p) => n + p.length - 1, 0);
eq("every terrain segment survives", segs(back.terrain), segs(L.terrain));
console.log(`  ..   ${L.terrain.length} polylines / ${pts(L.terrain)} points out, ` +
  `${back.terrain.length} / ${pts(back.terrain)} back (stitching rejoins them)`);

console.log("\nthe things that make it file-specific");
eq("pasteFileKey names the file", FILE_KEY, "vRN6Q44ReIaESP5wv8M2dI");
eq("every toy points at a real component", Object.keys(KIT).length, 6);
if (warnings.length) console.log("  warnings:", warnings.join(" · "));

console.log(bad ? `\n→ FAIL ✗ (${bad} check(s))` : "\n→ PASS ✓  the payload decodes to the level it was made from");
process.exit(bad ? 1 : 0);
