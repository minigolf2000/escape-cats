// The name rule, as cases — every one of them a way a room breaks, not a
// hypothetical.  node tools/names.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { transform } from "esbuild";

// The REAL rule, not a copy: lobby.ts's only import is a type, which esbuild
// strips, so the whole file imports as plain JS.
const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../packages/shared/src/lobby.ts"),
  "utf8",
);
const { code } = await transform(src, { loader: "ts" });
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
is("zalgo", cleanName("P͓͐r̢i̴y̢a͐"), "Priya");
is("bidi override", cleanName("Priya‮yar"), "Priyayar");
is("zero-width only", cleanName("​​​"), "");
is("braille blank only", cleanName("⠀⠀"), "");
is("punctuation only", cleanName("..."), "");
is("spaces only", cleanName("   "), "");
is("a control character", cleanName("Priya"), "Priya");
is("a newline", cleanName("Priya\nRay"), "Priya Ray");
is("a tab is a space, not a weld", cleanName("Priya\tRay"), "Priya Ray");
is("collapsed runs", cleanName("Priya    Ray"), "Priya Ray");
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
