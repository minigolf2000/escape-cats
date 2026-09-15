// THE BACKEND: the shared `HexSim`, running in this tab, answering intents.
//
// It is the room server's job, minus the room — same sim, same intents, same
// snapshots, so nothing upstream of `transport` can tell the difference. What
// the Durable Object did with `ctx.storage`, this does with localStorage; what
// it did by broadcasting on a tick, this does by calling `onSnapshot`.
//
// EVERY emit flushes first. The tap path queues pets and credits the counter
// optimistically (`state.js`), and `applySnapshot` spends that credit on
// arrival — which is only right if every snapshot already contains every
// queued tap. A snapshot emitted without flushing would spend credit for taps
// the sim had not counted, and the bank would tick backwards — so there is
// ONE emit and it does both, rather than a rule for callers to keep.

import { HexSim, SNAPSHOT_TICK_MS, type HexSnapshot } from "@escape-cats/shared";
import type { HexPersistedV1 } from "@escape-cats/shared";
import { transport } from "./transport";

const SAVE_KEY = "hex-save";

/** How often the save is written. Not every tick: hex banks income four times
 * a second forever, and the sim's own restore already credits the unsaved tail
 * (`OFFLINE_CREDIT_MS`), so a few seconds of drift costs nothing a player can
 * see. Purchases are not special-cased for the same reason. */
const SAVE_MS = 5_000;

/** localStorage is occasionally ABSENT (a private window throws on write) and
 * is hand-editable. Read answers with null, write is allowed to fail: a game
 * that cannot save is still a game. */
function load(): HexPersistedV1 | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as HexPersistedV1;
    return p && p.v === 1 && p.core ? p : null;
  } catch {
    return null;
  }
}

export function startBackend(opts: {
  onSnapshot: (snap: HexSnapshot) => void;
  /** Mount the 🛠 panel on this sim. `?debug` only — passed in rather than
   * imported, so the panel's whole module stays out of a normal player's
   * bundle. */
  onSim?: (sim: HexSim, emit: () => void) => (() => void) | void;
}): void {
  const sim = new HexSim(Date.now());

  const saved = load();
  if (saved) {
    try {
      sim.restore(saved, Date.now());
    } catch {
      // A save from an older shape, or one somebody hand-edited. Starting over
      // beats refusing to boot.
    }
  }

  // ?speed=N accelerates a run (income + golden cadence, never click feel) —
  // the ?debug stand-in for the proctor's old dev dial. Applied after restore,
  // because `speed` is deliberately not persisted.
  const speed = Number(new URLSearchParams(location.search).get("speed"));
  if (Number.isFinite(speed) && speed > 0) sim.state.speed = Math.min(50, speed);

  let pendingPets = 0;
  let lastSaveAt = 0;
  /** The run the last save belonged to. Starting over has to reach the disk
   * NOW, not at the next throttled write — otherwise a reload hands the old
   * run straight back. Keyed on `runId` rather than handled in the `reset`
   * intent, because the 🛠 panel resets the sim DIRECTLY (that is what the
   * bench is) and never passes through an intent at all. One rule, both
   * paths. */
  let savedRunId = -1;

  const emit = () => {
    const now = Date.now();
    if (pendingPets > 0) {
      sim.pets(pendingPets, now);
      pendingPets = 0;
    }
    // Income up to the instant the snapshot is STAMPED: a bank counted at the
    // last tick but stamped now is a bank the page then has to count backwards
    // to. Every path that emits goes through here, so none can forget.
    sim.tick(now);
    const snap = sim.snapshot(now);
    if (now - lastSaveAt >= SAVE_MS || sim.state.runId !== savedRunId) {
      lastSaveAt = now;
      savedRunId = sim.state.runId;
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(sim.persisted(now)));
      } catch {
        /* see load(): a game that cannot save is still a game */
      }
    }
    opts.onSnapshot(snap);
  };

  // Mounted before the loop, because the loop is what keeps the panel's
  // day-only controls in step with the phase: the twist lands on a PURCHASE,
  // which never passes through the panel's own click handler.
  const syncPanel = opts.onSim?.(sim, emit);

  setInterval(() => {
    emit();
    syncPanel?.();
  }, SNAPSHOT_TICK_MS);

  // First snapshot synchronously: the page must be fully interactive (gate
  // down, pet listener live) before the first finger lands, not a tick later.
  emit();

  transport.queuePet = () => {
    pendingPets++;
  };
  transport.send = (msg) => {
    const now = Date.now();
    switch (msg.type) {
      case "buyBuilding":
        sim.buyBuilding(msg.id, now);
        break;
      case "buyUpgrade":
        sim.buyUpgrade(msg.key, now);
        break;
      case "catchGold":
        sim.catchGold(msg.id, now);
        break;
      case "reset":
        // No removeItem: `emit` below writes the fresh run immediately, because
        // the reset bumped `runId` (see savedRunId). Deleting the key and then
        // letting the next emit re-create it was two ways to say one thing, and
        // only one of them covered the panel's direct reset.
        sim.reset(now);
        break;
    }
    // A purchase must land AFTER the taps already queued, or the sim rejects it
    // for a bank those taps have actually filled. `emit` flushes first, so this
    // one call is both the fix and the broadcast.
    emit();
  };

  // Console handle on the AUTHORITY, not the mirror: window.__hex.game is the
  // render mirror, so tuning work and tests assert against the sim itself.
  (window as unknown as { __hexSim: HexSim }).__hexSim = sim;
}
