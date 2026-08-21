#!/usr/bin/env node
// The only test here made of REAL data: an actual Ctrl+C of the "L: 1 · The
// Long Way Down" frame, captured off the Windows clipboard, in
// fixtures/real-figma-copy.b64.
//
//   node test-real-copy.mjs
//
// It earns its keep because every synthetic fixture in test-clipboard.mjs is
// built from what I BELIEVED the format to be, and twice that belief was wrong
// in ways the synthetic tests could never catch — the buffer closes with
// `(/figma)` rather than a second `(figma)`, and the message block is
// ZSTANDARD while the schema block beside it is raw deflate.
//
// That frame was generated FROM levels.ts, so a faithful read has to reproduce
// levels.ts[0] exactly, up to the uniform translation of where the frame sits
// on the Figma canvas.
import { readFileSync } from "node:fs";
import { levelFromFigmaClipboard } from "../../../apps/goomba-editor/src/figma-clipboard.js";
import { LEVELS } from "../lib.mjs";

const b64 = readFileSync(new URL("./fixtures/real-figma-copy.b64", import.meta.url), "utf8").trim();
const { level } = await levelFromFigmaClipboard(
  `<span data-buffer="<!--(figma)${b64}(/figma)-->"></span>`);

const L = LEVELS[0];
const r1 = (v) => +v.toFixed(1);
// A faithful read reproduces the level up to a uniform translation: the frame's
// own placement on the canvas is not part of the level.
const dx = level.start[0] - L.start[0], dy = level.start[1] - L.start[1];
const un = ([x, y]) => [r1(x - dx), r1(y - dy)];
const key = (segs) =>
  JSON.stringify(segs.map((s) => s.map((pt) => pt.map(r1))).sort());
// levels.ts stores polylines; the reader returns segments. Flatten to segments.
const segsOf = (polys) =>
  polys.flatMap((p) => p.slice(0, -1).map((_, i) => [p[i].map(r1), p[i + 1].map(r1)]));

let bad = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) { console.log(`         got  ${got}`); console.log(`         want ${want}`); }
};
console.log(`real Figma copy of "${level.name}" vs levels.ts[0] "${L.name}"`);
console.log(`  (uniform offset dx=${dx} dy=${dy}, i.e. the frame's canvas position)`);
check("name", level.name, L.name);
check("terrain segments", key(level.terrain.map((s) => s.map(un))), key(segsOf(L.terrain)));
check("solution bands", key(level.solution.map((s) => s.map(un))), key(segsOf(L.solution.map((p) => p))));
check("start", JSON.stringify(un(level.start)), JSON.stringify(L.start.map(r1)));
check("goal", JSON.stringify(un(level.goal)), JSON.stringify(L.goal.map(r1)));
const pts = (list) => JSON.stringify(list.map((p) => p.map(r1)).sort());
check("cans", pts(level.cans.map(un)), pts(L.cans));
check("counts (pops/bumpers/cushions)",
  `${level.pops.length}/${level.bumpers.length}/${level.cushions.length}`,
  `${L.pops.length}/${L.bumpers.length}/${L.cushions.length}`);
console.log(bad ? `\n→ FAIL ✗ (${bad})` : "\n→ PASS ✓  a real Ctrl+C round-trips to the shipped level");
process.exit(bad ? 1 : 0);
