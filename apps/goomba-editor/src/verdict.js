// The instant half of the gate: everything `verify.mjs` checks that costs
// tens of milliseconds rather than minutes, re-run on every edit.
//
// The split matters. Checks 1–4 here grade the solution the designer typed,
// which is cheap because there is only one of it. Checks 5–7 in verify.mjs ask
// whether some OTHER, smaller solution exists — a search over thousands of
// placements, and the only question a human genuinely cannot answer by looking.
// That one runs in the background (hunter.js) and, for real, on the bench.
//
// Every threshold comes from the shared gate module, so a row here is the
// same claim the bench makes — one copy, no "kept in step" comment to trust.
import {
  BAND_MAX,
  BAND_MIN,
  JITTER_MIN_WINS,
  JITTER_SEED,
  JITTER_TRIALS,
  MAX_BANDS,
  jitterSolution,
  mulberry,
} from "@escape-cats/shared";
import { bandLen, runResult } from "./sim.js";

/**
 * Grade a prepared level. Returns one row per check in the order verify.mjs
 * runs them, each `{ name, state, detail }` where state is "ok" | "fail" |
 * "skip" — "skip" for checks that cannot be asked yet (there is no point
 * grading a 2-band solution's robustness).
 */
export function verdicts(init) {
  const sol = init.solution ?? [];
  const rows = [];
  const row = (name, state, detail) => rows.push({ name, state, detail });

  // 1. Bare. A level that wins with no bands is not a level.
  const bare = runResult(init, []);
  row("bare run fails", bare.result === "win" ? "fail" : "ok", `${bare.result} @ ${bare.t}s`);

  // 2. The party rule's shape, then whether it actually wins.
  const shaped = sol.length === MAX_BANDS;
  row(`solution is ${MAX_BANDS} bands`, shaped ? "ok" : "fail", `${sol.length} placed`);
  const lens = sol.map(bandLen);
  const legal = lens.every((l) => l >= BAND_MIN && l <= BAND_MAX);
  row(
    "band lengths legal",
    !sol.length ? "skip" : legal ? "ok" : "fail",
    lens.map((l) => l.toFixed(1)).join(" · ") || "—",
  );

  const win = sol.length ? runResult(init, sol) : null;
  row(
    "solution wins",
    !sol.length ? "skip" : win.result === "win" ? "ok" : "fail",
    win ? `${win.result} @ ${win.t}s · cans ${win.cans}/${init.cans.length}` : "—",
  );

  const solved = shaped && legal && win?.result === "win";

  // 3. Load-bearing. Drop each band in turn: if the level still wins, that
  //    band was decoration, and decoration is how a 4-band level turns out to
  //    have been a 3-band level all along.
  const partials = solved ? sol.map((_, k) => runResult(init, sol.filter((_, j) => j !== k)).result) : [];
  row(
    "every band load-bearing",
    !solved ? "skip" : partials.every((p) => p !== "win") ? "ok" : "fail",
    partials.length ? `drop-one → ${partials.join(", ")}` : "—",
  );

  // 4. Finger slop. Players place bands with a thumb on glass, not with the
  //    coordinates the designer typed.
  let jwins = 0;
  if (solved) {
    const rnd = mulberry(JITTER_SEED);
    for (let t = 0; t < JITTER_TRIALS; t++)
      if (runResult(init, jitterSolution(sol, rnd)).result === "win") jwins++;
  }
  row(
    `±3u finger slop ≥ ${JITTER_MIN_WINS}/${JITTER_TRIALS}`,
    !solved ? "skip" : jwins >= JITTER_MIN_WINS ? "ok" : "fail",
    solved ? `${jwins}/${JITTER_TRIALS}` : "—",
  );

  return rows;
}
