// The instant half of the gate: everything `verify.mjs` checks that costs
// tens of milliseconds rather than minutes, re-run on every edit.
//
// The split matters. Checks 1–4 here grade the solution the designer typed,
// which is cheap because there is only one of it. Checks 5–7 in verify.mjs ask
// whether some OTHER, smaller solution exists — a search over thousands of
// placements, and the only question a human genuinely cannot answer by looking.
// That one runs in the background (hunter.js) and, for real, on the bench.
import { BAND_MAX, BAND_MIN, MAX_BANDS, bandLen, mulberry, runResult } from "./sim.js";

const JITTER_MIN_WINS = 18; // of 30 — verify.mjs's threshold, kept in step

/**
 * Grade a prepared level. Returns one row per check in the order verify.mjs
 * runs them, each `{ name, state, detail }` where state is "ok" | "fail" |
 * "skip" — "skip" for checks that cannot be asked yet (there is no point
 * grading a 2-band solution's robustness).
 */
export function verdicts(init) {
  const sol = init.solution ?? [];
  const rows = [];
  const row = (name, state, detail) => {
    rows.push({ name, state, detail });
    return state === "ok";
  };

  // 1. Bare. A level that wins with no bands is not a level.
  const bare = runResult(init, []);
  row("bare run fails", bare.result === "win" ? "fail" : "ok", `${bare.result} @ ${bare.t}s`);

  // 2. The party rule's shape, then whether it actually wins.
  const shaped = row(
    `solution is ${MAX_BANDS} bands`,
    sol.length === MAX_BANDS ? "ok" : "fail",
    `${sol.length} placed`,
  );
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
    const rnd = mulberry(12345);
    for (let t = 0; t < 30; t++) {
      const jit = sol.map(([a, b]) => [
        [a[0] + (rnd() * 2 - 1) * 3, a[1] + (rnd() * 2 - 1) * 3],
        [b[0] + (rnd() * 2 - 1) * 3, b[1] + (rnd() * 2 - 1) * 3],
      ]);
      if (runResult(init, jit).result === "win") jwins++;
    }
  }
  row(
    `±3u finger slop ≥ ${JITTER_MIN_WINS}/30`,
    !solved ? "skip" : jwins >= JITTER_MIN_WINS ? "ok" : "fail",
    solved ? `${jwins}/30` : "—",
  );

  return rows;
}
