/**
 * Fail the build if anything but `POP_SPD` decides how hard a party popper
 * fires.
 *
 * There is ONE popper speed, for every popper, in every level, everywhere. The
 * reason is that a level has two doors and only one of them can carry a
 * number: a link (`codec.ts`) could spell a speed per popper, but a Figma
 * frame cannot — Figma increments a trailing digit on duplicate, so
 * `party-popper 138`…`149` would be twelve speeds nobody chose. A board tuned
 * to a speed a frame cannot carry plays one way from its link and another way
 * from its drawing, which is a whole level's retune, discovered the hard way.
 *
 * So the rule is not "keep them in sync", it is "there is only one":
 *   - `POP_SPD` is declared once, in packages/shared/src/goomba/levels.ts
 *   - `initLevel` stamps it onto every popper, over whatever arrived
 *   - nothing else names a popper speed, and nothing AUTHORS `spd:`
 *
 * `spd` still rides in the link format (dropping a field from the middle of a
 * record costs a format version), which is why "written, never authored" is
 * the line this draws: the codec may write POP_SPD, no one may type a number.
 *
 * Run: node scripts/check-popper-speed.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, extname } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Where the one constant lives, and the only file allowed to name it. */
const HOME = "packages/shared/src/goomba/levels.ts";
/**
 * The few files that may write the word at all: the constant's home, the codec
 * (it writes the legacy field), physics (it fires it), this check, and the
 * codec's test — which authors a link with a speed on PURPOSE, to prove that a
 * level carrying one still plays at POP_SPD.
 */
const WRITERS = new Set([HOME, "packages/shared/src/goomba/codec.ts",
  "packages/shared/src/goomba/physics.ts", "scripts/check-popper-speed.mjs",
  "tools/goomba/test-codec.mjs"]);
const SKIP = new Set(["node_modules", "dist", ".git", ".wrangler", "fixtures"]);
const EXT = new Set([".ts", ".js", ".mjs", ".tsx", ".jsx"]);

/** A popper speed being DECLARED: `POP_SPD = 130`, `FIGMA_POP_SPD = 130`, … */
const DECLARES = /\b(?:[A-Z_]*POP(?:PER)?_(?:SPD|SPEED))\s*[=:]\s*\d/;
/** A popper speed being AUTHORED onto a popper: `spd: 130`, `spd = p.iSpd`. */
const AUTHORS = /(?<![A-Za-z_$])spd\s*[:=]\s*[^=]/;

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXT.has(extname(e.name))) yield p;
  }
}

let failures = 0;
const flag = (file, n, line, why) => {
  failures++;
  console.log(`  ${file}:${n}\n    ${line.trim()}\n    ${why}`);
};

let declaredIn = [];
for await (const abs of walk(ROOT)) {
  const file = relative(ROOT, abs).split("\\").join("/");
  const src = await readFile(abs, "utf8");
  src.split("\n").forEach((line, i) => {
    const n = i + 1;
    // A comment may say the number; only code may not.
    const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    if (DECLARES.test(code)) {
      declaredIn.push(`${file}:${n}`);
      if (file !== HOME)
        flag(file, n, line, `a second popper speed. There is one, in ${HOME} — import POP_SPD.`);
    }
    // `spd?: number` in the interface is the field, not a value.
    if (AUTHORS.test(code) && !/spd\?:\s*number/.test(code) && !WRITERS.has(file))
      flag(file, n, line, "a popper's speed is not authorable: initLevel stamps POP_SPD over it.");
  });
}
if (declaredIn.length !== 1 || !declaredIn[0].startsWith(HOME)) {
  failures++;
  console.log(`  POP_SPD must be declared exactly once, in ${HOME}` +
    `\n    found: ${declaredIn.join(", ") || "nowhere"}`);
}

console.log(failures
  ? `\ncheck:popper-speed FAILED — ${failures} place(s) deciding a popper's speed`
  : "check:popper-speed ok — one popper speed, everywhere");
process.exit(failures ? 1 : 0);
