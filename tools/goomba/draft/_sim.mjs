// The draft bench's own bridge to the shipped physics.
//
// `../lib.mjs` deliberately does NOT expose one. Its comment is emphatic and it
// is right: a node-side rig that GRADED levels — verify, route, slack, solve,
// minbands, reach, scan — was deleted along with the gate it served, because
// "does this level pass" is a question people playing it answer and a script
// does not. Nothing about that decision is being reopened here, which is why
// this file exists instead of a line being added over there.
//
// What a draft needs is a different thing, and the distinction is the whole
// justification: a draft is a level whose numbers are still being SWEPT. "Where
// does this popper go" and "how wide does this doorway have to be" are answered
// by running the same geometry thirty times with one number changed, and the
// answer is a shape, not a verdict. `draft.mjs` never prints a pass, a fail, a
// score or a minimum band count. The verdict is `draft.mjs link`.
//
// A file under `draft/` whose name starts with `_` is infrastructure, not a
// draft — the same convention the Figma layer contract uses for `_gauge`.
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
} = sim;
