// THE PARTICIPATION GATE. verify.mjs proves a level needs 4 bands; this proves
// the ROOM makes 4 different-enough hands place them — the other half of the
// party rule, and the half that lives in code rather than in level geometry.
//
// It drives the real GoombaSim (same class the Durable Object wraps) through
// the placement paths a room actually takes: full teams, short teams, players
// arriving and dropping mid-level, and a player fiddling with their own band.
//
//   node quota.mjs
//
// The rule under test is one formula — quota k(n) = ceil(MAX_BANDS / n), the
// tightest per-player cap a team of n can still finish under. See the block
// comment on bandQuota() in packages/shared/src/goomba/sim.ts.

import { GoombaSim, bandQuota, MAX_BANDS } from "./lib.mjs";

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
const place = (sim, pid, n) => {
  const before = sim.st.bands.length;
  sim.place(pid, 0, band(), Date.now(), n);
  return sim.st.bands.length > before;
};
const held = (sim, pid) => sim.st.bands.filter((b) => b.pid === pid).length;

// ---------------------------------------------------------------------------
section("the formula");
// ---------------------------------------------------------------------------
check("k(1) = 4 — a lone player lays all four", bandQuota(1) === 4, `got ${bandQuota(1)}`);
check("k(2) = 2", bandQuota(2) === 2, `got ${bandQuota(2)}`);
check("k(3) = 2", bandQuota(3) === 2, `got ${bandQuota(3)}`);
check("k(4) = 1", bandQuota(4) === 1, `got ${bandQuota(4)}`);
check("k(0) = 4 — an empty room can't divide by zero", bandQuota(0) === 4);
check("k(5) = 1 — an over-full team just benches the extra", bandQuota(5) === 1);
// The two properties the formula is chosen FOR.
for (let n = 1; n <= 6; n++) {
  const k = bandQuota(n);
  check(`n=${n}: n·k ≥ ${MAX_BANDS} (the team can finish)`, n * k >= MAX_BANDS, `${n}·${k}`);
  check(`n=${n}: n·(k−1) < ${MAX_BANDS} (no tighter cap could)`, n * (k - 1) < MAX_BANDS, `${n}·${k - 1}`);
}

// ---------------------------------------------------------------------------
section("4 players — one band each, forced");
// ---------------------------------------------------------------------------
{
  const sim = new GoombaSim(Date.now());
  check("A's first band lands", place(sim, "A", 4));
  check("A's SECOND band is refused", !place(sim, "A", 4));
  check("B, C land theirs", place(sim, "B", 4) && place(sim, "C", 4));
  check("A still refused with a slot free", !place(sim, "A", 4) && sim.st.bands.length === 3);
  check("D's band completes the set", place(sim, "D", 4) && sim.st.bands.length === MAX_BANDS);
  check("all four bands have distinct owners",
    new Set(sim.st.bands.map((b) => b.pid)).size === 4);
}

// ---------------------------------------------------------------------------
section("2 players — two each, forced");
// ---------------------------------------------------------------------------
{
  const sim = new GoombaSim(Date.now());
  check("A lays two", place(sim, "A", 2) && place(sim, "A", 2));
  check("A's third is refused", !place(sim, "A", 2));
  check("B lays two", place(sim, "B", 2) && place(sim, "B", 2));
  check("the split is exactly 2/2", held(sim, "A") === 2 && held(sim, "B") === 2);
}

// ---------------------------------------------------------------------------
section("3 players — up to two each, at least two placing");
// ---------------------------------------------------------------------------
{
  const sim = new GoombaSim(Date.now());
  check("A lays two", place(sim, "A", 3) && place(sim, "A", 3));
  check("A's third is refused", !place(sim, "A", 3));
  check("B may lay the other two (C sits out — legal at n=3)",
    place(sim, "B", 3) && place(sim, "B", 3));
  check("no one player laid all four",
    Math.max(...["A", "B", "C"].map((p) => held(sim, p))) < MAX_BANDS);
}

