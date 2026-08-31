#!/usr/bin/env node
// A Figma level frame -> the numbers the GAME thinks in.
//
//   node read-frame.mjs --nodes frame.json        # from a use_figma read (below)
//   node read-frame.mjs --clipboard copied.html   # from a Ctrl+C
//   node read-frame.mjs --nodes frame.json --json # for a script
//
// WHY THIS EXISTS
//
// A level's source is a Figma frame, so every question about a level starts by
// converting pixels to world units by hand. That conversion is where a thread
// burns its afternoon and, worse, where it quietly gets one wrong: the anchor
// is the instance's CENTRE, the scale is 10 px per unit, a popper's speed rides
// in its layer name, `deg` is MINUS Figma's rotation, and `bounds` is not the
// frame. All of that is written down — in figma/README.md, in levels.ts — and
// writing it down has not stopped anyone from re-deriving it slightly
// differently.
//
// So this prints it. It does not judge a level: there is no verdict here, no
// simulation, no pass and no fail. `verify.mjs` and the gate it served are
// deleted on purpose (see ../DESIGNING.md) and this is not them coming back —
// it is Figma's Design panel, read in the units the physics uses, which is the
// thing the docs already tell you to go and do by hand.
//
// TWO CARRIERS, AND BOTH CARRY THE TRANSFORM
//
// `--clipboard` reuses the SHIPPED reader (apps/goomba-glider/src/figma/
// clipboard.js): what comes out is what pasting into the game would produce. It
// needs a person, because a Figma copy only reaches the clipboard from a
// genuine user gesture.
//
// `--nodes` is the one an agent can get alone — the JSON returned by a
// READ-ONLY `use_figma` script (the snippet is in figma/README.md, and in the
// --help below). It carries each node's x, y, size and ROTATION, which is what
// makes it exact.
//
// There was very nearly a third carrier here: the XML from the MCP's
// `get_metadata`, which needs no script at all. It is not safe and this is
// worth spelling out, because it looks safe. That XML reports each node's x/y
// as the node's ORIGIN but its width/height as the BOUNDING BOX — two different
// rectangles — and it does not carry rotation at all. So `x + width/2` is the
// centre only when the node happens to be unrotated, and nothing in the XML
// says which nodes those are: a popper turned 90° reports the same 140x140 box
// as one turned 0°, with its centre 14 units away from where that arithmetic
// puts it. Every popper in Fireworks is rotated. Do not read positions out of
// that XML; use it to find frames and names, and come here for numbers.
import { readFile } from "node:fs/promises";
import { classify, levelName, hasFigmaBuffer, levelFromFigmaClipboard, FIGMA_POP_SPD }
  from "../../../apps/goomba-glider/src/figma/clipboard.js";
import { stitchTerrain } from "../../../apps/goomba-glider/src/figma/stitch.js";
import { rectPoly, ellipsePoly, cutTester, applyCuts }
  from "../../../apps/goomba-glider/src/figma/shapes.js";
import { initLevel, R, BUMP_R, POP_R } from "../lib.mjs";

const S = 10; // px per world unit — the kit's scale, and the contract's
const ROUND = (v) => Math.round(v * 10) / 10;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

/** The read-only script that produces `--nodes` input. Printed by --help. */
export const INSPECT_SNIPPET = `const page = await figma.getNodeByIdAsync("47:2");   // the Levels page
await figma.setCurrentPageAsync(page);
const f = await figma.getNodeByIdAsync("<the L: frame's id>");
return { frame: { name: f.name, w: f.width, h: f.height },
  kids: f.children.map((c) => ({ name: c.name, type: c.type,
    x: c.x, y: c.y, w: c.width, h: c.height, rot: c.rotation ?? 0 })) };`;

// ------------------------------------------------------------ nodes carrier

/**
 * Figma's transform, rebuilt from what the Plugin API hands back.
 *
 * `node.x`/`node.y` are the translation — where the node's own (0,0) lands in
 * its parent — and `rotation` turns it about that point, counter-clockwise
 * positive in a y-DOWN space. So the matrix is the usual one with the sines
 * swapped, and every anchor the contract asks for (an instance's centre, a
 * Line's two ends, a cushion's left edge) is a point pushed through it.
 */
const matrix = (x, y, rot) => {
  const r = (rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, x, -s, c, y];
};
const apply = (m, x, y) => ({ x: m[0] * x + m[1] * y + m[2], y: m[3] * x + m[4] * y + m[5] });

