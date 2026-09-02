// Bundles `packages/shared/src/goomba` (TypeScript) with esbuild on the fly, so
// these tools share the shipped codec, pack rules and room sim rather than a
// copy. It exposes NO grading: physics rides along because `sim.ts` imports it,
// and nothing here offers a way to run it — a level is evaluated by people
// playing it. The draft bench's physics bridge is `draft/_sim.mjs`.
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
  // codec.ts + pack.ts: a level is a link and a pack is a list of them.
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
  // Collision radii, so read-frame.mjs measures a drawing with the game's own
  // numbers.
  R,
  BUMP_R,
  POP_R,
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
 * Fill the level array from a PACK. The repo holds no levels (a level's source
 * is its Figma frame; an event's levels are links in its lobby), so:
 *
 *   node seed.mjs --pull > pack.json    then no flag is needed (gitignored)
 *   --pack <file>                       per-run
 *   GOOMBA_PACK=<file>                  for a whole session
 *
 * `--pack` is spliced OUT of `process.argv` here, before any tool's own argument
 * parsing runs (imports evaluate first), so positional readers never see it.
 */
const packArgAt = process.argv.indexOf("--pack");
const packFile = packArgAt > 1 && process.argv[packArgAt + 1]
  ? process.argv.splice(packArgAt, 2)[1]
  : process.env.GOOMBA_PACK || join(dirname(fileURLToPath(import.meta.url)), "pack.json");
export const packSource = existsSync(packFile) ? packFile : null;
if (packSource) applyPack(JSON.parse(await readFile(packSource, "utf8")));

/**
 * The level at `<idx>`, or a message a person can act on — stderr + exit(2),
 * not a throw, like every other bad-argument path here.
 */
export function levelAt(li) {
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

// `LEVELS` IS `sim.GOOMBA_LEVELS` and `applyPack` fills it IN PLACE; swapping
// the binding instead would strand every module holding the old array.

/**
 * Every index in the loaded pack, or `levelAt`'s guidance when there is none —
 * a sweep over "all levels" must not run cleanly over nothing.
 */
export function allIndexes() {
  if (!LEVELS.length) levelAt(0); // prints the how-to and exits
  return LEVELS.map((_, i) => i);
}
