// THE BAND RULE: a level hands out exactly MAX_BANDS (4) and puts no conditions
// on WHOSE they are. A test of SHIPPED code, not of a level — it drives the real
// GoombaSim through every placement path.
//
// The `pid` a band carries is a note and nothing reads it as a rule. That was a
// product decision for four players sharing a room ("A may lay all four while
// B, C and D watch"); the game is single player and the property still holds,
// so the multi-pid cases below stay as the guard against a per-player quota
// being re-introduced into `place`.
//
//   node bands.mjs

import { GoombaSim, canPlaceBand, MAX_BANDS, applyPack, levelsToPack } from "./lib.mjs";

/**
 * A board of its own — a floor, a spawn, a plant — installed before any sim is
 * built. GoombaSim places bands against the loaded level, and this must not
 * pass or fail on whatever an event happens to be playing.
 */
applyPack(levelsToPack([{
  name: "Band Rule Fixture",
  start: [10, 50],
  goal: [90, 50],
  terrain: [[[0, 60], [100, 60]]],
}]));

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail && !ok ? ` — ${detail}` : ""}`);
};
const section = (s) => console.log(`\n${s}`);

// A band long enough to be legal (BAND_MIN..BAND_MAX), laid somewhere harmless.
let y = 0;
const band = () => {
  y += 1;
  return { ax: 10, ay: 20 + y, bx: 40, by: 20 + y };
};
/** Try a placement; report whether the sim took it. */
const place = (sim, pid) => {
  const before = sim.st.bands.length;
  sim.place(pid, band(), Date.now());
  return sim.st.bands.length > before;
};
const held = (sim, pid) => sim.st.bands.filter((b) => b.pid === pid).length;

section("the budget");
check("canPlaceBand is exactly 'is a band free'",
  canPlaceBand([]) && canPlaceBand(new Array(MAX_BANDS - 1)) && !canPlaceBand(new Array(MAX_BANDS)));
{
  const sim = new GoombaSim(Date.now());
  for (let i = 0; i < MAX_BANDS; i++) check(`band ${i + 1} lands`, place(sim, "A"));
  check(`a ${MAX_BANDS + 1}th is refused`, !place(sim, "A"));
  check("one player may lay all four — nobody is rationed", held(sim, "A") === MAX_BANDS);
}

section("anybody's band");
{
  const sim = new GoombaSim(Date.now());
  check("A, B, C, D lay one each", ["A", "B", "C", "D"].every((p) => place(sim, p)));
  check("that is the whole budget", sim.st.bands.length === MAX_BANDS);
  check("and a fifth pid is still refused the fifth band", !place(sim, "E"));
}
{
  // One pid doing all the placing — the single-player case, and the one that
  // would break first if a quota came back.
  const sim = new GoombaSim(Date.now());
  place(sim, "A"); place(sim, "A");
  check("A holds two", held(sim, "A") === 2);
  check("A may lay a third", place(sim, "A"));
  check("B may still lay the fourth", place(sim, "B"));
  check("the split can be anything that adds to four",
    held(sim, "A") === 3 && held(sim, "B") === 1);
}

section("taking one back");
{
  const sim = new GoombaSim(Date.now());
  const now = Date.now();
  ["A", "B", "C", "D"].forEach((p) => place(sim, p));
  const bIdx = sim.st.bands.findIndex((b) => b.pid === "B");
  sim.remove(bIdx, now);
  check("A lifts B's band", sim.st.bands.length === MAX_BANDS - 1 && held(sim, "B") === 0);
  check("and the freed band is anyone's — A takes it", place(sim, "A"));
  sim.clear(now);
  check("clear empties the whole board", sim.st.bands.length === 0);
  check("…and all four are back", ["A", "A", "B", "C"].every((p) => place(sim, p)));
}

section("nothing else gates a placement");
{
  const sim = new GoombaSim(Date.now());
  const now = Date.now();
  sim.play(now); // phase → run
  check("no band lands mid-run", !place(sim, "A") && sim.st.bands.length === 0);
}

console.log(
  fails === 0
    ? `\nPASS — ${MAX_BANDS} bands a level, and no rule about whose`
    : `\nFAIL — ${fails} check(s) above`,
);
process.exit(fails === 0 ? 0 : 1);