function fromNodes(doc) {
  if (!doc || !doc.frame || !Array.isArray(doc.kids))
    throw new Error(
      "expected { frame: {name, w, h}, kids: [{name, x, y, w, h, rot}] } — " +
      `got keys: ${Object.keys(doc || {}).join(", ") || "(none)"}. ` +
      "Run the snippet from --help and save exactly what it returns.");
  const W = (v) => ROUND(v / S);
  const name = levelName(doc.frame.name);
  if (!name) throw new Error(`"${doc.frame.name}" is not a level frame — the name must read \`L: <title>\`.`);
  const level = {
    name, start: [0, 0], goal: [0, 0],
    terrain: [], cans: [], pops: [], bumpers: [], cushions: [],
    frame: { x0: 0, y0: 0, x1: W(doc.frame.w), y1: W(doc.frame.h) },
  };
  const warnings = [];
  const shapes = [], cuts = [];
  let bands = 0;

  for (const k of doc.kids) {
    const hit = classify(k.name);
    if (!hit) {
      if (/^(FRAME|GROUP|SECTION)$/.test(k.type || ""))
        warnings.push(`"${k.name}" is a ${k.type} and nothing descends into it — ` +
          `if it holds toys, ungroup it or read it as its own frame.`);
      continue;
    }
    const { kind } = hit;
    const m = matrix(k.x, k.y, k.rot || 0);
    if (kind === "band") { bands++; continue; }
    if (kind === "cut") {
      const isEllipse = k.type === "ELLIPSE";
      const t = (isEllipse || /RECT/.test(k.type || ""))
        ? cutTester(isEllipse ? "ellipse" : "rect", m, k.w, k.h, k.radius || 0)
        : null;
      if (t) cuts.push(t);
      else warnings.push(`"${k.name}" is a ${k.type || "shape"} — a \`cut\` must be a ` +
        `Rectangle or an Ellipse, so nothing was taken away.`);
      continue;
    }
    if (kind === "t") {
      // A Figma Line is zero-height: local (0,0)-(w,0) IS the segment. A rect
      // or an ellipse is read as its outline instead; only the pen is refused.
      if (k.type === "ELLIPSE") { shapes.push(ellipsePoly(m, k.w, k.h)); continue; }
      if (/RECT/.test(k.type || "")) { shapes.push(rectPoly(m, k.w, k.h, k.radius || 0)); continue; }
      if (k.type && k.type !== "LINE") {
        warnings.push(`"${k.name}" is a ${k.type} — skipped. Terrain is a Line, a ` +
          `Rectangle or an Ellipse; a pen path has no readable outline.`);
        continue;
      }
      const a = apply(m, 0, 0), b = apply(m, k.w, 0);
      level.terrain.push([[W(a.x), W(a.y)], [W(b.x), W(b.y)]]);
      continue;
    }
    const c = apply(m, k.w / 2, k.h / 2);
    const pt = [W(c.x), W(c.y)];
    if (kind === "start") level.start = pt;
    else if (kind === "goal") level.goal = pt;
    else if (kind === "can") level.cans.push(pt);
    else if (kind === "bumper") level.bumpers.push({ x: pt[0], y: pt[1] });
    // `deg = -rotation`: Figma's rotation is counter-clockwise positive and the
    // game's deg feeds cos/sin in a y-down world, so it is clockwise positive.
    else if (kind === "pop") level.pops.push({ x: pt[0], y: pt[1], deg: ROUND(-(k.rot || 0)), spd: FIGMA_POP_SPD });
    else if (kind === "cushion") {
      const left = apply(m, 0, k.h / 2);
      level.cushions.push({ x: W(left.x), y: W(left.y), w: W(k.w) });
    }
  }
  // Figma holds one Line per segment; the game strokes polylines with round
  // caps, so unstitched chains grow half-stroke stubs at every shared vertex.
  level.terrain = applyCuts([...stitchTerrain(level.terrain), ...shapes], cuts);
  if (bands) warnings.push(`${bands} \`band\` layer${bands > 1 ? "s" : ""} ignored — a level has no solution field.`);
  return { level, warnings };
}

// ---------------------------------------------------------------- the report

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

