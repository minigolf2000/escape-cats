#!/usr/bin/env node
// WHERE THE CREDITS ROLL. The finale fires when the last level that is NOT
// marked `bonus` is cleared; everything after it is post-credits, reached
// through the levels grid that clearing the game unlocks.
//
//   node finale.mjs
//
// A test of SHIPPED code: it drives the real GoombaSim over synthetic lists,
// then asserts the actual `levels.data.ts` has an ending to reach at all. The
// rule is quiet when it breaks — a mis-set flag does not crash, it just moves
// where the game says goodbye — so it is worth a test.
import {
  GoombaSim, rowsToLevels, setGoombaLevels, hasBonusLevels, preCreditsCount,
  goombaCleared, BAKED_LEVELS,
} from "./lib.mjs";

let failed = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const H = BAKED_LEVELS[0].hash;
/** Install a synthetic list: "m" = main, "b" = bonus. */
const install = (shape) =>
  setGoombaLevels(rowsToLevels(
    [...shape].map((c, i) => ({ id: `l${i}`, name: `L${i}`, hash: H, bonus: c === "b" })),
    "baked",
  ));

/** Clear level `i` the way a real run does: play, then let the run play out. */
function clear(sim, i) {
  sim.goto(i, 1000);
  sim.st.completed[i] = true;          // the run's verdict, banked
  sim.st.phase = "run";
  sim.st.runAt = 1000; sim.st.runT = 0; sim.st.runResult = "win";
  sim.resolve(2000);
  return sim.st.phase;
}

console.log("\nNO BONUS SECTION — the finale is the end, as it always was");
install("mmm");
{
  const sim = new GoombaSim(1000);
  is("clearing the first two only banks wins", [clear(sim, 0), clear(sim, 1)], ["win", "win"]);
  is("the last one lands on the splash", clear(sim, 2), "splash");
  is("...and the game reads as cleared", goombaCleared(sim.st), true);
  sim.goto(0, 3000);
  is("goto is REFUSED from it — terminal", sim.st.phase, "splash");
}

console.log("\nWITH A BONUS SECTION — the credits roll early");
install("mmbbb");
{
  const sim = new GoombaSim(1000);
  is("the first main level is only a win", clear(sim, 0), "win");
  is("bonus levels do not hold the ending up", clear(sim, 1), "splash");
  is("...so it fires with every BONUS level still untouched",
    sim.st.completed, [true, true, false, false, false]);
  is("the grid is unlocked, which is the door to them", goombaCleared(sim.st), true);
  sim.goto(3, 3000);
  is("goto LEAVES the splash", [sim.st.phase, sim.st.level], ["edit", 3]);
  is("clearing a bonus level is an ordinary win", clear(sim, 3), "win");
  is("...and never re-runs the ending", sim.st.phase, "win");
  is("the ending's timestamp is the FIRST one", sim.st.finishedAt, 2000);
}

console.log("\nTHE LIST CHANGING UNDER A FINISHED GAME");
{
  install("mmbbb");
  const sim = new GoombaSim(1000);
  clear(sim, 0); clear(sim, 1);
  is("cleared", sim.st.phase, "splash");
  install("mmmbbb");            // a new MAIN level arrives
  sim.reconcile(4000);
  is("a new main level un-clears the game", goombaCleared(sim.st), false);
  is("...and takes the splash back", sim.st.phase, "edit");
  install("mmbbb");
  sim.reconcile(5000);
  is("removing it clears the game again", goombaCleared(sim.st), true);
}

console.log("\nA LIST OF NOTHING BUT BONUS");
install("bbb");
{
  const sim = new GoombaSim(1000);
  is("never clears — an ending needs something to be the end of", clear(sim, 2), "win");
  is("...and the grid stays locked", goombaCleared(sim.st), false);
}

console.log("\nANYTHING NOT SHIPPED IS POST-CREDITS, WHATEVER ITS ROW SAYS");
{
  setGoombaLevels([
    ...rowsToLevels([{ id: "a", name: "A", hash: H }], "baked"),
    ...rowsToLevels([{ id: "b", name: "B", hash: H }], "local"),
    ...rowsToLevels([{ id: "c", name: "C", hash: H }], "hash"),
  ]);
  const sim = new GoombaSim(1000);
  is("neither a local paste nor a #hash level can hold the ending up", clear(sim, 0), "splash");
  is("...and both count as the way out", hasBonusLevels(), true);
}

console.log("\nWHAT THE LEVEL DOTS MAY COUNT (preCreditsCount)");
{
  // The dots span this until the game is cleared, so it must never count a
  // level the ending has not introduced yet.
  install("mmm");
  is("no bonus section: the whole list, because all of it is pre-credits",
    preCreditsCount(), 3);
  install("mmbbb");
  is("a bonus tail is not counted", preCreditsCount(), 2);
  install("bbb");
  is("nothing but bonus counts nothing", preCreditsCount(), 0);
  install("mbm");
  is("a stray bonus row SHORTS the count rather than leaking the tail",
    preCreditsCount(), 1);
  setGoombaLevels([
    ...rowsToLevels([{ id: "a", name: "A", hash: H }], "baked"),
    ...rowsToLevels([{ id: "b", name: "B", hash: H }], "local"),
    ...rowsToLevels([{ id: "c", name: "C", hash: H }], "hash"),
  ]);
  is("an unshipped level is post-credits here too", preCreditsCount(), 1);
}

console.log("\nTHE LIST THE GAME ACTUALLY SHIPS");
{
  // Its SHAPE (a main game exists, the bonus rows are a tail) is
  // `levels.mjs --check`'s to enforce; this only asks that the sim, given the
  // real list, sees the post-credits section at all.
  setGoombaLevels(rowsToLevels(BAKED_LEVELS, "baked"));
  is("the sim sees post-credits levels in the shipped list", hasBonusLevels(), true);
  is("...so the dots start out short of the whole list",
    preCreditsCount() < BAKED_LEVELS.length, true);
}

console.log(failed ? `\n${failed} failed` : "\nall good");
process.exit(failed ? 1 : 0);
