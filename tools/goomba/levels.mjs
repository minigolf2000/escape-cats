#!/usr/bin/env node
// THE SHIPPED PACK, checked and listed. `levels.data.ts` is the level list the
// game ships (there is no lobby DO any more), and it carries one piece of
// deliberate redundancy: a row's `name` is a readable copy of a name that
// really lives inside `hash`. This is what keeps the two honest.
//
//   node levels.mjs            list the shipped pack
//   node levels.mjs --check    exit 1 on a bad row (build check)
//
// What it refuses:
//   - a hash that will not decode (a codec version the bundle cannot read)
//   - a row whose `name` has drifted from the name inside its `hash`
//   - a duplicate or empty `id` — progress is keyed on ids, so two levels
//     sharing one would silently share a player's clear
//
// It does NOT grade a level. Nothing does; playing it is the verdict
// (DESIGNING.md). This only asks whether the list is well-formed.
import { decodeLevel, BAKED_LEVELS } from "./draft/_sim.mjs";

const check = process.argv.includes("--check");
const problems = [];
const seen = new Map();

BAKED_LEVELS.forEach((row, i) => {
  const at = `row ${i + 1} (${row.id || "no id"})`;
  if (!row.id) problems.push(`${at}: empty id — progress is keyed on it`);
  else if (seen.has(row.id))
    problems.push(`${at}: duplicate id, also row ${seen.get(row.id) + 1}`);
  else seen.set(row.id, i);

  const L = decodeLevel(row.hash);
  if (!L) {
    problems.push(`${at}: hash will not decode`);
    return;
  }
  if (L.name !== row.name)
    problems.push(`${at}: name drifted — row says "${row.name}", hash says "${L.name}"`);
  if (!check)
    console.log(
      `  ${String(i + 1).padStart(2)}. ${row.id.padEnd(24)} ${L.name}` +
        `   (${L.terrain.length} polylines, ${L.cans.length} cans, ${row.hash.length} chars)`,
    );
});

if (!problems.length)
  console.log(
    check
      // One line, like the other build checks: a silent check reads as a
      // check that did not run.
      ? `Levels OK (${BAKED_LEVELS.length} shipped; ids unique, names match their hashes)`
      : `\n${BAKED_LEVELS.length} level(s) shipped. Nothing grades them — play them.`,
  );
if (problems.length) {
  console.error("\n" + problems.map((p) => `  ✗ ${p}`).join("\n"));
  process.exit(1);
}
