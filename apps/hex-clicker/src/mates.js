// Teammates' taps, replayed with their real rhythm.
//
// Asymmetric on purpose. YOUR tap pops instantly at your fingertip (pet.js) —
// latency is felt where your own thumb is. A teammate's tap is only observed,
// so it goes through a jitter buffer instead: every tap carries the server time
// it was applied, and each phone renders it at that time plus a fixed delay on
// its own synced clock. Uniformly late, but the spacing between taps survives.
//
// Fighting games delay every player equally, including the local one, because a
// competitive match has to be fair. This is co-op — nobody is racing anybody —
// so we can keep local input instant and buffer only what's watched.
//
// The alternative was sending a per-tick COUNT, which would have arrived as
// lumps of 2-3 and needed fake spacing to look alive. Timestamps mean the
// transport rate stops mattering: even clumped, each tap lands on its own beat.

import { stageEl } from "./dom.js";
import { hexCatEl } from "./dom.js";
import { spawnMousePop } from "./fx.js";
import { MOUSE_COLOR_LIST } from "./art.js";

// Must exceed the worst path from a teammate's finger to this phone:
// PET_FLUSH_MS (100) + SNAPSHOT_TICK_MS (250) + a round trip. Anything that
// still arrives late is drawn immediately, which costs that one tap its
// spacing — so the margin is deliberately generous.
const DELAY_MS = 600;

/** One hue per roster slot, so a teammate's mice read as theirs. */
const SLOT_COLORS = MOUSE_COLOR_LIST;

/** {dueAt: perfNow, slot} — sorted by arrival, drained in order. */
let queue = [];

export function clearMateTaps() {
  queue = [];
}

/**
 * @param taps      TapEvent[] from the snapshot (server time)
 * @param serverTime the snapshot's server clock, for converting onto this device
 * @param mySlot    this phone's roster slot; its own taps already popped
 */
export function enqueueMateTaps(taps, serverTime, mySlot) {
  if (!taps || taps.length === 0) return;
  const base = performance.now() - serverTime;
  for (const t of taps) {
    if (t.slot === mySlot) continue;
    queue.push({ dueAt: base + t.at + DELAY_MS, slot: t.slot });
  }
  // A tick can carry taps out of order across players; the drain assumes sorted.
  queue.sort((a, b) => a.dueAt - b.dueAt);
  // Never let a stall build an unbounded backlog that would burst on recovery.
  if (queue.length > 120) queue = queue.slice(-120);
}

/** Call once per frame. Pops every tap whose moment has arrived. */
export function updateMateTaps() {
  if (queue.length === 0) return;
  const now = performance.now();
  const r = hexCatEl.getBoundingClientRect();
  const s = stageEl.getBoundingClientRect();
  while (queue.length && queue[0].dueAt <= now) {
    const { slot } = queue.shift();
    // No coordinates on the wire: every tap landed on Hex, who is in the same
    // place on every phone. A little scatter keeps them from stacking.
    const x = r.left - s.left + r.width * (0.35 + Math.random() * 0.3);
    const y = r.top - s.top + r.height * (0.3 + Math.random() * 0.3);
    spawnMousePop(x, y, SLOT_COLORS[slot % SLOT_COLORS.length]);
  }
}
