// The momentum arc: a quarter-pipe that stands a horizontal popper on its end.
//
// `arc.mjs` answers "where does this popper's throw land" for a launch that
// flies. This answers the other half — what a CURVE does to a launch that
// arrives along the floor — because the intuition everyone brings to it ("a
// half-pipe turns speed into height, and a circle is the perfect shape") is
// half wrong in a way the sim will tell you about in one run.
//
// What is actually true, measured here and written up in DESIGNING.md:
//
//   * Terrain never adds energy (E is 0.02 on a floor, 0.15 at vertical), so
//     the arc cannot beat the launch that fed it. The most any 90° turn can
//     hand back is the launch speed, standing up: rise = v²/2G, nothing more.
//   * In a lossless world every 90° turn ties, whatever its shape — the height
//     she climbs inside the pipe is STORED, not spent. So the arc's shape is
//     not choosing how much height she gets; it is only choosing how much of
//     it she loses on the way.
//   * The loss lives in the CORNERS, not the curve. Each joint kills the
//     velocity component normal to the next chord, so a turn cut into n lines
//     keeps about cos(90°/n)^n — n is the whole lever, and the radius barely
//     shows up. At 106 u/s: 24 lines keeps 85% of the rise, 8 lines 73%, 2
//     lines (a plain 45° ramp) 41%.
//   * But there IS a floor under that, and it is the substep. Cut chords much
//     shorter than the 0.4 u she covers in one 1/240 s tick and the losses come
//     back — measured at r 8, the lip speed peaks at 32 lines (90.0 u/s) and
//     falls away to 85.0 by 192, on flat contact time and never more than one
//     segment touching, so it is the resolver re-clipping her against chord
//     after chord, not friction. Aim for chords about one substep long:
//     n ≈ 377·r/v, which is 24-32 for a normal arc at speed.
//   * Then friction (0.18/s while in contact) charges by TIME on the surface,
//     which is what finally punishes a big lazy arc — and punishes a flat
//     run-in harder than the arc itself: about a unit of rise per 10 units of
//     floor between the popper and the mouth.
//
// Which does make the circle optimal, but for the constrained reason rather
// than the romantic one: among curves that never bend tighter than r, the
// circular arc is the SHORTEST way through 90° and the shallowest, so it holds
// the least friction and the smallest footprint. Bend tighter and you do
// better still, until she stops fitting (r > her radius 2.2, and r ≥ 3.2 keeps
// the mouth and the lip the legal 4.4 apart).
//
//   node pipe.mjs                        the design table — what a pipe keeps
//   node pipe.mjs --r 8 --n 24 --spd 130 one arc, ridden through the shipped sim
//   node pipe.mjs --at 70,200 --pts      its vertices, ready for levels.ts
//   node pipe.mjs --svg arc.svg          the piece as a sheet — a TRACING GUIDE, see below
//   node pipe.mjs --link                 a level link to Ctrl+V into the game
//
// ON THE SVG, AND WHY IT IS NOT A WAY INTO FIGMA. It emits real `<line>`
// elements, which is what the game's own SVG reader wants — drop the FILE on
// the grid and they read. What it cannot do is travel through Figma. Measured
// on a real import of this file: every `<line>` arrives as a **VECTOR** node
// (it keeps the id as its name, so they come in correctly named `t-1`…`t-25`,
// which is what makes the failure look like a success until the paste banner
// says otherwise), and both readers then skip it — `clipboard.js` on
// `n.type !== "LINE"`, `svg.js` on `localName !== "line"`. That refusal is
// deliberate and worth keeping: for anything but a Line, (0,0)-(width,0) is
// the top edge of a bounding box, which arrives as a perfectly plausible
// straight segment that silently changes whether the level is winnable. A
// layer that goes missing is a bug you can SEE.
//
// So Figma's importer cannot make a Line; only the Line tool (L) and the
// Plugin API's `figma.createLine()` can. Into a Figma FRAME, the route is the
// Plugin API. Into the GAME, the route is `--link`. This sheet is for reading
// the piece and for tracing over.
import { writeFile } from "node:fs/promises";
import { makeRun, stepRun, initLevel, encodeLevel, SUB } from "./lib.mjs";
import { newDoc, S, BG, PINK, GUIDE } from "./figma/svgkit.mjs";

const G = 140, R = 2.2;

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf("--" + k);
  return i < 0 ? d : argv[i + 1];
};
const has = (k) => argv.includes("--" + k);
const r = +opt("r", 8);
const n = Math.max(1, Math.round(+opt("n", 24)));
const spd = +opt("spd", 130);
const gap = +opt("gap", 6);          // popper → mouth. Every unit of it is loss.
const maxSpeed = +opt("max", 120);
const [mx, my] = String(opt("at", "70,200")).split(",").map(Number);

/** The arc itself: a quarter circle from (mx,my) turning her through 90°,
 * cut into n chords. First point is the mouth, last is the lip. */
