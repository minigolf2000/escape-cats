// What ACTUALLY happened, as a route: the ordered chain of poppers, cans and
// band hits a run made, with times and positions. `trace.mjs` prints raw 30fps
// coordinates, which is the right tool for placing a ledge against her arc and
// the wrong one for the question a popper level asks — "did she ride lane 3, or
// fall past it into lane 4?". A route reads that off in one line.
//
// It answers three questions the level-comment in levels.ts has to state, and
// answers them in ONE process (bundling the sim costs ~2s, so batching matters
// more than it looks):
//
//   node route.mjs <idx>                    the bare run — must fail, legibly
//   node route.mjs <idx> sol                the shipped solution's ride
//   node route.mjs <idx> drop               solution, then minus each band in
//                                           turn — this is the "four deaths"
//                                           line every level comment carries
//   node route.mjs <idx> '<bands>' '<...>'  candidates, compared side by side
//   node route.mjs --hash <link> [...]      same, on a level that is still a
//                                           share link from the editor
import { LEVELS, makeRun, stepRun, snapBand, SUB, RUN_MAX, decodeLevel, initLevel } from "./lib.mjs";

const argv = process.argv.slice(2);
let hash, target;
const sets = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--hash") hash = argv[++i];
  else if (target === undefined && !hash) target = a;
  else sets.push(a);
}
let L;
if (hash !== undefined) {
  const dec = decodeLevel(hash);
  if (!dec) { console.error("--hash: not a level link"); process.exit(2); }
  L = initLevel(dec);
  if (target !== undefined) sets.unshift(target);
} else {
  const li = Number(target ?? 0);
  if (!(li >= 0 && li < LEVELS.length)) {
    console.error(`no level at index ${target} (0..${LEVELS.length - 1})`);
    process.exit(2);
  }
  L = LEVELS[li];
}
const sol = L.solution ?? [];

/** One run, narrated: every popper fire (by index, so a lane is identifiable),
 * every can, every band she actually touched. */
function route(pairs, ids) {
  const bandId = (i) => (ids ? ids[i] : i);
  const bands = pairs.map(([a, b]) => snapBand(L, { ax: a[0], ay: a[1], bx: b[0], by: b[1] }));
  const st = makeRun(L, bands);
  const chain = [];
  const pop = st.popT.slice(), got = st.got.slice(), hit = st.bandHits.slice(),
    cush = st.cushHits.slice(), bump = st.bumpT.slice();
  const at = () => `@${st.t.toFixed(2)}`;
  while (!st.result && st.t < RUN_MAX + 1) {
    stepRun(st, SUB);
    st.popT.forEach((v, i) => { if (v !== pop[i]) { pop[i] = v; chain.push(`pop${i}(${L.pops[i].x},${L.pops[i].y})${at()}`); } });
    st.got.forEach((v, i) => { if (v !== got[i]) { got[i] = v; chain.push(`CAN${i}${at()}`); } });
    st.bandHits.forEach((v, i) => { if (v !== hit[i]) { hit[i] = v; chain.push(`band${bandId(i)}(${st.p.x.toFixed(0)},${st.p.y.toFixed(0)})${at()}`); } });
    st.cushHits.forEach((v, i) => { if (v !== cush[i]) { cush[i] = v; chain.push(`cush${i}${at()}`); } });
    st.bumpT.forEach((v, i) => { if (v !== bump[i]) { bump[i] = v; chain.push(`bump${i}${at()}`); } });
  }
  return { result: st.result ?? "timeout", t: st.t, cans: `${st.gotN}/${L.cans.length}`,
           end: [st.p.x, st.p.y], chain };
}

function show(label, pairs, ids) {
  const r = route(pairs, ids);
  console.log(`  ${r.result.padEnd(7)} @${r.t.toFixed(2)}s cans=${r.cans} ` +
              `end=(${r.end[0].toFixed(0)},${r.end[1].toFixed(0)})  ${label}`);
  // wrap the chain so a 12-popper ride stays readable in a terminal
  let line = "   ";
  for (const ev of r.chain) {
    if (line.length + ev.length > 96) { console.log(line); line = "   "; }
    line += " " + ev;
  }
  if (line.trim()) console.log(line);
}

console.log(`${L.name}  start=${JSON.stringify(L.start)} goal=${JSON.stringify(L.goal)} ` +
            `cans=${L.cans.length} pops=${L.pops.length}`);
if (!sets.length) show("bare (no bands)", []);
for (const s of sets) {
  if (s === "sol") show(`solution (${sol.length} bands)`, sol);
  else if (s === "bare") show("bare (no bands)", []);
  else if (s === "drop") {
    show(`solution (${sol.length} bands)`, sol);
    // drop-one keeps the ORIGINAL band numbers in the narration, so "band2 was
    // the only thing she touched" means the band the solution calls band2.
    sol.forEach((_, k) => show(`solution WITHOUT band${k}`,
      sol.filter((_, j) => j !== k), sol.map((_, j) => j).filter((j) => j !== k)));
  } else show(s, JSON.parse(s));
}
