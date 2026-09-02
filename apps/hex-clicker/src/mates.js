// Teammates' taps, replayed with their real rhythm.
//
// Asymmetric on purpose. YOUR tap pops instantly at your fingertip (pet.js) —
// latency is felt where your own thumb is. A teammate's tap is only observed,
// so it goes through a jitter buffer: every tap carries the server time it was
// applied and renders at that time plus a fixed delay on this phone's synced
// clock. Uniformly late, but the spacing between taps survives, even when the
// transport clumps them. A tap also carries WHERE on Hex it landed, as a
// fraction of her box. Co-op, not a competitive match, so local input can stay
// instant and only what is watched is buffered.

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

/** {dueAt: perfNow, slot, x, y} — sorted by arrival, drained in order. x/y are
 * fractions of Hex's box, or undefined for a tap that carried no spot. */
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
    queue.push({ dueAt: base + t.at + DELAY_MS, slot: t.slot, x: t.x, y: t.y });
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
    const { slot, x, y } = queue.shift();
    // Fractions of Hex's box, not pixels: a tap on her ear is on her ear here
    // too, however big she renders. A tap with no spot (a client from before the
    // coordinates existed) scatters across her middle so identical taps don't stack.
    const u = x ?? 0.35 + Math.random() * 0.3;
    const v = y ?? 0.3 + Math.random() * 0.3;
    spawnMousePop(
      r.left - s.left + r.width * u,
      r.top - s.top + r.height * v,
      SLOT_COLORS[slot % SLOT_COLORS.length],
    );
  }
}
