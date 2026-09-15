// THE BACKEND: the shared `GoombaSim`, running in this tab, answering intents.
//
// It is the room server's job, minus the room — same sim, same intents, same
// snapshots, so nothing upstream of `transport` can tell the difference. What
// the Durable Object did with `ctx.storage`, this does with localStorage
// (`library.js`), and what it did by broadcasting, this does by calling
// `onSnapshot` synchronously inside `send()`.
//
// The two things worth not "simplifying" later:
//
//   `runAt` stays a TIMESTAMP and run-end stays a lazy comparison
//   (`sim.resolve(now)`). It is tempting to animate off a local start now that
//   there is no server clock, but the timestamp is what makes a backgrounded
//   tab — one that misses every rAF for a minute — resolve correctly the
//   instant it comes back.
//
//   `reconcile` is still needed. The level list still changes under a live
//   page, every time the power user pastes, deletes or reorders the overlay.

import { GoombaSim } from "@escape-cats/shared";
import { PLAYER_ID, transport } from "./transport";
import {
  completedNow,
  composeLibrary,
  loadProgress,
  loadState,
  overlayDelete,
  overlayMove,
  overlaySet,
  saveProgress,
  saveState,
} from "./library";

/** Fit the sim to the level list as it stands: the id-keyed projection goes in
 * as `reconcile`'s argument, which applies it before its own by-index re-fit
 * (the order, and why it matters, is documented on `reconcile`). */
const applyLibrary = (sim, now) => sim.reconcile(now, completedNow());

export function startBackend(opts) {
  const sim = new GoombaSim(Date.now());
  let runTimer = null;

  // The saved room: bands, level, phase. The PROGRESS record is read first and
  // handed to `restore`, which applies it before its own reconcile — the save's
  // `completed` is indexed against whatever list existed when it was written,
  // and reconciling on that stale array can drop a finished game's splash.
  const saved = loadState();
  loadProgress();
  let restored = false;
  if (saved && saved.v === 1) {
    try {
      sim.restore(saved, Date.now(), completedNow());
      restored = true;
    } catch {
      // A save from an older shape, or one somebody hand-edited. A fresh room
      // is a perfectly good answer and the id-keyed progress survives it.
    }
  }
  // `restore` projected and reconciled already; a fresh room still needs to.
  if (!restored) applyLibrary(sim, Date.now());

  const emit = () => {
    const now = Date.now();
    const snap = sim.snapshot(now);
    // Persist on the way out, so a tab closed on the win screen keeps the win.
    saveProgress(snap.completed, now);
    saveState(sim.persisted(now));
    opts.onSnapshot(snap);
  };

  /** The room server's `armRunTimer`, in miniature: one timeout so win/fail
   * lands in a tab nobody is touching. Everything else about run-end is lazy. */
  const armRunTimer = () => {
    const ms = sim.runEndsIn(Date.now());
    if (ms === null) return;
    clearTimeout(runTimer);
    runTimer = setTimeout(() => {
      runTimer = null;
      if (sim.resolve(Date.now())) emit();
    }, ms + 50);
  };

  /** An overlay edit: write it, rebuild the list, re-fit the room. Returns
   * whether anything changed, so a refused paste does not redraw the world. */
  const edited = (ok, now) => {
    if (!ok) return false;
    composeLibrary();
    applyLibrary(sim, now);
    opts.onPackChanged();
    return true;
  };

  transport.send = (msg) => {
    const now = Date.now();
    switch (msg.type) {
      case "place":
        sim.place(PLAYER_ID, msg, now);
        break;
      case "remove":
        sim.remove(msg.index, now);
        break;
      case "clear":
        sim.clear(now);
        break;
      case "play":
        sim.play(now);
        armRunTimer();
        break;
      case "stop":
        sim.stop(now);
        break;
      case "next":
        sim.next(now);
        break;
      case "goto":
        sim.goto(msg.level, now);
        break;
      // ---- the local overlay. Only the overlay: a shipped level is source,
      // and the way to change one is a commit (`library.js`, `overlayBase`).
      case "packSet":
        edited(overlaySet(msg.index, msg.hash) !== null, now);
        break;
      case "packDelete":
        edited(overlayDelete(msg.index), now);
        break;
      case "packMove":
        edited(overlayMove(msg.from, msg.to), now);
        break;
      default:
        return; // nothing to answer; don't redraw
    }
    emit();
  };

  // The first snapshot is synchronous, so the page is wired before boot
  // returns — same contract the socket backend reached asynchronously.
  emit();
}
