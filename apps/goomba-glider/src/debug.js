// The two debug switches — the tester's way into the cleared-room state
// (goombaCleared in goomba/sim.ts) without playing the game first:
//   ?solo   — the shared GoombaSim in-page, no server, no lobby; the game code
//             cannot tell there is no room behind it.
//   ?debug  — the REAL multiplayer game with the selector unlocked on THIS
//             phone; a card tap is a real room-wide `goto`. ?solo implies it.
// The server validates everything, so the override is a client-side gate only.

import {
  GOOMBA_LEVELS,
  GoombaSim,
  applyPack,
  currentPack,
  decodeLevel,
  initLevel,
} from "@escape-cats/shared";
import { transport, playerId } from "./net";

export function debugFromUrl() {
  const q = new URLSearchParams(location.search);
  return q.has("debug") || q.has("solo");
}

export function soloFromUrl() {
  return new URLSearchParams(location.search).has("solo");
}

/**
 * A level handed over in the URL hash, appended to `GOOMBA_LEVELS` (so every
 * rule plays it for real) and returned as its index. Must run before
 * `new GoombaSim`, which sizes `completed` from that array. Solo only — the
 * one kind of level not in the event's pack.
 */
export function adoptHashLevel() {
  if (location.hash.length <= 1) return null;
  const decoded = decodeLevel(location.hash.slice(1));
  if (!decoded) return null;
  const L = initLevel(decoded);
  L.pasted = true; // the selector's one visible difference
  GOOMBA_LEVELS.push(L);
  return GOOMBA_LEVELS.length - 1;
}

export function startDebug(opts) {
  const sim = new GoombaSim(Date.now());
  let runTimer = null;

  // A one-player room on this phone's REAL pid; it may lay all four bands.
  const pid = playerId();
  const emit = () => {
    opts.onSnapshot(
      sim.snapshot(Date.now(), [{ id: pid, name: "solo", connected: true }]),
    );
  };
  // The server's armRunTimer, in miniature: one timeout so win/fail lands
  // without another intent poking the sim.
  const armRunTimer = () => {
    const ms = sim.runEndsIn(Date.now());
    if (ms === null) return;
    clearTimeout(runTimer);
    runTimer = setTimeout(() => {
      sim.resolve(Date.now());
      emit();
    }, ms + 50);
  };

  transport.preview = () => {}; // no teammates in the lab
  transport.send = (msg) => {
    const now = Date.now();
    switch (msg.type) {
      case "preview":
        return; // presentation-only; nothing to show solo
      case "place":
        sim.place(pid, msg, now);
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
      case "reset":
        sim.reset(now);
        break;
      case "goto":
        sim.goto(msg.level, now);
        break;
      // The pack, edited with no server behind it: the four intents act on the
      // in-page list and `reconcile` fits the solo room to it as the real
      // room does.
      case "packSet": {
        const pack = currentPack();
        if (msg.index === null || msg.index === undefined) pack.push(msg.hash);
        else pack[msg.index] = msg.hash;
        applyPack(pack);
        sim.reconcile(now);
        break;
      }
      case "packMove": {
        const pack = currentPack();
        pack.splice(msg.to, 0, ...pack.splice(msg.from, 1));
        applyPack(pack);
        sim.reconcile(now);
        break;
      }
      case "packDelete": {
        const pack = currentPack().filter((_, i) => i !== msg.index);
        applyPack(pack);
        sim.reconcile(now);
        break;
      }
      case "packAll":
        applyPack(msg.pack);
        sim.reconcile(now);
        break;
    }
    emit();
  };

  // Open on the pasted level rather than level 1, so "play for real" lands on
  // the thing you just drew instead of making you find it in the grid.
  if (typeof opts.level === "number") sim.goto(opts.level, Date.now());
  emit(); // synchronous first snapshot, so the page is wired before boot returns
}
