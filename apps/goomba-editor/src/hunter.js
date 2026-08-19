// Driver for the shortcut hunt: a pool of workers, restarted whenever the
// level changes, reporting one aggregate verdict.
//
// The hunt is the editor's slow verdict and its most valuable one, so it is
// deliberately never in the way: it starts itself after the drags stop, it can
// be interrupted by the next edit, and finding nothing is reported as coverage
// ("no 1-band win in 13262 placements") rather than as a green tick — because
// sampling 2- and 3-band sets is evidence, not proof. The proof is
// `node verify.mjs`, and the UI says so.
import { encodeLevel } from "@escape-cats/shared";

/** Browser budgets, smaller than verify.mjs's: this runs on every edit, and a
 * hunt that never finishes teaches nobody anything. The bench still runs the
 * big numbers before a level ships. */
const SAMPLES = { 2: 12000, 3: 8000 };

/** Leave the machine a core to draw with. Six is plenty — past that the
 * workers spend their time competing for memory bandwidth. */
const POOL = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));

export function createHunter(onUpdate) {
  let workers = [];
  let state = null;
  let restartTimer = null;

  const emit = () => onUpdate(state);

  const stop = () => {
    for (const w of workers) w.terminate();
    workers = [];
  };

  /** Start a hunt on this level, abandoning any hunt in flight. */
  function run(level) {
    stop();
    const hash = encodeLevel(level);
    state = {
      running: true,
      found: null,
      checked: 0,
      legal: 0,
      total: 0,
      stagesDone: 0,
      pool: POOL,
    };
    emit();

    const per = new Array(POOL).fill(0);
    let finished = 0;
    // Stage completions are counted across the pool: stage 1 is only really
    // clear once every shard of it is.
    const stageDone = new Array(4).fill(0);

    for (let i = 0; i < POOL; i++) {
      const w = new Worker(new URL("./hunter.worker.js", import.meta.url), { type: "module" });
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === "ready") {
          if (!state.legal) {
            state.legal = m.legal;
            state.total = m.legal + SAMPLES[2] + SAMPLES[3];
          }
          return emit();
        }
        if (m.type === "found") {
          // First find wins: the rest of the pool is now searching for a
          // second way to break a level we already know is broken.
          state.found = { bands: m.bands, stage: m.stage };
          state.running = false;
          stop();
          return emit();
        }
        if (m.type === "progress" || m.type === "stage-done" || m.type === "done") {
          per[i] = m.checked;
          state.checked = per.reduce((a, b) => a + b, 0);
        }
        if (m.type === "stage-done") {
          stageDone[m.stage]++;
          state.stagesDone = [1, 2, 3].filter((k) => stageDone[k] >= POOL).length;
        }
        if (m.type === "done") {
          finished++;
          if (finished >= POOL) state.running = false;
        }
        emit();
      };
      w.postMessage({ hash, shard: i, shards: POOL, samples: SAMPLES });
      workers.push(w);
    }
  }

  return {
    /** Edits call this; the hunt starts once they stop. Restarting is cheap
     * and abandoning a stale hunt is mandatory — a verdict about the level as
     * it was three drags ago is worse than no verdict. */
    schedule(level, delay = 700) {
      clearTimeout(restartTimer);
      stop();
      state = { running: false, found: null, checked: 0, legal: 0, total: 0, stagesDone: 0, pool: POOL, pending: true };
      emit();
      restartTimer = setTimeout(() => run(level), delay);
    },
    cancel() {
      clearTimeout(restartTimer);
      stop();
      state = null;
      emit();
    },
    samples: SAMPLES,
  };
}
