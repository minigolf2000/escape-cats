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

import { GoombaSim } from "@escape-cats/shared";
import { transport, playerId } from "./net";

export function debugFromUrl() {
  const q = new URLSearchParams(location.search);
  return q.has("debug") || q.has("solo");
}

export function soloFromUrl() {
  return new URLSearchParams(location.search).has("solo");
}

export function startDebug(opts) {
  const sim = new GoombaSim(Date.now());
  let runTimer = null;

  // A one-player room, and this phone's REAL pid: the band quota divides by
  // the roster, so the lab has to look like a room of one rather than a room
  // of nobody — ⌈4/1⌉ = 4, all four bands to the one player, which is exactly
  // what a solo bench wants.
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
        sim.place(pid, 0, msg, now, 1);
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
    }
    emit();
  };

  emit(); // synchronous first snapshot, so the page is wired before boot returns
}
