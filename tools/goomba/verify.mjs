// THE GATE: one command, one PASS/FAIL verdict on whether a level honors the
// party rule. A level ships only when this prints PASS.
//
//   node verify.mjs <levelIdx>          full gate on one level (stops at the
//                                       first failure — it is a gate, not a
//                                       report)
//   node verify.mjs <levelIdx> --quick  smaller samples while iterating; run
//                                       the full gate before shipping
//   node verify.mjs all                 one-line verdict per level + summary
//
// What it checks, in order (cheap first):
//   1. bare run fails, and fails legibly
//   2. the solution is exactly 4 bands (the locked party rule), every band a
//      legal length, and it wins inside the run cap
//   3. every solution band is load-bearing (drop-one fails)
//   4. ±3-unit finger slop still mostly wins (players aren't surgeons)
//   5. no 0/1-band win exists (exhaustive on a 10-unit grid)
//   6. no 2/3-band win found (random sampling, deterministic seed)
//   7. no ≤3-band win found by beam search — the hunter that has caught
//      every exploit random sampling missed (launcher bands, under-floor
//      falls), so do not skip it because 5 and 6 came back clean
import { LEVELS, BAND_MAX, MAX_BANDS, simulate } from "./lib.mjs";

const JITTER_MIN_WINS = 18; // of 30 trials — below this, real fingers suffer

const arg = process.argv[2];
const quick = process.argv.includes("--quick");
if (arg === undefined) {
  console.error("usage: node verify.mjs <levelIdx>|all [--quick]");
  process.exit(2);
}

const mulberry = (seed) => () =>
  (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

/** Every legal single band on a 10-unit grid over the level bounds. */
function legalBands(L) {
  const b = L.bounds, pts = [];
  for (let x = b.x0; x <= b.x1; x += 10)
    for (let y = b.y0; y <= b.y1; y += 10) pts.push([x, y]);
  const legal = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const len = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
      if (len >= 6 && len <= BAND_MAX) legal.push([pts[i], pts[j]]);
    }
  return legal;
}

/** Beam-search hunt for a win within `budget` bands — solve.mjs's search,
 * verdict-only. Returns the winning set or null. */
function beamHunt(li, budget, K) {
  const L = LEVELS[li], b = L.bounds;
  const rnd = mulberry(8675309);
  const randBand = (traj) => {
    for (let tries = 0; tries < 40; tries++) {
      let cx, cy;
      const roll = rnd();
      if (roll < 0.6 && traj && traj.length) {
        const p = traj[(rnd() * traj.length) | 0];
        cx = p[0] + (rnd() * 2 - 1) * 16; cy = p[1] + (rnd() * 2 - 1) * 16;
      } else if (roll < 0.85 && L.plants.length) {
        const m = L.plants[(rnd() * L.plants.length) | 0];
        cx = m[0] + (rnd() * 2 - 1) * 26; cy = m[1] + (rnd() * 2 - 1) * 26;
      } else {
        cx = b.x0 + rnd() * (b.x1 - b.x0); cy = b.y0 + rnd() * (b.y1 - b.y0);
      }
      const ang = rnd() * 6.283, len = 8 + rnd() * (BAND_MAX - 10);
      const ax = cx - Math.cos(ang) * len / 2, ay = cy - Math.sin(ang) * len / 2;
      const bx = cx + Math.cos(ang) * len / 2, by = cy + Math.sin(ang) * len / 2;
      if (Math.min(ax, bx) < b.x0 - 6 || Math.max(ax, bx) > b.x1 + 6 ||
          Math.min(ay, by) < b.y0 - 6 || Math.max(ay, by) > b.y1 + 6) continue;
      return [[+ax.toFixed(1), +ay.toFixed(1)], [+bx.toFixed(1), +by.toFixed(1)]];
    }
    return null;
  };
  const score = (set) => {
    const r = simulate(li, set);
    let best = 1e9, plants = 0;
    const got = L.plants.map(() => false);
    for (const p of r.traj) {
      const d = Math.hypot(p[0] - L.goal[0], p[1] - L.goal[1]);
      if (d < best) best = d;
      L.plants.forEach((m, i) => {
        if (!got[i] && Math.hypot(p[0] - m[0], p[1] - m[1]) < 8) { got[i] = true; plants++; }
      });
    }
    return { s: (r.result === "win" ? 1e6 : 0) + plants * 1000 - best, r: r.result, plants,
             near: best, traj: r.traj };
  };
  let beam = [{ set: [], ...score([]) }];
  for (let stage = 1; stage <= budget; stage++) {
    const cands = [];
    for (const entry of beam) {
      for (let k = 0; k < Math.ceil(K / beam.length); k++) {
        const nb = randBand(entry.traj);
        if (!nb) continue;
        const set = entry.set.concat([nb]);
        const sc = score(set);
        if (sc.s > entry.s - 40) cands.push({ set, ...sc });
      }
    }
    cands.sort((p, q) => q.s - p.s);
    const uniq = [], seen = new Map();
    for (const c of cands) {
      const key = c.plants + ":" + Math.round(c.near / 12);
      if ((seen.get(key) || 0) >= 2) continue;
      seen.set(key, (seen.get(key) || 0) + 1);
      uniq.push(c);
      if (uniq.length >= 10) break;
    }
    if (!uniq.length) break;
    beam = uniq;
    if (beam[0].r === "win") return beam[0].set;
  }
  return null;
}

