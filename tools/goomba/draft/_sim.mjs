// The draft bench's physics bridge: the shipped physics, codec and levels,
// bundled for `draft.mjs`. `../lib.mjs` exposes no physics on purpose and this
// does not loosen that rule — a draft is a level whose numbers are still being
// SWEPT, and nothing in draft.mjs prints a pass, a fail or a score. The verdict
// is `draft.mjs link`, played.
//
// A `draft/` file whose name starts with `_` is infrastructure, not a draft
// (the Figma kit's `_gauge` convention).
import { build } from "esbuild";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDir = resolve(
  dirname(fileURLToPath(import.meta.url)), "..", "..", "..",
  "packages", "shared", "src", "goomba",
);
const dir = await mkdtemp(join(tmpdir(), "goomba-draft-"));
const entry = join(dir, "entry.ts");
await writeFile(
  entry,
  `export * from ${JSON.stringify(join(srcDir, "levels.ts"))};\n` +
  `export * from ${JSON.stringify(join(srcDir, "physics.ts"))};\n` +
  `export * from ${JSON.stringify(join(srcDir, "codec.ts"))};\n`,
);
const outfile = join(dir, "sim.mjs");
await build({ entryPoints: [entry], bundle: true, format: "esm", outfile, logLevel: "silent" });
const sim = await import(pathToFileURL(outfile).href);

export const {
  makeRun, stepRun, snapBand, SUB, RUN_MAX, initLevel, encodeLevel, decodeLevel,
  // The ONE popper speed and its fire fraction. A draft aims with these; it
  // cannot choose them (`POP_SPD` in packages/shared/src/goomba/levels.ts).
  POP_SPD, POP_FIRE, MAX_SPEED,
} = sim;
