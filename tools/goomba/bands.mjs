// THE ROOM'S BAND RULE. verify.mjs proves a level NEEDS 4 bands; this proves the
// room hands out exactly 4 and puts no conditions on who lays or lifts them.
//
// It drives the real GoombaSim (the same class the Durable Object wraps) through
// the placement paths a room actually takes: one player laying all four, four
// players sharing them, teammates lifting each other's bands, a clear.
//
//   node bands.mjs
//
// This replaced quota.mjs, which tested the rule that used to sit beside the
// budget: a per-player cap of ceil(MAX_BANDS / players in the room), so a room
// of four was forced to lay exactly one band each. That cap is gone — the game
// is multiplayer because four people share four bands, not because the room
// rations them — and what is left to guard is the budget itself and the absence
// of the cap. Both are checked here, the second one deliberately: "A may lay all
// four while B, C and D watch" is a product decision, not an accident, and a
// re-introduced quota should fail a test rather than surprise a party.

import { GoombaSim, canPlaceBand, MAX_BANDS } from "./lib.mjs";

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail && !ok ? ` — ${detail}` : ""}`);
};
const section = (s) => console.log(`\n${s}`);

// A band long enough to be legal (BAND_MIN..BAND_MAX) laid somewhere harmless.
// Geometry is irrelevant here: we are testing who may place, not what wins.
let y = 0;
const band = () => {
  y += 1;
  return { ax: 10, ay: 20 + y, bx: 40, by: 20 + y };
};
/** Try a placement; report whether the room took it. */
const place = (sim, pid) => {
  const before = sim.st.bands.length;
  sim.place(pid, band(), Date.now());
  return sim.st.bands.length > before;
};
const held = (sim, pid) => sim.st.bands.filter((b) => b.pid === pid).length;

// ---------------------------------------------------------------------------
section("the budget");
// ---------------------------------------------------------------------------
check("canPlaceBand is exactly 'is a band free'",
  canPlaceBand([]) && canPlaceBand(new Array(MAX_BANDS - 1)) && !canPlaceBand(new Array(MAX_BANDS)));
{
  const sim = new GoombaSim(Date.now());
  for (let i = 0; i < MAX_BANDS; i++) check(`band ${i + 1} lands`, place(sim, "A"));
  check(`a ${MAX_BANDS + 1}th is refused`, !place(sim, "A"));
  check("one player may lay all four — nobody is rationed", held(sim, "A") === MAX_BANDS);
}

// ---------------------------------------------------------------------------
section("anybody's band");
// ---------------------------------------------------------------------------
{
  const sim = new GoombaSim(Date.now());
  check("A, B, C, D lay one each", ["A", "B", "C", "D"].every((p) => place(sim, p)));
  check("that is the whole budget", sim.st.bands.length === MAX_BANDS);
  check("and a fifth from a fifth phone is still refused", !place(sim, "E"));
}
{
  // The case the old quota forbade outright, checked from both ends: a full
  // room where one player is doing all the placing.
  const sim = new GoombaSim(Date.now());
  place(sim, "A"); place(sim, "A");
  check("A holds two with three teammates present", held(sim, "A") === 2);
  check("A may lay a third", place(sim, "A"));
  check("B may still lay the fourth", place(sim, "B"));
  check("the split can be anything that adds to four",
    held(sim, "A") === 3 && held(sim, "B") === 1);
}

// ---------------------------------------------------------------------------
section("taking one back");
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
section("nothing else gates a placement");
// ---------------------------------------------------------------------------
{
  const sim = new GoombaSim(Date.now());
  const now = Date.now();
  sim.play(now); // phase → run
  check("no band lands mid-run", !place(sim, "A") && sim.st.bands.length === 0);
}

console.log(
  fails === 0
    ? `\nPASS — ${MAX_BANDS} bands for the room, and no rule about whose`
    : `\nFAIL — ${fails} check(s) above`,
);
process.exit(fails === 0 ? 0 : 1);
