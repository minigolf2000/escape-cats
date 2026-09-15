#!/usr/bin/env node
// Proof for read-frame.mjs's `--nodes` path.
//
//   node test-read-frame.mjs
//
// Both fixtures are REAL: what a read-only `use_figma` script returned for the
// frame, untouched. They must be carriers with the TRANSFORM: ten of Fireworks'
// fifteen poppers are turned 90°, and a box-only carrier (`get_metadata` XML)
// reads each 14 units off — a fixture generated under the same assumption as
// the code cannot catch that.
//
// `fireworks-nodes.json` is an OLD dump, from before the snippet carried `m`:
// it keeps the x/y/rot fallback honest, and it is the shape of dump that hid
// the Cat's Cradle bug. `cats-cradle-nodes.json` carries `m`, and four of its
// eight poppers are FLIPPED as well as turned — a mirror is a determinant of
// -1 and no rotation angle stands for one, so rebuilding the matrix from the
// angle put those four 4.2 units across and 16 up from where they are drawn.
// That is the case only a transform-carrying fixture can catch.
import { FIGMA_POP_SPD } from "../../../apps/goomba-glider/src/figma/clipboard.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "fireworks-nodes.json");
const cradle = join(here, "fixtures", "cats-cradle-nodes.json");
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

// One constant speed: Figma increments a trailing number on duplicate, so this
// fixture's popper names read 110..138 — a spread nobody designed.
eq("every popper gets the one constant speed",
  L.pops.map((p) => p.spd), L.pops.map(() => FIGMA_POP_SPD));
eq("...and the digits in the names are ignored",
  new Set(L.pops.map((p) => p.spd)).size, 1);

eq("cans", L.cans.length, 6);
eq("start", L.start, [6, 112.1]);
eq("goal", L.goal, [88.5, 62.6]);

// A Line is zero-height, so its transform IS its two endpoints — this one
// slopes down to the right, which the box alone could not have told you.
eq("terrain comes back as stitched polylines", L.terrain, [[[0.7, 116.3], [11.5, 119.8]]]);

// ---------------------------------------------------------- the flipped case

const C = run("--nodes", cradle, "--json");

eq("a flipped frame still names itself", C.name, "Cat's Cradle");

// The four lanes are drawn evenly spaced, alternating which way they fire.
// Read through the angle alone the left-aimed pair lands at y 40.4 and 100.7
// — a lattice with a 46-unit hole in the middle that nothing in Figma shows.
const lanes = [...new Set(C.pops.map((p) => p.y))].sort((a, b) => a - b);
eq("a flipped popper anchors through its MATRIX: four evenly spaced lanes",
  lanes, [25.7, 56.3, 86.7, 116.6]);
eq("...and two columns, the flipped ones sharing the unflipped ones' x",
  [...new Set(C.pops.map((p) => p.x))].sort((a, b) => a - b), [34.2, 81.3, 81.4]);

// The mirror is in the matrix, not the angle: aim was never the broken half.
eq("the lanes alternate their aim",
  lanes.map((y) => C.pops.find((p) => p.y === y).deg), [-15, -165, -15, -165]);

// An unflipped node in the same frame must read the same either way.
eq("an unflipped neighbour is untouched", C.cans, [[57.6, 23.6], [22.6, 55.7], [47.7, 101.2], [33.4, 101]]);
eq("start", C.start, [17.2, 8.4]);
eq("goal", C.goal, [7.3, 110.8]);

// A dump with no `m` cannot say whether anything was flipped, so it says so.
const boxed = run("--nodes", fixture, "--json").warnings.filter((w) => w.includes("FLIP"));
eq("a transform-less dump warns that a flip would be invisible to it", boxed.length, 1);
eq("...and a dump that carries `m` does not", C.warnings.filter((w) => w.includes("FLIP")).length, 0);

console.log(fail ? `\n${fail} failed` : "\nall good");
process.exit(fail ? 1 : 0);
