// THE BAND RULE: a level hands out exactly MAX_BANDS (4) and nothing else gates
// a placement. A test of SHIPPED code, not of a level — it drives the real
// GoombaSim through every placement path.
//
//   node bands.mjs

import { GoombaSim, canPlaceBand, MAX_BANDS, setGoombaLevels } from "./lib.mjs";

/**
 * A board of its own — a floor, a spawn, a plant — installed before any sim is
 * built. GoombaSim places bands against the loaded level, and this must not
 * pass or fail on whatever the shipped list holds.
 */
setGoombaLevels([{
  name: "Band Rule Fixture",
  start: [10, 50],
  goal: [90, 50],
  terrain: [[[0, 60], [100, 60]]],
}]);

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
const place = (sim) => {
  const before = sim.st.bands.length;
  sim.place(band(), Date.now());
  return sim.st.bands.length > before;
};

section("the budget");
check("canPlaceBand is exactly 'is a band free'",
  canPlaceBand([]) && canPlaceBand(new Array(MAX_BANDS - 1)) && !canPlaceBand(new Array(MAX_BANDS)));
{
  const sim = new GoombaSim(Date.now());
  for (let i = 0; i < MAX_BANDS; i++) check(`band ${i + 1} lands`, place(sim));
  check(`a ${MAX_BANDS + 1}th is refused`, !place(sim));
}

section("taking one back");
{
  const sim = new GoombaSim(Date.now());
  const now = Date.now();
  for (let i = 0; i < MAX_BANDS; i++) place(sim);
  sim.remove(1, now);
  check("remove frees one", sim.st.bands.length === MAX_BANDS - 1);
  check("and the freed band can be laid again", place(sim));
  check("but only that one", !place(sim));
  sim.clear(now);
  check("clear empties the whole board", sim.st.bands.length === 0);
  check("…and all four are back", Array.from({ length: MAX_BANDS }, () => place(sim)).every(Boolean));
}

section("nothing else gates a placement");
{
  const sim = new GoombaSim(Date.now());
  const now = Date.now();
  sim.play(now); // phase → run
  check("no band lands mid-run", !place(sim) && sim.st.bands.length === 0);
}

console.log(
  fails === 0
    ? `\nPASS — ${MAX_BANDS} bands a level, and nothing else gates one`
    : `\nFAIL — ${fails} check(s) above`,
);
process.exit(fails === 0 ? 0 : 1);
