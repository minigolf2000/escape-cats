// HOW BIG IS THE EXIT? She has to leave a loop that holds her at ~119 u/s and
// thread two 9.3-wide holes 13 units apart, both centred on x 64.8. This counts
// how many single-band placements manage it, from each loop, and how wide the
// window is — "it's hard" is a number, and the number says which fix to reach for.
import { makeRun, stepRun, snapBand, SUB, RUN_MAX, initLevel } from "./draft/_sim.mjs";
import { P, buildLevel } from "./draft/in-and-out.mjs";
const over = {};
for (const a of process.argv.slice(2)) {
  const [k, v] = a.split("=");
  if (k in P) over[k] = v !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
}
const L = initLevel(buildLevel({ ...P, ...over }));
const GS = (over.gapS ?? P.gapS) ?? P.gap;

const tryBand = (from, band) => {
  const b = band && snapBand(L, { ax: band[0][0], ay: band[0][1], bx: band[1][0], by: band[1][1] });
  const st = makeRun(L, b ? [b] : []);
  st.p.x = from[0]; st.p.y = from[1]; st.v.x = from[2]; st.v.y = from[3];
  st.snap = { x: st.p.x, y: st.p.y, t: 0 };
  let belowInner = false, belowOuter = false;
  while (!st.result && st.t < RUN_MAX + 1) {
    stepRun(st, SUB);
    if (st.p.y > P.cy + Math.sqrt(P.rIn ** 2 - GS ** 2)) belowInner = true;
    if (st.p.y > P.cy + Math.sqrt(P.rOut ** 2 - GS ** 2)) belowOuter = true;
  }
  return { r: st.result, belowInner, belowOuter, x: st.p.x, y: st.p.y };
};

for (const [name, from] of [["conveyor (annulus)", [64.8, 25.7, -110, 0]],
                            ["carousel (wall)", [64.8, 41.7, 90, 0]]]) {
  let tried = 0, outInner = 0, outBoth = 0;
  const wins = [];
  // One band, swept over the whole board on a coarse grid, every orientation.
  for (let cx = 20; cx <= 110; cx += 6)
    for (let cy = 20; cy <= 125; cy += 6)
      for (let a = 0; a < 180; a += 30)
        for (const len of [20, 40]) {
          const dx = Math.cos((a * Math.PI) / 180) * len / 2, dy = Math.sin((a * Math.PI) / 180) * len / 2;
          const res = tryBand(from, [[cx - dx, cy - dy], [cx + dx, cy + dy]]);
          tried++;
          if (res.belowInner) outInner++;
          if (res.belowOuter) { outBoth++; wins.push([cx, cy, a, len]); }
        }
  console.log(`${name}: ${tried} single-band placements   [gapS ${GS}]`);
  console.log(`   past the INNER south door: ${outInner}  (${(100*outInner/tried).toFixed(1)}%)`);
  console.log(`   past the OUTER south door: ${outBoth}  (${(100*outBoth/tried).toFixed(1)}%)`);
  if (wins.length) {
    const xs = wins.map(w => w[0]), ys = wins.map(w => w[1]);
    console.log(`   those bands cluster at x ${Math.min(...xs)}..${Math.max(...xs)}, y ${Math.min(...ys)}..${Math.max(...ys)}`);
  }
  console.log(`   bare (no band): ${JSON.stringify(tryBand(from, null))}`);
}