function arcPts(mouthX, mouthY, rad, chords) {
  const pts = [];
  for (let i = 0; i <= chords; i++) {
    const p = (Math.PI / 2 * i) / chords;
    pts.push([
      +(mouthX + rad * Math.sin(p)).toFixed(2),
      +(mouthY - rad * (1 - Math.cos(p))).toFixed(2),
    ]);
  }
  return pts;
}

/** Floor, popper, arc — and her ride through it, on the sim the server scores
 * with. Returns everything the design table wants to know. */
function ride({ rad = r, chords = n, speed = spd, lead = gap, cap = maxSpeed,
                goal = null } = {}) {
  const runIn = lead + 26;
  const pts = arcPts(mx, my, rad, chords);
  // The goal is parked out of the world unless a caller asks for one. Leaving it
  // anywhere near the apex ends the run as a WIN the moment she flies within 9
  // units of it — which silently capped every number in this file at the goal's
  // own height until it didn't.
  const L = initLevel({
    name: "pipe rig", maxSpeed: cap,
    start: [mx - runIn + 4, my - R], goal: goal ?? [9e5, 9e5],
    terrain: [[[mx - runIn, my], ...pts]],
    cans: [], cushions: [], bumpers: [],
    pops: [{ x: mx - lead, y: my - R, deg: 0, spd: speed }],
  });
  const st = makeRun(L, []);
  st.p = { x: mx - lead - 12, y: my - R };
  st.v = { x: 20, y: 0 };
  let apex = st.p.y, apexX = st.p.x, vPop = 0, vMouth = 0, vLip = { x: 0, y: 0 };
  let popped = false, atMouth = false, offLip = false;
  for (let i = 0; i < 240 * 8 && !st.result; i++) {
    stepRun(st, SUB);
    if (!popped && st.popT[0] >= 0) { popped = true; vPop = Math.hypot(st.v.x, st.v.y); }
    if (popped && !atMouth && st.p.x >= mx) { atMouth = true; vMouth = Math.hypot(st.v.x, st.v.y); }
    if (atMouth && !offLip && !st.grounded && st.v.y < 0) {
      offLip = true; vLip = { x: st.v.x, y: st.v.y };
    }
    if (st.p.y < apex) { apex = st.p.y; apexX = st.p.x; }
    if (popped && st.v.y > 0 && !st.grounded && st.p.x > mx) break;
  }
  const rise = (my - R) - apex;
  const ceiling = (vPop * vPop) / (2 * G);
  return { L, pts, vPop, vMouth, vLip, rise, ceiling, keep: rise / ceiling,
           apex: [+apexX.toFixed(1), +apex.toFixed(1)], result: st.result };
}

const pct = (x) => (100 * x).toFixed(0) + "%";
const one = ride();

if (has("pts")) {
  console.log(JSON.stringify(one.pts));
  process.exit(0);
}

if (has("link")) {
  // A level, not a puzzle: her start, the popper, the arc, and the plant parked
  // at the apex so PLAY has somewhere to go. Ctrl+V it onto the grid behind `\`
  // to feel the thing, or grade it with `verify.mjs --hash`.
  const lv = { ...ride({ goal: one.apex }).L, name: `_ momentum arc r${r} n${n}` };
  console.log(encodeLevel(lv));
  process.exit(0);
}

console.log(`MOMENTUM ARC — quarter-pipe at (${mx},${my}), r ${r}, ${n} lines, popper ${spd} at ${gap} u short of the mouth\n`);
console.log(`  popper fires her at        ${one.vPop.toFixed(1)} u/s   (max(arrival, spd × 0.82), capped at ${maxSpeed})`);
console.log(`  she reaches the mouth at   ${one.vMouth.toFixed(1)} u/s   (${(one.vPop - one.vMouth).toFixed(1)} eaten by ${gap} u of flat)`);
console.log(`  she leaves the lip at      ${Math.hypot(one.vLip.x, one.vLip.y).toFixed(1)} u/s   (${one.vLip.y.toFixed(1)} up, ${one.vLip.x.toFixed(1)} across)`);
console.log(`  RISE above her ride height ${one.rise.toFixed(1)} u    — ${pct(one.keep)} of the ${one.ceiling.toFixed(1)} u that launch was worth`);
console.log(`  the lip is at              (${one.pts[n][0]}, ${one.pts[n][1]}),  she tops out at (${one.apex[0]}, ${one.apex[1]})`);

