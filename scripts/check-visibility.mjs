/**
 * Fail the build if goomba-glider says `visibility: visible`, anywhere.
 *
 * Goomba's HUD has one screen-owner at a time — the game, the levels grid
 * (`.lab`), the congratulations splash (`.splash`), the landscape rotate
 * screen — and each owner works by hiding a subtree with `visibility: hidden`
 * and re-showing its survivors. That structure has a contract nothing used to
 * enforce: visibility INHERITS, so an explicit `visible` on a descendant does
 * not just cancel the one `hidden` its author was thinking of — it re-opens
 * the element under EVERY hidden ancestor, present and future. It is a veto
 * over every owner, held by a leaf.
 *
 * It was collected on twice in one day. "clear all bands" floated alone over
 * the level grid (`.lab` hides all of #top; the label's `visible` punched
 * through), and the splash's re-shown dot strip floated over "Turn your phone
 * upright" (the rotate rule hides #hud; the strip's `visible` punched
 * through). Different authors, different years of the file, same value.
 *
 * The rule is deliberately blunt, because a blunt rule is one nobody has to
 * adjudicate: `hidden` to hide, `inherit` to re-show or to stop forcing
 * hidden, and `visible` never — an element with no opinion says nothing and
 * follows its ancestors, which is the entire point. `inherit` cancels exactly
 * the rule you mean it to (the one on your own element) and keeps following
 * everything above you. There is no state this file expresses that needs
 * `visible` to say it; if one ever appears, the conversation it forces here
 * is the feature.
 *
 * Goomba ONLY. hex-clicker legitimately trades in `visible`: its cat is a DOM
 * sprite whose frames are hidden as a set and shown one at a time by
 * [data-pose], an idiom where `visible` under a hidden-by-default parent is
 * the mechanism itself. (Whether hex's rotate screen has this same class of
 * leak through those frames is a fair question — but it is hex's question, to
 * be answered by reading hex, not by this script growing an exception list.)
 * lobby and chat don't use visibility at all and have no owner idiom to
 * protect; they stay out until they do.
 *
 * Run: node scripts/check-visibility.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, extname } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The apps whose stylesheets keep the owner contract — see the header for
 * why this is not simply "every player-facing app". */
const ROOTS = ["apps/goomba-glider"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const EXTS = new Set([".html", ".css", ".js", ".jsx", ".ts", ".tsx"]);

/** CSS `visibility: visible`, and the JS form `style.visibility = "visible"`
 * (none today, but the contract is about the value, not the language). */
const DECL = /visibility\s*[:=]\s*["'`]?\s*visible/g;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
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
    if (!src.includes("visibility")) continue;
    checked++;
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const _ of lines[i].matchAll(DECL)) {
        console.log(
          `  FAIL  ${relative(repoRoot, file)}:${i + 1}  visibility: visible`,
        );
        failures++;
      }
    }
  }
}

console.log(
  failures
    ? `\n${failures} \`visibility: visible\` declaration(s). Goomba hides with \`hidden\` and re-shows with \`inherit\` — never \`visible\`.\n` +
      `See the header of scripts/check-visibility.mjs for the two bugs this rule is made of.`
    : `Visibility OK (${checked} file(s) use visibility; hidden/inherit only)`,
);
process.exit(failures ? 1 : 0);
