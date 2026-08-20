// FORGIVENESS, per band: which of the four bands is the one a real finger will
// lose the run on, and how much room does it actually have?
//
// `verify.mjs` prints one number for finger slop ("jitter ±3u 19/30") and stops.
// That number is the gate, but it is not a diagnosis: it never says WHICH band
// was fragile, which way it failed, or whether the band is sitting off-centre in
// its own win window. Every hour of tuning in this folder has gone into that
// question, so it gets a tool.
//
//   node slack.mjs <idx> [trials]     the shipped solution, band by band
//   node slack.mjs <idx> --set '<bands JSON>'   a candidate set instead
//   node slack.mjs --hash <link> [trials]      a level that is still a link
//
// Per band it reports three different kinds of room:
//   jitter   — that band alone nudged ±3u at both ends (the others exact), so a
//              weak stage cannot hide behind three strong ones
//   slide    — the band moved bodily along its own perpendicular, 1 unit at a
//              time: the win window, and where in that window it is parked.
//              Off-centre by more than a unit or two is free robustness left on
//              the table (works for tilted bands, which `scan.mjs` cannot sweep)
//   stretch  — the band scaled about its centre: the lengths that still win.
//              Longer is usually better and rarely obvious — ±3u on the ends of
//              a 26-unit wall tilts it 13°, which turns a rebound by 26°; the
//              same slop on a 50-unit wall barely moves it
//
// It closes with the whole solution jittered on the gate's own seed AND on three
// unrelated ones, because 30 trials is a noisy verdict: a level whose true rate
// is 50% still scrapes an 18/30 pass often enough to fool you. Ship on the true
// rate, not on the lucky one.
import { LEVELS, BAND_MAX, BAND_MIN, simulateLevel, mulberry, jitterSolution,
         JITTER_TRIALS, JITTER_MIN_WINS, JITTER_SEED, decodeLevel, initLevel } from "./lib.mjs";

const argv = process.argv.slice(2);
let hash, setArg, target, trials;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--hash") hash = argv[++i];
  else if (a === "--set") setArg = argv[++i];
  else if (target === undefined && hash === undefined) target = a;
  else if (trials === undefined) trials = Number(a);
}
let L;
if (hash !== undefined) {
  const dec = decodeLevel(hash);
  if (!dec) { console.error("--hash: not a level link"); process.exit(2); }
  L = initLevel(dec);
} else {
  const li = Number(target ?? 0);
  if (!(li >= 0 && li < LEVELS.length)) {
    console.error(`no level at index ${target} (0..${LEVELS.length - 1})`);
    process.exit(2);
  }
  L = LEVELS[li];
}
const N = trials || 200;
const sol = setArg ? JSON.parse(setArg) : L.solution ?? [];
if (!sol.length) { console.error("no solution to measure (pass --set '<bands>')"); process.exit(2); }

const run = (set) => simulateLevel(L, set).result;
const swap = (i, band) => sol.map((b, j) => (j === i ? band : b));
const J = 3;

/** One band jittered ±3u at both ends, the rest of the solution exact. */
function jitterOne(i) {
  const rnd = mulberry(JITTER_SEED);
  let wins = 0;
  const modes = {};
  for (let t = 0; t < N; t++) {
    const jb = jitterSolution([sol[i]], rnd)[0];
    const r = run(swap(i, jb));
    modes[r] = (modes[r] || 0) + 1;
    if (r === "win") wins++;
  }
  delete modes.win;
  return { wins, modes };
}

/** The band slid bodily along its own perpendicular — the window, and where in
 * it the band is parked. */
function slide(i) {
  const [[ax, ay], [bx, by]] = sol[i];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = -(by - ay) / len, ny = (bx - ax) / len;
  const ok = (d) => run(swap(i, [[ax + nx * d, ay + ny * d], [bx + nx * d, by + ny * d]])) === "win";
  if (!ok(0)) return null;
  let lo = 0, hi = 0;
  while (lo > -30 && ok(lo - 1)) lo--;
  while (hi < 30 && ok(hi + 1)) hi++;
  return { lo, hi, len };
}