const svg = opt("svg", null);
if (svg) {
  // The piece as a sheet: the run-in floor and the arc as `t` Lines, the popper
  // as its true 8.2 u trigger ring, and the rise it buys drawn to scale so the
  // picture argues its own case. Everything that is not terrain or the popper
  // lives in a `_` group, which the readers ignore. The game reads this file
  // directly; Figma does not (see the note at the top).
  const d = newDoc();
  const runIn = gap + 26;
  const left = mx - runIn - 6, top = one.apex[1] - 8;
  const W = Math.round((mx + r + 36 - left) * S), H = Math.round((my + 8 - top) * S);
  const ox = -left * S, oy = -top * S;          // px of world (0,0)
  const at = (x, y) => [ox + x * S, oy + y * S];
  d.rect("_bg", 0, 0, W, H, { id: "_bg", fill: BG });

  d.poly(ox, oy, [[mx - runIn, my], [mx, my]]);
  d.poly(ox, oy, one.pts);
  d.popper(...at(mx - gap, my - R), spd, 0);

  d.group("_rise", () => {
    const [lx, ly] = at(one.pts[n][0], one.pts[n][1]);
    d.rawline(lx, ly, ...at(one.apex[0], one.apex[1]), { stroke: PINK, sw: 2, dash: "9 9" });
    d.circle(...at(one.apex[0], one.apex[1]), R * S, { stroke: PINK, sw: 2 });
    d.rawline(...at(left + 3, my - R), ...at(mx + r + 32, my - R), { stroke: GUIDE, sw: 1, dash: "4 8" });
  });
  const [tx, ty] = at(one.pts[n][0] + 2, one.apex[1] + 4);
  d.label(tx, ty, `${one.rise.toFixed(0)} u of rise`, { size: 13, fill: PINK });
  d.label(tx, ty + 18, `off the lip at ${Math.hypot(one.vLip.x, one.vLip.y).toFixed(0)} u/s,`, { size: 11, fill: PINK });
  d.label(tx, ty + 34, `${one.vLip.x.toFixed(1)} of it sideways`, { size: 11, fill: PINK });
  d.label(20, 26, `momentum arc · r ${r} · ${n} lines · popper ${spd} on her ride line, ${gap} u short of the mouth`, { size: 14 });
  d.label(20, 46, `${pct(one.keep)} of the ${one.ceiling.toFixed(0)} u that launch was worth. The LINES are the lever, not the radius:`, { size: 11, fill: GUIDE });
  d.label(20, 62, `${n} of them keeps ${pct(one.keep)}, ${Math.round(n / 2)} keeps ${pct(ride({ chords: Math.round(n / 2) }).keep)}, and a plain 45° ramp keeps ${pct(ride({ chords: 2 }).keep)}.`, { size: 11, fill: GUIDE });
  d.label(20, 78, `Every 10 u of flat between popper and mouth costs about a unit of it.`, { size: 11, fill: GUIDE });

  await writeFile(svg, d.render(W, H, "Goomba Glider momentum arc — tools/goomba/pipe.mjs"));
  console.log(`\nwrote ${svg}  ${W}×${H}px  (${S}px = 1 unit)`);
  console.log(`  the game reads this file directly (drop it on the grid). Through FIGMA it cannot:`);
  console.log(`  an SVG import makes VECTOR nodes, never Lines, and both readers skip those on purpose.`);
  console.log(`  For a Figma frame use the Plugin API (figma.createLine); for the game use --link.`);
}

if (argv.length && !has("table")) process.exit(0);

console.log(`\nHOW MANY LINES (r ${r}, popper ${spd}) — the corners are where the height goes.`);
console.log(`Chords want to be about one substep long (${(one.vMouth / 240).toFixed(2)} u at this speed), so n ≈ ${Math.round((Math.PI / 2 * r) / (one.vMouth / 240))} here:`);
console.log("     lines  turn each   rise    keep");
for (const c of [2, 4, 6, 8, 12, 16, 20, 24, 32, 48]) {
  const o = ride({ chords: c });
  console.log(`  ${String(c).padStart(8)} ${(90 / c).toFixed(1).padStart(8)}° ${o.rise.toFixed(1).padStart(7)} ${pct(o.keep).padStart(7)}`);
}

console.log(`\nHOW BIG (${n} lines, popper ${spd}) — barely matters until it gets lazy:`);
console.log("         r   footprint   rise    keep");
for (const rr of [3.2, 5, 8, 12, 18, 26, 40]) {
  const o = ride({ rad: rr });
  console.log(`  ${rr.toFixed(1).padStart(8)} ${(rr + "×" + rr + " u").padStart(11)} ${o.rise.toFixed(1).padStart(7)} ${pct(o.keep).padStart(7)}`);
}

console.log(`\nHOW FAR THE POPPER SITS FROM THE MOUTH — the flat is the most expensive part:`);
console.log("       gap   at the mouth    rise    keep");
for (const g of [6, 12, 20, 30, 45, 65]) {
  const o = ride({ lead: g });
  console.log(`  ${String(g).padStart(8)} ${(o.vMouth.toFixed(1) + " u/s").padStart(14)} ${o.rise.toFixed(1).padStart(7)} ${pct(o.keep).padStart(7)}`);
}

console.log(`\nWHAT A POPPER SPEED BUYS (r ${r}, ${n} lines, gap ${gap}):`);
console.log("       spd    launch   ceiling    rise");
for (const s of [76, 90, 110, 130, 150, 180]) {
  const o = ride({ speed: s });
  console.log(`  ${String(s).padStart(8)} ${(o.vPop.toFixed(1) + " u/s").padStart(9)} ${o.ceiling.toFixed(1).padStart(9)} ${o.rise.toFixed(1).padStart(7)}`);
}
console.log(`  (${maxSpeed} u/s is the cap — a frame named "L: … @200" raises it)`);
