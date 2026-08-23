// The two debug switches. Neither one OWNS the levels grid any more: a team
// that clears every level earns it (goombaCleared in goomba/sim.ts), and these
// are the tester's way into that state without playing the game first.
//   ?solo   — the shared GoombaSim running in-page, no server, no lobby (hex's
//             debug architecture: the game code sees snapshots arriving and
//             intents leaving, and cannot tell there is no room behind them).
//   ?debug  — the REAL multiplayer game, with the level selector unlocked on
//             THIS phone as if the room had cleared: the LEVELS grid where
//             tapping a card jumps the whole room (a real wire intent).
//             ?solo implies the override too.
// The server validates everything in a real room, so shipping this costs
// nothing security-wise — the override is a client-side gate, and the `goto`
// behind it was always open to any player in the room.

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
 * A level handed over in the URL hash — the Figma paste target's "play for
 * real" lands here — appended to the level list and returned as its index.
 *
 * Appending to `GOOMBA_LEVELS` rather than teaching the sim about a second kind
 * of level is what makes this play for REAL: the placement rules, the phases,
 * the scoring and the animation all read that array and cannot tell the
 * difference. The one thing they must not do is disagree about
 * its LENGTH, so this has to run before `new GoombaSim`, which sizes
 * `completed` from it.
 *
 * Solo only, and now the ONE kind of level that is not in the event's pack:
 * everything else a phone plays arrives from the lobby over the room socket.
 * A link is how a level travels before anyone has committed it to the pack —
 * out of `verify.mjs`, off someone else's phone — so it stays.
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

  // A one-player room, on this phone's REAL pid — the roster line is drawn from
  // it, and a band carries it as a note of who laid it. Nothing divides the
  // four bands by headcount any more, so a solo bench lays all four exactly as
  // a full room's first player could.
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
      // The pack, edited with no server behind it. `?solo` is a laptop with no
      // room — but it is still the editor, so the same four intents have to
      // mean something here or the grid's buttons would be dead. They act on
      // the in-page level list directly; `reconcile` then fits the solo room to
      // it exactly as the real room does.
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
