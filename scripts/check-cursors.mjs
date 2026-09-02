/**
 * Fail the build if a PLAYER-FACING app uses any cursor other than `pointer`
 * or `default`: `pointer` if a tap does something, `default` if it does not.
 * These are phone games — almost nobody playing has a cursor, so a third
 * value cannot carry information and can only be inconsistent.
 *
 * NOT applied to apps/proctor or tools/: they run on a laptop in front of one
 * operator (`grab`/`grabbing` for the proctor's drag, `crosshair`/`text` for
 * qr-studio). ROOTS lists the player-facing apps; a new app belongs in it
 * only if players open it.
 *
 * Run: node scripts/check-cursors.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, extname } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Player-facing apps only — see the header. */
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
