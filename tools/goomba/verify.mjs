// THE GATE: one command, one PASS/FAIL verdict on whether a level honors the
// party rule. A level ships only when this prints PASS.
//
//   node verify.mjs <levelIdx>          full gate on one level (stops at the
//                                       first failure — it is a gate, not a
//                                       report)
//   node verify.mjs <levelIdx> --quick  smaller samples while iterating; run
//                                       the full gate before shipping
//   node verify.mjs all                 one-line verdict per level + summary
//   node verify.mjs --hash <link>       gate a level that is still just a
//                                       share link from the editor (paste the
//                                       whole URL or only the part after #)
//   node verify.mjs --file <path>       same, for a file of links, one per
//                                       line — the batch a jam produces
//
// The two link forms exist because the editor (apps/goomba-editor) saves a
// design INTO its URL, so a level can be finished and shared long before
// anyone opens levels.ts. The editor hunts shortcuts in the background, but it
// samples; this is still the gate, and a level ships only when this prints
// PASS.
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
//
// When check 4 (finger slop) is what fails — the usual verdict on a level whose
// geometry is otherwise honest — `slack.mjs` is the follow-up: it says WHICH
// band is fragile, how far off-centre it is parked, and what lengths still win.
// It is also worth running when check 4 barely passes; 30 trials on one seed is
// a noisy verdict, and this gate says so when a level scrapes through.
import {
  LEVELS, BAND_MAX, BAND_MIN, MAX_BANDS, simulateLevel, decodeLevel, initLevel,
  legalBands, mulberry, jitterSolution, JITTER_TRIALS, JITTER_MIN_WINS, JITTER_SEED,
} from "./lib.mjs";
import { readFileSync } from "node:fs";


const argv = process.argv.slice(2);
let quick = false, hashArg, fileArg, arg;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--quick") quick = true;
  else if (a === "--hash") hashArg = argv[++i];
  else if (a === "--file") fileArg = argv[++i];
  else if (arg === undefined) arg = a;
}
if (arg === undefined && hashArg === undefined && fileArg === undefined) {
  console.error("usage: node verify.mjs <levelIdx>|all [--quick]");
  console.error("       node verify.mjs --hash <share link> [--quick]");
  console.error("       node verify.mjs --file <file of links> [--quick]");
  process.exit(2);
}

/**
 * A level that only exists as an editor share link, made runnable: decoded
 * and initLevel'ed into the same shape a LEVELS entry has. Never pushed into
 * LEVELS — the gate runs on level OBJECTS (`simulateLevel`), so a link-borne
 * candidate needs no index. That is the point: a jam produces links, and
 * links face the same gate as a diff does.
 */
function adoptLink(link, label) {
  const L = decodeLevel(link);
  if (!L) {
    console.error(`${label}: not a level link (expected the part after # of an editor share URL)`);
    process.exit(2);
  }
  return initLevel(L);
}

/** Beam-search hunt for a win within `budget` bands — solve.mjs's search,
 * verdict-only. Returns the winning set or null. */