/** Run the gate. Returns a list of check results; stops at the first failure
 * unless `all` (the summary table wants the first failure per level anyway). */
function verify(li) {
  const L = LEVELS[li];
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    return ok;
  };

  // 1. bare
  const bare = simulate(li, []);
  if (!check("bare run fails", bare.result !== "win", `${bare.result}@${bare.t}s`)) return checks;

  // 2. solution shape + win
  const sol = L.solution ?? [];
  const lens = sol.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
  if (!check(`solution is ${MAX_BANDS} bands (party rule)`, sol.length === MAX_BANDS,
             `${sol.length} band(s)`)) return checks;
  if (!check("solution band lengths legal", lens.every((l) => l >= 6 && l <= BAND_MAX),
             lens.map((l) => l.toFixed(1)).join(","))) return checks;
  const win = simulate(li, sol);
  if (!check("solution wins", win.result === "win", `${win.result}@${win.t}s`)) return checks;

  // 3. every band load-bearing
  const partials = sol.map((_, k) => simulate(li, sol.filter((_, j) => j !== k)).result);
  if (!check("every band load-bearing", partials.every((p) => p !== "win"),
             `drop-one → [${partials.join(", ")}]`)) return checks;

  // 4. finger slop
  const rnd = mulberry(12345);
  let jwins = 0;
  for (let t = 0; t < 30; t++) {
    const jit = sol.map(([a, b]) => [
      [a[0] + (rnd() * 2 - 1) * 3, a[1] + (rnd() * 2 - 1) * 3],
      [b[0] + (rnd() * 2 - 1) * 3, b[1] + (rnd() * 2 - 1) * 3],
    ]);
    if (simulate(li, jit).result === "win") jwins++;
  }
  if (!check(`jitter ±3u wins ≥ ${JITTER_MIN_WINS}/30`, jwins >= JITTER_MIN_WINS, `${jwins}/30`))
    return checks;

  // 5. exhaustive 0/1-band
  const legal = legalBands(L);
  let oneBandWin = null;
  for (const bd of legal)
    if (simulate(li, [bd]).result === "win") { oneBandWin = bd; break; }
  if (!check(`no 1-band win (exhaustive, ${legal.length} placements)`, !oneBandWin,
             oneBandWin ? `e.g. ${JSON.stringify(oneBandWin)}` : "")) return checks;

  // 6. random 2/3-band samples
  const rnd2 = mulberry(20260728);
  const pick = () => legal[(rnd2() * legal.length) | 0];
  for (const k of [2, 3]) {
    const N = quick ? (k === 2 ? 8000 : 5000) : (k === 2 ? 30000 : 20000);
    let hit = null;
    for (let t = 0; t < N && !hit; t++) {
      const set = []; for (let m = 0; m < k; m++) set.push(pick());
      if (simulate(li, set).result === "win") hit = set;
    }
    if (!check(`no ${k}-band win (${N} random samples)`, !hit,
               hit ? `e.g. ${JSON.stringify(hit)}` : "")) return checks;
  }

  // 7. beam-search hunt at ≤3 bands
  const K = quick ? 3000 : 8000;
  const hunted = beamHunt(li, 3, K);
  check(`no ≤3-band win (beam search, ${K}/stage)`, !hunted,
        hunted ? `FOUND: ${JSON.stringify(hunted)}` : "");
  return checks;
}

const idxs = arg === "all" ? LEVELS.map((_, i) => i) : [Number(arg)];
let allOk = true;
for (const li of idxs) {
  if (!(li >= 0 && li < LEVELS.length)) {
    console.error(`no level at index ${arg} (0..${LEVELS.length - 1})`);
    process.exit(2);
  }
  console.log(`L${li + 1} ${LEVELS[li].name}${quick ? "  (--quick: smaller samples)" : ""}`);
  const checks = verify(li);
  const ok = checks.every((c) => c.ok);
  allOk &&= ok;
  console.log(`  → ${ok ? "PASS ✓" : `FAIL ✗ (${checks.find((c) => !c.ok).name})`}\n`);
}
if (arg === "all")
  console.log(allOk ? "ALL LEVELS PASS THE PARTY GATE"
                    : "Some levels fail the gate — levels predating the party rule are known debt (see README.md).");
process.exit(allOk ? 0 : 1);
