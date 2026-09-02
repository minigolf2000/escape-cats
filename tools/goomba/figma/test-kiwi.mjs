#!/usr/bin/env node
// Proof for kiwi.mjs — the OUT direction, in Figma's own clipboard format.
//
//   node test-kiwi.mjs
//
// It proves the payload decodes, through the shipped reader (`clipboard.js`),
// to the level it was made from: terrain, toys, rotations, names. It CANNOT
// prove Figma will accept it — only a paste by a person can. If a paste comes
// through blank or refuses, the suspects in order: both blocks are raw DEFLATE
// where a real copy zstd's the message; `derivedSymbolData` and the geometry
// `blobs` are omitted. This staying green says the fault is acceptance, not
// encoding.
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

// The frame's origin is world (0,0), so compare RELATIVE to the start.
const dx = back.start[0] - L.start[0], dy = back.start[1] - L.start[1];
const shifted = (p) => [+(p[0] + dx).toFixed(1), +(p[1] + dy).toFixed(1)];
eq("start and goal keep their offset", back.goal, shifted(L.goal));
eq("cans land where they were put", back.cans, L.cans.map(shifted));

// A popper's aim: the sign backwards looks right and plays mirrored.
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