function beamHunt(L, budget, K) {
  const b = L.bounds;
  const rnd = mulberry(8675309);
  const randBand = (traj) => {
    for (let tries = 0; tries < 40; tries++) {
      let cx, cy;
      const roll = rnd();
      if (roll < 0.6 && traj && traj.length) {
        const p = traj[(rnd() * traj.length) | 0];
        cx = p[0] + (rnd() * 2 - 1) * 16; cy = p[1] + (rnd() * 2 - 1) * 16;
      } else if (roll < 0.85 && L.cans.length) {
        const m = L.cans[(rnd() * L.cans.length) | 0];
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
    const r = simulateLevel(L, set);
    let best = 1e9, cans = 0;
    const got = L.cans.map(() => false);
    for (const p of r.traj) {
      const d = Math.hypot(p[0] - L.goal[0], p[1] - L.goal[1]);
      if (d < best) best = d;
      L.cans.forEach((m, i) => {
        if (!got[i] && Math.hypot(p[0] - m[0], p[1] - m[1]) < 8) { got[i] = true; cans++; }
      });
    }
    return { s: (r.result === "win" ? 1e6 : 0) + cans * 1000 - best, r: r.result, cans,
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
      const key = c.cans + ":" + Math.round(c.near / 12);
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

/** Run the gate on one level. Returns a list of check results; stops at the
 * first failure (the summary table wants the first failure per level anyway).
 * `hint` is how this level is addressed on the command line, so the advice a
 * failure prints can be pasted straight back into a shell. */
function verify(L, hint) {
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    return ok;
  };

  // 1. bare
  const bare = simulateLevel(L, []);
  if (!check("bare run fails", bare.result !== "win", `${bare.result}@${bare.t}s`)) return checks;

  // 2. solution shape + win
  const sol = L.solution ?? [];
  const lens = sol.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
  if (!check(`solution is ${MAX_BANDS} bands (party rule)`, sol.length === MAX_BANDS,
             `${sol.length} band(s)`)) return checks;
  if (!check("solution band lengths legal", lens.every((l) => l >= BAND_MIN && l <= BAND_MAX),
             lens.map((l) => l.toFixed(1)).join(","))) return checks;
  const win = simulateLevel(L, sol);
  if (!check("solution wins", win.result === "win", `${win.result}@${win.t}s`)) return checks;

  // 3. every band load-bearing
  const partials = sol.map((_, k) => simulateLevel(L, sol.filter((_, j) => j !== k)).result);
  if (!check("every band load-bearing", partials.every((p) => p !== "win"),
             `drop-one → [${partials.join(", ")}]`)) return checks;

  // 4. finger slop
  const rnd = mulberry(JITTER_SEED);
  let jwins = 0;
  for (let t = 0; t < JITTER_TRIALS; t++)
    if (simulateLevel(L, jitterSolution(sol, rnd)).result === "win") jwins++;
  if (!check(`jitter ±3u wins ≥ ${JITTER_MIN_WINS}/${JITTER_TRIALS}`,
             jwins >= JITTER_MIN_WINS, `${jwins}/${JITTER_TRIALS}`)) {
    console.log(`        which band, and how much room has it got? → node slack.mjs ${hint}`);
    return checks;
  }
  // A pass this close to the line is one seed's luck as much as the level's
  // doing: 30 trials cannot tell 60% from 85%, and only one of those ships.
  if (jwins < JITTER_MIN_WINS + 4)
    console.log(`        (that scraped past — confirm the true rate: node slack.mjs ${hint})`);

  // 5. exhaustive 0/1-band
  const legal = legalBands(L);
  let oneBandWin = null;
  for (const bd of legal)
    if (simulateLevel(L, [bd]).result === "win") { oneBandWin = bd; break; }
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
      if (simulateLevel(L, set).result === "win") hit = set;
    }
    if (!check(`no ${k}-band win (${N} random samples)`, !hit,
               hit ? `e.g. ${JSON.stringify(hit)}` : "")) return checks;
  }

  // 7. beam-search hunt at ≤3 bands
  const K = quick ? 3000 : 8000;
  const hunted = beamHunt(L, 3, K);
  check(`no ≤3-band win (beam search, ${K}/stage)`, !hunted,
        hunted ? `FOUND: ${JSON.stringify(hunted)}` : "");
  return checks;
}

/** [{ L, label }] — link-borne levels get a "link" label; only shipped ones
 * have an L-number a player would ever see. */
let targets;
if (hashArg !== undefined)
  targets = [{ L: adoptLink(hashArg, "--hash"), label: "link", hint: `--hash ${hashArg}` }];
else if (fileArg !== undefined) {
  // One link per line, blank lines and `//` comments skipped — so a team can
  // keep their day's levels in one file with a note beside each.
  const lines = readFileSync(fileArg, "utf8").split("\n")
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
  if (!lines.length) {
    console.error(`${fileArg}: no links in it`);
    process.exit(2);
  }
  targets = lines.map((l, i) => ({ L: adoptLink(l, `${fileArg}:${i + 1}`), label: "link",
                                   hint: `--hash ${l}` }));
} else {
  const idxs = arg === "all" ? LEVELS.map((_, i) => i) : [Number(arg)];
  for (const li of idxs)
    if (!(li >= 0 && li < LEVELS.length)) {
      console.error(`no level at index ${arg} (0..${LEVELS.length - 1})`);
      process.exit(2);
    }
  targets = idxs.map((li) => ({ L: LEVELS[li], label: `L${li + 1}`, hint: String(li) }));
}

let allOk = true;
for (const { L, label, hint } of targets) {
  console.log(`${label} ${L.name}${quick ? "  (--quick: smaller samples)" : ""}`);
  const checks = verify(L, hint);
  const ok = checks.every((c) => c.ok);
  allOk &&= ok;
  console.log(`  → ${ok ? "PASS ✓" : `FAIL ✗ (${checks.find((c) => !c.ok).name})`}\n`);
}
if (arg === "all")
  console.log(allOk ? "ALL LEVELS PASS THE PARTY GATE"
                    : "Some levels fail the gate — levels predating the party rule are known debt (see README.md).");
process.exit(allOk ? 0 : 1);