// ---------------------------------------------------------------------------
section("1 player — the whole level, and the solo/?solo bench");
// ---------------------------------------------------------------------------
{
  const sim = new GoombaSim(Date.now());
  for (let i = 0; i < MAX_BANDS; i++) check(`solo band ${i + 1} lands`, place(sim, "A", 1));
  check("a fifth is refused (the room budget still bites)", !place(sim, "A", 1));
}

// ---------------------------------------------------------------------------
section("the roster moves under the rule");
// ---------------------------------------------------------------------------
{
  // Laid three alone, then three teammates walk in: the quota drops to 1 and
  // A is legitimately OVER it. Nothing is retracted, and the level must still
  // be finishable.
  const sim = new GoombaSim(Date.now());
  place(sim, "A", 1); place(sim, "A", 1); place(sim, "A", 1);
  check("A, now over quota, may not place again", !place(sim, "A", 4));
  check("A's three bands are NOT taken away", held(sim, "A") === 3);
  check("a newcomer can still lay the fourth", place(sim, "B", 4));
  check("the level completed anyway", sim.st.bands.length === MAX_BANDS);
}
{
  // The other direction: a teammate drops mid-level and their share comes back
  // to the room, so a 4-player team that loses a phone isn't stranded at 3/4.
  const sim = new GoombaSim(Date.now());
  place(sim, "A", 4); place(sim, "B", 4); place(sim, "C", 4);
  check("at n=4 the team is stuck on 3 bands", !place(sim, "A", 4) && sim.st.bands.length === 3);
  check("D's phone drops (n=3) → A may lay the fourth", place(sim, "A", 3));
  check("the team finished without D", sim.st.bands.length === MAX_BANDS);
}
{
  // The no-wedge invariant, brute-forced: from any reachable holding pattern,
  // while bands remain SOMEONE may place. (Proof is in sim.ts; this is the
  // belt-and-braces sweep over the small state space.)
  let wedged = null;
  for (let n = 1; n <= 5 && !wedged; n++) {
    for (let joinAt = 1; joinAt <= 5 && !wedged; joinAt++) {
      const sim = new GoombaSim(Date.now());
      const pids = Array.from({ length: 5 }, (_, i) => `P${i}`);
      // Place greedily, with the headcount jumping partway through.
      for (let step = 0; step < MAX_BANDS + 2; step++) {
        if (sim.st.bands.length >= MAX_BANDS) break;
        const live = step < joinAt ? 1 : n;
        const took = pids.slice(0, Math.max(live, 1)).some((p) => place(sim, p, live));
        if (!took) { wedged = `n=${n} joinAt=${joinAt} stuck at ${sim.st.bands.length} bands`; break; }
      }
    }
  }
  check("no headcount change can wedge a level below 4 bands", !wedged, wedged ?? "");
}

// ---------------------------------------------------------------------------
section("holdings, not history");
// ---------------------------------------------------------------------------
{
  const sim = new GoombaSim(Date.now());
  const now = Date.now();
  place(sim, "A", 4);
  sim.remove(0, now);
  check("A repositions their own band (remove → place again)", place(sim, "A", 4));
  sim.place("B", 0, band(), now, 4);
  const bIdx = sim.st.bands.findIndex((b) => b.pid === "B");
  sim.remove(bIdx, now);
  check("removing a teammate's band gains the remover nothing", !place(sim, "A", 4));
  check("…and hands the share back to its owner", place(sim, "B", 4));
  sim.clear(now);
  check("clear resets everyone's holdings", place(sim, "A", 4) && place(sim, "A", 4) === false);
}

console.log(
  fails === 0
    ? "\nPASS — the room enforces ceil(4/n) bands per player"
    : `\nFAIL — ${fails} check(s) above`,
);
process.exit(fails === 0 ? 0 : 1);
