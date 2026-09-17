#!/usr/bin/env node
// THE SHIPPED LIST, checked and listed. `levels.data.ts` is the level list the
// game ships, and it carries one piece of
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
//   - no main game at all, or bonus rows that are not a contiguous tail: the
//     finale fires on the last row WITHOUT `bonus`, so a bonus row in the
//     middle would put the ending somewhere nobody meant
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
      `  ${String(i + 1).padStart(2)}. ${row.id.padEnd(24)} ${L.name.padEnd(26)}` +
        `${L.terrain.length} polylines, ${L.cans.length} cans, ${row.hash.length} chars`,
    );
  // The ending, drawn where it actually falls.
  if (!check && !row.bonus && BAKED_LEVELS[i + 1]?.bonus)
    console.log("      ── the credits roll here ── everything below is post-credits");
});

const firstBonus = BAKED_LEVELS.findIndex((r) => r.bonus);
if (firstBonus === 0) problems.push("every row is `bonus` — an ending needs something to be the end of");
if (firstBonus > 0 && !BAKED_LEVELS.slice(firstBonus).every((r) => r.bonus))
  problems.push("`bonus` rows are not a contiguous tail — the finale fires on the last row without it");

if (!problems.length)
  console.log(
    check
      // One line, like the other build checks: a silent check reads as a
      // check that did not run.
      ? `Levels OK (${BAKED_LEVELS.length} shipped, ${BAKED_LEVELS.filter((r) => !r.bonus).length} before the credits; ` +
        `ids unique, names match their hashes)`
      : `\n${BAKED_LEVELS.length} level(s) shipped. Nothing grades them — play them.`,
  );
if (problems.length) {
  console.error("\n" + problems.map((p) => `  ✗ ${p}`).join("\n"));
  process.exit(1);
}
