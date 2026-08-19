// The editor's one door to the shipped physics.
//
// Nothing in here reimplements anything: `initLevel`, `snapBand`, `makeRun` and
// `stepRun` are the exact functions the room server scores a run with and the
// exact ones `tools/goomba/lib.mjs` bundles for the node bench. The editor
// exists to stop people designing against their intuition, so the one thing it
// must never do is simulate against its own copy of the rules.
import { RUN_MAX, SUB, initLevel, makeRun, snapBand, stepRun } from "@escape-cats/shared";

/** Deep copy — the editor's level is live data under a dozen drag handlers,
 * and `initLevel` writes derived fields into whatever it is handed. */
export const cloneLevel = (L) => ({
  ...L,
  start: [...L.start],
  goal: [...L.goal],
  terrain: L.terrain.map((poly) => poly.map((p) => [...p])),
  cans: (L.cans ?? []).map((p) => [...p]),
  cushions: (L.cushions ?? []).map((c) => ({ ...c })),
  pops: (L.pops ?? []).map((p) => ({ x: p.x, y: p.y, deg: p.deg, spd: p.spd })),
  bumpers: (L.bumpers ?? []).map((b) => ({ ...b })),
  solution: (L.solution ?? []).map(([a, b]) => [[...a], [...b]]),
});

/** An editable level, ready to simulate: cloned, then given its bounds, popper
 * aim vectors and start angle. */
export const prepare = (L) => initLevel(cloneLevel(L));

/** Band pairs (the `solution` shape) → the snapped band records the sim takes.
 * The room snaps at placement time, so a check that skipped this would be
 * grading a placement no player can actually make. */
export const toBands = (init, pairs) =>
  (pairs ?? []).map(([a, b]) =>
    snapBand(init, { ax: a[0], ay: a[1], bx: b[0], by: b[1] }),
  );

/** Run to completion and report only the outcome — the workhorse behind every
 * verdict and every shortcut hunt. */
export function runResult(init, pairs) {
  const st = makeRun(init, toBands(init, pairs));
  while (!st.result && st.t < RUN_MAX + 1) stepRun(st, SUB);
  return { result: st.result ?? "timeout", t: +st.t.toFixed(2), cans: st.gotN };
}

export const bandLen = ([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

