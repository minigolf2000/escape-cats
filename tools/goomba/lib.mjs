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
  `export * from ${JSON.stringify(join(srcDir, "physics.ts"))};\n`,
);
const outfile = join(dir, "sim.mjs");
await build({ entryPoints: [entry], bundle: true, format: "esm", outfile, logLevel: "silent" });
const sim = await import(pathToFileURL(outfile).href);

export const {
  GOOMBA_LEVELS: LEVELS,
  BAND_MAX,
  BAND_MIN,
  SUB,
  RUN_MAX,
  makeRun,
  stepRun,
  snapBand,
  bandPoints,
} = sim;

/** The prototype's `__gr.simulate`, verbatim: run a level with a band set,
 * return the outcome plus a 30fps trajectory. */
export function simulate(li, bandPairs) {
  const L = LEVELS[li];
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
    plants: `${st.gotN}/${L.plants.length}`,
  };
}