function report(level, warnings, carrier) {
  const L = initLevel(level);
  const b = L.bounds, f = L.frame;
  const out = [];
  const say = (s = "") => out.push(s);

  say(`${level.name}`);
  say(`  carrier   ${carrier}`);
  say(`  frame     ${f.x0} , ${f.y0}  ->  ${f.x1} , ${f.y1}   (${ROUND(f.x1 - f.x0)} x ${ROUND(f.y1 - f.y0)})`);
  say(`  world     ${b.x0} , ${b.y0}  ->  ${b.x1} , ${b.y1}   (${ROUND(b.x1 - b.x0)} x ${ROUND(b.y1 - b.y0)})`);

  // The frame is the world only when it is the outer box on every edge. Where
  // the ink pushes past it, the world is bigger than the drawing says — and the
  // camera and three of the four deaths are out there where nobody drew.
  const over = [
    ["left", ROUND(f.x0 - b.x0)], ["top", ROUND(f.y0 - b.y0)],
    ["right", ROUND(b.x1 - f.x1)], ["bottom", ROUND(b.y1 - f.y1)],
  ].filter(([, d]) => d > 0.05);
  say(over.length
    ? `  ! the frame is NOT the world: ink+margin reaches past it on the ` +
      over.map(([e, d]) => `${e} by ${d}`).join(", ")
    : `  the frame IS the world`);
  say();

  const rows = [["start", ...level.start, ""], ["goal", ...level.goal, ""]];
  for (const c of level.cans) rows.push(["can", ...c, ""]);
  for (const p of level.pops)
    rows.push(["popper", p.x, p.y, `deg ${padL(p.deg, 4)}   spd ${p.spd} -> ${ROUND(p.spd * 0.82)} u/s`]);
  for (const m of level.bumpers) rows.push(["bumper", m.x, m.y, ""]);
  for (const c of level.cushions) rows.push(["cushion", c.x, c.y, `w ${c.w}`]);
  for (const r of rows) say(`  ${pad(r[0], 9)}${padL(r[1], 7)} ${padL(r[2], 7)}   ${r[3]}`.trimEnd());
  say();

  const pts = level.terrain.reduce((n, t) => n + t.length, 0);
  say(`  terrain   ${level.terrain.length} polyline${level.terrain.length === 1 ? "" : "s"}, ${pts} points (stitched)`);

  // Mechanical facts, not judgements. Each one is a distance the game already
  // computes; none of them says whether a level is any good.
  const notes = [];
  // Speed used to ride in the layer name as trailing digits, and Figma
  // increments a trailing number on duplicate — so a sketch full of copies
  // arrived carrying speeds nobody chose. One constant now, for every popper
  // any frame can produce; the note is what that constant IS.
  if (level.pops.length)
    notes.push(`popper speed: ${FIGMA_POP_SPD} for every one of them ` +
      `(FIGMA_POP_SPD) -> ${ROUND(FIGMA_POP_SPD * 0.82)} u/s off the muzzle`);
  // A popper OVERWRITES velocity in the same step, after the bumper block. So
  // wherever their discs overlap the popper simply wins, and that part of the
  // ball cannot be bounced off.
  const REACH = BUMP_R + R + POP_R + R;
  for (let i = 0; i < level.bumpers.length; i++)
    for (let j = 0; j < level.pops.length; j++) {
      const d = Math.hypot(level.bumpers[i].x - level.pops[j].x, level.bumpers[i].y - level.pops[j].y);
      if (d < REACH)
        notes.push(`bumper ${i + 1} is ${ROUND(d)} from popper ${j + 1} (< ${ROUND(REACH)}): ` +
          `their discs overlap, and the popper runs after the bumper, so that face cannot bounce her.`);
    }
  // Two balls closer than their contact circles leave a corridor she may or may
  // not fit her CENTRE through; the circles already carry her radius.
  const CONTACT = BUMP_R + R;
  for (let i = 0; i < level.bumpers.length; i++)
    for (let j = i + 1; j < level.bumpers.length; j++) {
      const d = Math.hypot(level.bumpers[i].x - level.bumpers[j].x, level.bumpers[i].y - level.bumpers[j].y);
      if (d < 2 * CONTACT + 6)
        notes.push(`bumpers ${i + 1} and ${j + 1} are ${ROUND(d)} apart: ` +
          (d <= 2 * CONTACT ? `their contact circles touch — no gap at all.`
            : `a ${ROUND(d - 2 * CONTACT)}-unit corridor for her centre.`));
    }
  if (notes.length) { say(); for (const n of notes) say(`  · ${n}`); }
  for (const w of warnings || []) say(`  ! ${w}`);
  return out.join("\n");
}

// ---------------------------------------------------------------------- main

const nodes = opt("nodes", null);
const clip = opt("clipboard", null);

if (!nodes && !clip) {
  console.error(
    "read-frame.mjs — a Figma level frame in the game's units\n\n" +
    "  --nodes <file|->      JSON from a read-only use_figma script\n" +
    "  --clipboard <file>    HTML saved from a Ctrl+C in Figma\n" +
    "  --json                machine-readable\n\n" +
    "The use_figma script to run, saving what it returns:\n\n" +
    INSPECT_SNIPPET.split("\n").map((l) => `  ${l}`).join("\n") + "\n",
  );
  process.exit(2);
}

const read = async (p) =>
  p === "-" ? await new Response(process.stdin).text() : await readFile(p, "utf8");

let got;
if (clip) {
  const html = await read(clip);
  if (!hasFigmaBuffer(html))
    throw new Error(`${clip} holds no Figma clipboard payload (no data-buffer/(figma) blob).`);
  const { level, warnings } = await levelFromFigmaClipboard(html);
  got = { level, warnings, carrier: "clipboard" };
} else {
  const { level, warnings } = fromNodes(JSON.parse(await read(nodes)));
  got = { level, warnings, carrier: "use_figma nodes" };
}

if (flag("json")) {
  const L = initLevel(got.level);
  console.log(JSON.stringify({
    name: L.name, carrier: got.carrier, frame: L.frame, bounds: L.bounds,
    start: L.start, goal: L.goal, cans: L.cans, pops: L.pops,
    bumpers: L.bumpers, cushions: L.cushions, terrain: L.terrain,
    warnings: got.warnings,
  }, null, 2));
} else {
  console.log(report(got.level, got.warnings, got.carrier));
}
