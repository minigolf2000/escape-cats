// The one bridge between the level tools and the SHIPPED physics: bundles
// packages/shared/src/goomba (TypeScript) with esbuild on the fly and exposes
// the same handles the deleted prototype used to hang on `window.__gr` — so
// every tool exercises exactly the sim the server scores runs with. No browser
// involved: the sim is pure code, and node runs it ~100× faster than the old
// Playwright round-trips did.
import { build } from "esbuild";
import { mkdtemp, writeFile } from "node:fs/promises";
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
  `export * from ${JSON.stringify(join(srcDir, "physics.ts"))};\n` +
  // codec.ts, so the bench can open a level that arrived as a share link from
  // the editor instead of as a diff to levels.ts.
  `export * from ${JSON.stringify(join(srcDir, "codec.ts"))};\n` +
  // pack.ts: the level PACK — the shape the game's levels live in now (a list
  // of links in the lobby DO). The bench needs it to seed itself, and to grade
  // a pack that was never committed.
  `export * from ${JSON.stringify(join(srcDir, "pack.ts"))};
` +
  // gate.ts: the thresholds that define "passes", shared with the editor.
  `export * from ${JSON.stringify(join(srcDir, "gate.ts"))};\n` +
  // sim.ts too, so the ROOM rules (the band quota) are testable off the same
  // bundle as the physics — the same files shared/src/index.ts re-exports.
  `export * from ${JSON.stringify(join(srcDir, "sim.ts"))};\n`,
);
const outfile = join(dir, "sim.mjs");
await build({ entryPoints: [entry], bundle: true, format: "esm", outfile, logLevel: "silent" });
const sim = await import(pathToFileURL(outfile).href);

export const {
  GOOMBA_LEVELS: LEVELS,
  GoombaSim,
  activePlayerCount,
  bandQuota,
  bandsHeldBy,
  canPlaceBand,
  BAND_MAX,
  BAND_MIN,
  MAX_BANDS,
  SUB,
  RUN_MAX,
  makeRun,
  stepRun,
  snapBand,
  bandPoints,
  encodeLevel,
  decodeLevel,
  initLevel,
  legalBands,
  mulberry,
  jitterSolution,
  JITTER_TRIALS,
  JITTER_MIN_WINS,
  JITTER_SEED,
  applyPack,
  seedPack,
  packToLevels,
  levelsToPack,
  SEED_LEVELS,
} = sim;

/**
 * Fill the level array before any tool indexes it.
 *
 * `GOOMBA_LEVELS` ships EMPTY now — the game's levels live in the lobby DO and
 * arrive over the wire — so `verify.mjs 2` would otherwise grade nothing. The
 * bench loads the repo's own SEED_LEVELS, which are the levels every note in
 * DESIGNING.md is written about, so `verify.mjs <idx>` means exactly what it
 * always meant.
 *
 * To grade the levels an EVENT is actually running, hand the tool a pack:
 * `verify.mjs --pack pack.json` (or `--hash <link>` for a single one), which
 * calls `usePack` below and re-indexes everything against that instead.
 */
applyPack(seedPack());

/**
 * Point the bench at a different pack — a file of links, or one pulled off a
 * running lobby. Returns how many levels are now loaded.
 *
 * `LEVELS` IS `sim.GOOMBA_LEVELS` (the destructure above binds the same array
 * object, not a copy), and `applyPack` fills that array in place. So there is
 * nothing to copy here — and copying was actively wrong: clearing `LEVELS`
 * first emptied the very array the copy then read from.
 */
export function usePack(pack) {
  return applyPack(pack);
}

/** The prototype's `__gr.simulate`, verbatim: run a level with a band set,
 * return the outcome plus a 30fps trajectory. */
export function simulate(li, bandPairs) {
  return simulateLevel(LEVELS[li], bandPairs);
}

/** The same run on a level OBJECT — for levels that aren't in the array, like
 * an editor share link `verify.mjs --hash` is gating. */
export function simulateLevel(L, bandPairs) {
  const bands = (bandPairs || []).map(([a, b]) =>
    snapBand(L, { ax: a[0], ay: a[1], bx: b[0], by: b[1] }));
  const st = makeRun(L, bands);
  const traj = [];
  let acc = 0;
  while (!st.result && st.t < RUN_MAX + 1) {
    stepRun(st, SUB);
    acc += SUB;
    if (acc >= 1 / 30) { acc = 0; traj.push([+st.p.x.toFixed(2), +st.p.y.toFixed(2)]); }
  }
  return { result: st.result || "timeout", t: +st.t.toFixed(2), traj };
}

/** Full-detail run for ride cards: dense path with grounded flags, airborne
 * seconds, top speed, and the mechanic events that fired. */
export function rideTrace(li, bandPairs) {
  const L = LEVELS[li];
  const bands = (bandPairs ?? L.solution ?? []).map(([a, b]) =>
    snapBand(L, { ax: a[0], ay: a[1], bx: b[0], by: b[1] }));
  const st = makeRun(L, bands);
  const path = [];
  let acc = 0, top = 1e9, fastest = 0, air = 0;
  while (!st.result && st.t < RUN_MAX + 1) {
    const wasGround = st.grounded;
    stepRun(st, SUB);
    if (!wasGround) air += SUB;
    top = Math.min(top, st.p.y);
    fastest = Math.max(fastest, Math.hypot(st.v.x, st.v.y));
    acc += SUB;
    if (acc >= 1 / 60) { acc = 0; path.push([st.p.x, st.p.y, st.grounded ? 1 : 0]); }
  }
  return {
    L, bands, path, events: st.events, end: { x: st.p.x, y: st.p.y },
    result: st.result ?? "timeout", t: +st.t.toFixed(2),
    airPct: +((100 * air) / Math.max(st.t, 0.01)).toFixed(0),
    topSpeed: +fastest.toFixed(0),
    cans: `${st.gotN}/${L.cans.length}`,
  };
}
