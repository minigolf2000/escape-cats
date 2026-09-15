#!/usr/bin/env node
// PROGRESS SURVIVING A CHANGED LEVEL LIST — the one rule that used to be
// wrong. The room keyed `completed` by INDEX, so deleting a level shifted
// every flag after it; that was fine for a party that lasted ten minutes and
// is not fine for a save that outlives a level being inserted at slot 1.
//
//   node test-library.mjs
//
// Each case is a list edit that used to move somebody's progress.
import {
  completedFor, foldProgress, freshProgress, readProgress, rowsToLevels,
  BAKED_LEVELS, localId,
} from "./draft/_sim.mjs";

let failed = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// A pack of three, built off the one real level so every hash decodes.
const H = BAKED_LEVELS[0].hash;
const row = (id) => ({ id, name: "x", hash: H });
const A = row("a"), B = row("b"), C = row("c");
const levels = (rows) => rowsToLevels(rows, "baked");

const now = 1000;
// Cleared the middle one.
let p = foldProgress(freshProgress(), levels([A, B, C]), [false, true, false], now);
is("clearing level 2 remembers its id", p.cleared, { b: now });

// THE OLD BUG: delete level 1 and an index-keyed save slides the flag down.
is("delete the level BEFORE it — the clear stays put",
   completedFor(levels([B, C]), p), [true, false]);
is("insert a level BEFORE it — the clear still stays put",
   completedFor(levels([row("new"), A, B, C]), p), [false, false, true, false]);
is("reorder — the clear follows the level, not the slot",
   completedFor(levels([C, B, A]), p), [false, true, false]);
is("rename the level — the row's name is not the identity",
   completedFor(levels([A, { ...B, name: "renamed" }, C]), p), [false, true, false]);

// Delete it and paste it back: the id is what makes that a no-op.
const gone = levels([A, C]);
p = foldProgress(p, gone, completedFor(gone, p), now);
is("deleting the level does NOT forget it", p.cleared, { b: now });
is("...so pasting it back restores the clear",
   completedFor(levels([A, B, C]), p), [false, true, false]);

// Start over has to actually forget, or the next load hands it all back.
const all = levels([A, B, C]);
is("start over forgets every level in the list",
   foldProgress(p, all, [false, false, false], now).cleared, {});

// A new id is a new level, on purpose: that is the lever for "this one changed
// enough that a clear should not carry over".
is("changing the id un-clears it", completedFor(levels([{ ...B, id: "b2" }]), p), [false]);

// The `#hash` level has no id and is never remembered.
const scratch = rowsToLevels([{ id: "s", name: "x", hash: H }], "hash");
delete scratch[0].id;
is("a level with no id is never cleared", completedFor(scratch, { v: 1, cleared: { s: 1 } }), [false]);
is("...and folding it writes nothing", foldProgress(freshProgress(), scratch, [true], now).cleared, {});

// localStorage is hand-editable; every shape has to answer something.
is("garbage progress reads as a fresh start", readProgress("nope"), freshProgress());
is("a future version reads as a fresh start", readProgress({ v: 2, cleared: { a: 1 } }), freshProgress());
is("non-numeric timestamps are dropped", readProgress({ v: 1, cleared: { a: "x", b: 2 } }).cleared, { b: 2 });

// Two pastes of the same frame must not share one player's progress.
is("two local ids off one name differ", localId("Same Name") !== localId("Same Name"), true);

console.log(failed ? `\n${failed} failed` : "\nall good");
process.exit(failed ? 1 : 0);
