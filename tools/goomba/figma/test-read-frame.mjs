#!/usr/bin/env node
// Proof for read-frame.mjs's `--nodes` path.
//
//   node test-read-frame.mjs
//
// The fixture is REAL: `fixtures/fireworks-nodes.json` is what a read-only
// `use_figma` script returned for the Fireworks frame, untouched. It must be a
// carrier with the TRANSFORM: ten of Fireworks' fifteen poppers are turned 90°,
// and a box-only carrier (`get_metadata` XML) reads each 14 units off — a
// fixture generated under the same assumption as the code cannot catch that.
import { POP_SPD, initLevel } from "../lib.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "fireworks-nodes.json");
const run = (...args) =>
  JSON.parse(execFileSync("node", [join(here, "read-frame.mjs"), ...args], { encoding: "utf8" }));

let fail = 0;
const eq = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`);
};

const L = run("--nodes", fixture, "--json");

eq("the frame name is the level name, with no number", L.name, "Fireworks");

// 1205 x 1640 px at 10 px per unit, origin at the frame's top-left.
eq("frame box in world units", L.frame, { x0: 0, y0: 0, x1: 120.5, y1: 164 });

// The world is NOT that box: poppers reach past three edges, and `initLevel`
// eats a popper as its centre ±6 before unioning the frame in.
eq("world bounds from the shipped initLevel", L.bounds, { x0: -7.3, y0: -11.4, x1: 121.6, y1: 166.6 });

// A node at (815, 1596), 140x140, rotated 90°: rotation is about the node's
// own origin, so its centre is (815 + 70, 1596 - 70) -> 88.5, 152.6. The box
// would say 166.6, fourteen units into the floor.
const col = L.pops.filter((p) => p.deg === -90 && p.x === 88.5).map((p) => p.y);
eq("a rotated instance anchors through its TRANSFORM, not its box", col, [152.6, 116.6, 80.6, 44.6]);

// deg is MINUS Figma's rotation (Figma counts counter-clockwise; deg feeds
// cos/sin in a y-down world). rot 90 -> deg -90 -> aims UP.
eq("deg is minus the Figma rotation", L.pops[2].deg, -90);
eq("...and that aim points up", [Math.round(Math.cos(L.pops[2].deg * Math.PI / 180)), Math.round(Math.sin(L.pops[2].deg * Math.PI / 180))], [0, -1]);

// An unrotated instance: 180 px of bumper art around a 5.5 u collision radius,
// and the anchor is still the centre.
eq("all four bumpers", L.bumpers, [
  { x: 68.5, y: 62.6 }, { x: 68.5, y: 80.6 }, { x: 68.5, y: 98.6 }, { x: 68.5, y: 152.6 }]);

// ONE speed, and a FRAME DOES NOT CARRY IT. The reader leaves it off entirely
// and `initLevel` stamps POP_SPD, so a drawing and a link fire identically.
// Figma increments a trailing number on duplicate, so this fixture's popper
// names read 110..138 — a spread nobody designed, and now one that nothing in
// the pipeline can express.
eq("every popper fires the one speed, whatever the frame said",
  [...new Set(L.pops.map((p) => p.spd))], [POP_SPD]);
eq("...and it is the constant, not something the reader chose",
  initLevel(L).pops.every((p) => p.spd === POP_SPD), true);

eq("cans", L.cans.length, 6);
eq("start", L.start, [6, 112.1]);
eq("goal", L.goal, [88.5, 62.6]);

// A Line is zero-height, so its transform IS its two endpoints — this one
// slopes down to the right, which the box alone could not have told you.
eq("terrain comes back as stitched polylines", L.terrain, [[[0.7, 116.3], [11.5, 119.8]]]);

console.log(fail ? `\n${fail} failed` : "\nall good");
process.exit(fail ? 1 : 0);
