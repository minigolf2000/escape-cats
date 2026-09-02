/**
 * Fail the build if goomba-glider says `visibility: visible`, anywhere.
 *
 * Goomba's HUD has one screen-owner at a time (the game, `.lab`, `.splash`,
 * the rotate screen), each hiding a subtree with `visibility: hidden`.
 * Visibility INHERITS, so an explicit `visible` on a descendant re-opens it
 * under EVERY hidden ancestor — a veto over every owner, held by a leaf. The
 * two bugs this rule is made of: "clear all bands" floating over the level
 * grid (`.lab` hides #top), and the splash's dot strip floating over "Turn
 * your phone upright" (the rotate rule hides #hud).
 *
 * The rule: `hidden` to hide, `inherit` to re-show, `visible` never.
 *
 * Goomba ONLY: hex's cat is a pose-frame DOM sprite where `visible` under a
 * hidden parent is the mechanism itself; lobby and chat use no visibility.
 *
 * Run: node scripts/check-visibility.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, extname } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Only goomba — see the header. */
const ROOTS = ["apps/goomba-glider"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const EXTS = new Set([".html", ".css", ".js", ".jsx", ".ts", ".tsx"]);

/** CSS `visibility: visible`, and the JS form `style.visibility = "visible"`. */
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
