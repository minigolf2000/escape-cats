// The shortcut hunter, one shard of it.
//
// This is the check a designer cannot do by eye and a playtest cannot do at
// all. Playing a level proves a solution EXISTS; the party rule needs the
// opposite — that no solution smaller than four bands exists — and the only
// way to that is to try the small ones. Grand Finale shipped believing it was
// a 3-band level and turned out to have 380 different 1-band wins.
//
// So: exhaustive at one band on the same 10-unit grid verify.mjs uses, then
// random 2- and 3-band sets. It runs in a worker because it is seconds of
// straight-line arithmetic and the canvas has to keep dragging underneath it.
import { decodeLevel } from "@escape-cats/shared";
import { BAND_MAX, BAND_MIN, prepare, runResult } from "./sim.js";
import { mulberry } from "./sim.js";

/** Every legal single band on a 10-unit grid over the level's bounds — the
 * same enumeration verify.mjs check 5 walks, so a clean hunt here means the
 * same thing a clean check there does. */
function legalBands(init) {
  const b = init.bounds,
    pts = [];
  for (let x = b.x0; x <= b.x1; x += 10) for (let y = b.y0; y <= b.y1; y += 10) pts.push([x, y]);
  const legal = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const len = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
      if (len >= BAND_MIN && len <= BAND_MAX) legal.push([pts[i], pts[j]]);
    }
  return legal;
}

const REPORT_EVERY = 220; // sims between progress pings — often enough to look alive

self.onmessage = (e) => {
  const { hash, shard, shards, samples } = e.data;
  const L = decodeLevel(hash);
  if (!L) return self.postMessage({ type: "done", stage: 0, checked: 0 });
  const init = prepare(L);
  const legal = legalBands(init);
  // Tell the driver how big stage 1 is before starting it, so the progress bar
  // has a denominator that came from the level rather than from a guess.
  self.postMessage({ type: "ready", legal: legal.length });

  let checked = 0;
  const ping = (stage) => {
    if (checked % REPORT_EVERY === 0) self.postMessage({ type: "progress", stage, checked });
  };

  // Stage 1 — exhaustive at one band, this worker taking every Nth placement.
  // Shard by stride rather than by block so an early find is equally likely in
  // every worker, instead of always landing in whoever holds the top-left.
  for (let i = shard; i < legal.length; i += shards) {
    checked++;
    ping(1);
    if (runResult(init, [legal[i]]).result === "win") {
      self.postMessage({ type: "found", bands: [legal[i]], stage: 1 });
      return;
    }
  }
  self.postMessage({ type: "stage-done", stage: 1, checked });

  // Stages 2 and 3 — random sets from the same legal pool. Each shard gets its
  // own seed so the workers sample different sets, and each seed is fixed so a
  // hunt over an unchanged level always reports the same answer.
  for (const k of [2, 3]) {
    const rnd = mulberry(20260728 + shard * 7919 + k * 104729);
    const n = Math.ceil(samples[k] / shards);
    for (let t = 0; t < n; t++) {
      const set = [];
      for (let m = 0; m < k; m++) set.push(legal[(rnd() * legal.length) | 0]);
      checked++;
      ping(k);
      if (runResult(init, set).result === "win") {
        self.postMessage({ type: "found", bands: set, stage: k });
        return;
      }
    }
    self.postMessage({ type: "stage-done", stage: k, checked });
  }

  self.postMessage({ type: "done", checked });
};
