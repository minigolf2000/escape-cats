/**
 * Fail the build if a PLAYER-FACING app uses any cursor other than `pointer` or
 * `default`.
 *
 * This exists because the shop rows drifted into three cursors for what a player
 * experiences as two states: `pointer` when you could afford a row,
 * `not-allowed` when you couldn't, and `default` when it was still locked. Two
 * disabled states telling two different stories reads as a bug rather than as a
 * distinction — and these are PHONE games. Almost nobody playing has a cursor at
 * all, so the value cannot be carrying information to the people it renders for;
 * the only thing a third value can do is be inconsistent.
 *
 * So the rule is deliberately blunt, because a blunt rule is one nobody has to
 * adjudicate: `pointer` if a tap does something, `default` if it does not.
 * Anything else is a build failure with a file:line.
 *
 * NOT applied to apps/proctor, apps/goomba-editor or tools/. Those run on a
 * laptop, in front of one operator who does have a cursor: the proctor drags
 * teams between boxes (`grab`/`grabbing` is the affordance doing real work
 * there), qr-studio is a canvas editor (`crosshair`, `text`), and the level
 * editor drags level geometry (`crosshair` to place, `move` to drag a vertex,
 * `grabbing` to pan). The rule is about what players touch, not about banning a
 * CSS property — so ROOTS below is a list of the PLAYER-FACING apps, and a new
 * app belongs in it only if players open it.
 *
 * Run: node scripts/check-cursors.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, extname } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Player-facing apps only — see the header for why proctor, the level editor
 * and tools are out. */
const ROOTS = [
  "apps/hex-clicker",
  "apps/goomba-glider",
  "apps/lobby",
  "apps/chat",
];
const ALLOWED = new Set(["pointer", "default"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const EXTS = new Set([".html", ".css", ".js", ".jsx", ".ts", ".tsx"]);

/** CSS `cursor: x`, and the JS form `style.cursor = "x"`. */
const DECL = /cursor\s*[:=]\s*["'`]?\s*([a-zA-Z-]+)/g;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // an app that isn't checked out / doesn't exist yet is not a failure
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXTS.has(extname(e.name))) yield p;
  }
}

let failures = 0;
let checked = 0;
for (const root of ROOTS) {
  for await (const file of walk(join(repoRoot, root))) {
    const src = await readFile(file, "utf8");
    if (!src.includes("cursor")) continue;
    checked++;
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(DECL)) {
        const value = m[1];
        // `pointer-events` and `cursor` co-occur constantly; don't trip on it.
        if (value === "events" || value === "auto" || value === "none") continue;
        if (ALLOWED.has(value)) continue;
        console.log(
          `  FAIL  ${relative(repoRoot, file)}:${i + 1}  cursor: ${value}`,
        );
        failures++;
      }
    }
  }
}

console.log(
  failures
    ? `\n${failures} disallowed cursor(s). Player-facing apps use only: ${[...ALLOWED].join(", ")}.\n` +
      `See the header of scripts/check-cursors.mjs for why.`
    : `Cursors OK (${checked} file(s) with cursor rules; only ${[...ALLOWED].join("/")} in use)`,
);
process.exit(failures ? 1 : 0);