/** The band scaled about its centre — which lengths still win. */
function stretch(i) {
  const [[ax, ay], [bx, by]] = sol[i];
  const cx = (ax + bx) / 2, cy = (ay + by) / 2;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len, uy = (by - ay) / len;
  const at = (l) => run(swap(i, [[cx - ux * l / 2, cy - uy * l / 2], [cx + ux * l / 2, cy + uy * l / 2]]));
  const wins = [];
  for (let l = BAND_MIN; l <= BAND_MAX; l += 2) if (at(l) === "win") wins.push(l);
  return wins;
}

console.log(`${L.name}  solution ${sol.length} band(s), ${N} jitter trials each`);
const base = run(sol);
if (base !== "win") console.log(`  !! the set does not win (${base}) — the numbers below mean nothing`);
const scores = [];
for (let i = 0; i < sol.length; i++) {
  const len = Math.hypot(sol[i][1][0] - sol[i][0][0], sol[i][1][1] - sol[i][0][1]);
  const { wins, modes } = jitterOne(i);
  const sl = slide(i);
  const st = stretch(i);
  const band = `band${i} ${JSON.stringify(sol[i])} len=${len.toFixed(1)}`;
  const pct = ((100 * wins) / N).toFixed(0);
  const fails = Object.entries(modes).map(([k, v]) => `${k}×${v}`).join(" ") || "none";
  console.log(`  ${band}`);
  console.log(`    jitter  ${wins}/${N} (${pct}%)  fails: ${fails}`);
  console.log(sl
    ? `    slide   win from ${sl.lo} to +${sl.hi} units off its line` +
      `  (${sl.lo === -30 || sl.hi === 30 ? "wider than swept" : `${sl.hi - sl.lo} wide`}` +
      `, parked ${Math.abs(sl.lo + sl.hi) <= 1 ? "centred" : (sl.lo + sl.hi > 0 ? `${((sl.lo + sl.hi) / 2).toFixed(1)} short of centre` : `${(-(sl.lo + sl.hi) / 2).toFixed(1)} past centre`)})`
    : "    slide   n/a — the band does not win where it is");
  console.log(st.length
    ? `    stretch wins at length ${st[0]}..${st[st.length - 1]}` +
      `${st.length !== (st[st.length - 1] - st[0]) / 2 + 1 ? " (with gaps)" : ""}`
    : "    stretch no length wins");
  scores.push({ i, wins });
}
const weak = scores.reduce((a, b) => (b.wins < a.wins ? b : a));
console.log(`  weakest: band${weak.i} at ${((100 * weak.wins) / N).toFixed(0)}%`);

// The whole solution jittered: the gate's verdict, then the truth.
const gate = (() => { const rnd = mulberry(JITTER_SEED); let w = 0;
  for (let t = 0; t < JITTER_TRIALS; t++) if (run(jitterSolution(sol, rnd)) === "win") w++; return w; })();
const seeds = [777, 31337, 4242];
const rates = seeds.map((s) => { const rnd = mulberry(s); let w = 0;
  for (let t = 0; t < N; t++) if (run(jitterSolution(sol, rnd)) === "win") w++; return w; });
console.log(`  ALL bands jittered — gate (seed ${JITTER_SEED}, ${JITTER_TRIALS} trials): ${gate}/${JITTER_TRIALS}` +
            ` ${gate >= JITTER_MIN_WINS ? "pass" : "FAIL"} (needs ${JITTER_MIN_WINS})`);
console.log(`    true rate on other seeds: ` +
            seeds.map((s, k) => `${s}:${((100 * rates[k]) / N).toFixed(0)}%`).join("  "));
const avg = rates.reduce((a, b) => a + b, 0) / (rates.length * N);
if (gate >= JITTER_MIN_WINS && avg < 0.7)
  console.log(`    ^ SCRAPED PAST: the gate passed on one lucky seed while the true rate is ${(100 * avg).toFixed(0)}%.` +
              ` Fix a band before shipping.`);
