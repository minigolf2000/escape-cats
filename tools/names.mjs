// The name rule, as cases. `cleanName` guards two one-line readouts (the
// chat's `n here: A, B, C, D` and the column both games draw over the play
// area) and a proctor row whose height is FIXED — every case below is a way
// one of those breaks, not a hypothetical.
//
//   node tools/names.mjs
//
// Reads the shared source directly: this is one exported function, and a build
// step would be more machinery than the thing it tests.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { transform } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "../packages/shared/src/lobby.ts"), "utf8");

// Run the REAL rule, not a copy of it: cut the name section out of lobby.ts
// (it imports nothing, so it stands alone), drop the types with the esbuild
// already in the tree, and import what comes out.
const start = src.indexOf("export const NAME_MAX");
const end = src.indexOf("/** Players per team.");
if (start < 0 || end < 0) throw new Error("lobby.ts no longer holds the name rule");
const { code } = await transform(src.slice(start, end), { loader: "ts" });
const { NAME_MAX, nameDraft, cleanName } = await import(
  "data:text/javascript," + encodeURIComponent(code)
);

let failed = 0;
const is = (what, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${what.padEnd(34)} ${JSON.stringify(got)}${
      ok ? "" : `   want ${JSON.stringify(want)}`
    }`,
  );
};

console.log("\nnames — what a name may be\n");

console.log(" the cap is twelve, counted as a person counts");
is("twelve characters", cleanName("abcdefghijklmnop"), "abcdefghijkl");
is("a cut word loses its space", cleanName("Bartholomew Fluffington"), "Bartholomew");
is("an emoji is ONE character", cleanName("🐱🐱🐱🐱🐱🐱🐱🐱🐱🐱🐱🐱🐱"), "🐱🐱🐱🐱🐱🐱🐱🐱🐱🐱🐱🐱");
is("never half an emoji", cleanName("aaaaaaaaaaa\u{1F408}\u{1F408}"), "aaaaaaaaaaa\u{1F408}");
is("a flag is one character", cleanName("\u{1F1FA}\u{1F1F8} Sam"), "\u{1F1FA}\u{1F1F8} Sam");
is("80 chars from a socket URL", cleanName("Q".repeat(80)), "QQQQQQQQQQQQ");

console.log("\n names people actually have");
is("an apostrophe", cleanName("O'Hara"), "O'Hara");
is("a hyphen", cleanName("Anne-Marie"), "Anne-Marie");
is("initials", cleanName("J.R."), "J.R.");
is("a precomposed accent", cleanName("José"), "José");
is("a decomposed accent (NFC)", cleanName("José"), "José");
is("ñ", cleanName("Núñez"), "Núñez");
is("a party name", cleanName("\u{1F408} Sam"), "\u{1F408} Sam");

console.log("\n and the ways a room gets wrecked");
// Combining marks climb out of a fixed-height row. NFC first, so the accents
// above survive as letters and only the leftovers are stripped.
is("zalgo", cleanName("P͓͐r̢i̴y̢a͐"), "Priya");
// U+202E reverses everything the proctor reads after it.
is("bidi override", cleanName("Priya‮yar"), "Priyayar");
// A row with nothing to read and nothing to grab.
is("zero-width only", cleanName("​​​"), "");
is("braille blank only", cleanName("⠀⠀"), "");
is("punctuation only", cleanName("..."), "");
is("spaces only", cleanName("   "), "");
is("a control character", cleanName("Priya"), "Priya");
is("a newline", cleanName("Priya\nRay"), "Priya Ray");
is("a tab is a space, not a weld", cleanName("Priya\tRay"), "Priya Ray");
is("collapsed runs", cleanName("Priya    Ray"), "Priya Ray");
// One font draws these, and nobody in the room can say them out loud.
is("non-Latin script", cleanName("Привет"), "");
is("mixed script keeps the Latin", cleanName("Sam При"), "Sam");
is("html-ish", cleanName("<b>hi</b>"), "bhib");
is("nothing at all", cleanName(""), "");
is("not even a string", cleanName(undefined), "");

console.log("\n a draft keeps the space you are about to type after");
is("trailing space survives", nameDraft("Priya "), "Priya ");
is("but never leads", nameDraft("  Priya"), "Priya");
is("and still caps", nameDraft("Bartholomew Fluffington"), "Bartholomew ");

console.log(
  failed === 0
    ? `\nPASS — ${NAME_MAX} characters, a whitelist, and nothing invisible\n`
    : `\nFAIL — ${failed} case(s)\n`,
);
process.exit(failed === 0 ? 0 : 1);
