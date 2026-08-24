// The one bridge between what is left of these tools and the SHIPPED code:
// bundles `packages/shared/src/goomba` (TypeScript) with esbuild on the fly, so
// nothing here carries a second copy of the codec, the pack rules or the room
// sim. No browser involved.
//
// It used to bridge to the PHYSICS, for a bench that simulated levels: verify,
// route, trace, slack, solve, minbands, reach, scan, search, robust, diag,
// searchall, ridecards — a node-side rig that graded a level before anyone
// played it. That bench is deleted, and with it the gate it served. Levels are
// evaluated by people playing them.
//
// What still needs the bridge is not about levels at all: `test-codec.mjs` (the
// save format), `bands.mjs` (the room hands out four bands and rations nobody)
// and `figma/levels-to-svg.mjs` (draw a pack as artboards). Physics still comes
// along inside the bundle because `sim.ts` imports it — but nothing here
// exposes a way to run it, which is the point.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = join(repoRoot, "packages", "shared", "src", "goomba");

const dir = await mkdtemp(join(tmpdir(), "goomba-sim-"));
const entry = join(dir, "entry.ts");
await writeFile(
  entry,
  `export * from ${JSON.stringify(join(srcDir, "levels.ts"))};\n` +
  // codec.ts + pack.ts: a level is a link and a pack is a list of them, which
  // is the only shape a level travels in now.
  `export * from ${JSON.stringify(join(srcDir, "codec.ts"))};\n` +
  `export * from ${JSON.stringify(join(srcDir, "pack.ts"))};\n` +
  // sim.ts: the ROOM rules, for the one test that drives them (bands.mjs).
  `export * from ${JSON.stringify(join(srcDir, "sim.ts"))};\n`,
);
const outfile = join(dir, "sim.mjs");
await build({ entryPoints: [entry], bundle: true, format: "esm", outfile, logLevel: "silent" });
const sim = await import(pathToFileURL(outfile).href);

export const {
  GOOMBA_LEVELS: LEVELS,
  GoombaSim,
  canPlaceBand,
  MAX_BANDS,
  encodeLevel,
  decodeLevel,
  initLevel,
  applyPack,
  packToLevels,
  levelsToPack,
} = sim;

/**
 * Fill the level array from a PACK, for the one caller that still indexes
 * levels: `figma/levels-to-svg.mjs`, which draws each one as an artboard.
 *
 * There is nothing else to fill it from. The repo holds no levels — a level's
 * source is the Figma frame it was drawn in, and what an event plays is a pack
 * of links in its lobby — so:
 *
 *   node seed.mjs --pull > pack.json    then the tool needs no flag
 *   --pack <file>                       explicit, per-run
 *   GOOMBA_PACK=<file>                  for a whole session
 *
 * `pack.json` beside these tools is gitignored: a pack is what an event is
 * running right now, not something the repo has an opinion about.
 *
 * `--pack <file>` is spliced OUT of `process.argv` here, before any tool's own
 * argument parsing runs (imports evaluate first), so a tool that reads its
 * arguments positionally never sees it.
 */
const packArgAt = process.argv.indexOf("--pack");
const packFile = packArgAt > 1 && process.argv[packArgAt + 1]
  ? process.argv.splice(packArgAt, 2)[1]
  : process.env.GOOMBA_PACK || join(dirname(fileURLToPath(import.meta.url)), "pack.json");
export const packSource = existsSync(packFile) ? packFile : null;
if (packSource) applyPack(JSON.parse(await readFile(packSource, "utf8")));

/**
 * The level at `<idx>`, or an error a person at a terminal can act on.
 *
 * With no pack loaded, indexing is `undefined.bounds` — a stack trace that says
 * nothing about the one thing that is actually wrong. "I ran it and it exploded"
 * is a report nobody can act on, so this is the message instead.
 */
export function levelAt(li) {
  // stderr + exit(2), not a throw: these are commands run by a person at a
  // terminal, and every other bad-argument path here already answers that way.
  // A stack trace would bury the one line worth reading.
  if (!LEVELS.length) {
    console.error(packSource
      ? `${packSource} decoded to an empty pack — no levels to work on`
      : "no levels loaded. There are no levels in this repo: a level's source is\n" +
        "its Figma frame, and an event's levels live in its lobby. Point this at a\n" +
        "pack, any of three ways —\n" +
        "  node seed.mjs --pull > pack.json   (then this command needs no flag)\n" +
        "  --pack <file>                      per-run\n" +
        "  GOOMBA_PACK=<file>                 for a whole session");
    process.exit(2);
  }
  const L = LEVELS[li];
  if (!L) {
    console.error(`no level at index ${li} — ${packSource ?? "the pack"} holds ` +
      `${LEVELS.length} (0..${LEVELS.length - 1})`);
    process.exit(2);
  }
  return L;
}

// `usePack(pack)` used to live here, for a tool that wanted to re-point the
// bench mid-run. Nothing calls it now that loading a pack is the only way the
// bench gets levels at all — it happens once, above, before any tool's own code
// runs. `LEVELS` IS `sim.GOOMBA_LEVELS` and `applyPack` fills it IN PLACE,
// which is the part worth keeping written down: a caller that tried to swap the
// binding instead would strand every module holding the old array.

/**
 * Every index in the loaded pack — and `levelAt`'s guidance instead when there
 * is none.
 *
 * A tool that sweeps "all levels" must not run cleanly over nothing: an SVG of
 * a pack that silently came out empty is a file you notice much later than an
 * error you get right now.
 */
export function allIndexes() {
  if (!LEVELS.length) levelAt(0); // prints the how-to and exits
  return LEVELS.map((_, i) => i);
}
