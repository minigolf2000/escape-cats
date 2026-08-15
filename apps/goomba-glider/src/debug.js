// The two debug switches:
//   ?solo   — the shared GoombaSim running in-page, no server, no lobby (hex's
//             debug architecture: the game code sees snapshots arriving and
//             intents leaving, and cannot tell there is no room behind them).
//   ?debug  — the REAL multiplayer game plus the debug menu: the LEVELS grid
//             where tapping a card jumps the whole room (a real wire intent).
//             ?solo implies the menu too.
// The server validates everything in a real room, so shipping this costs
// nothing security-wise.

import { GoombaSim } from "@escape-cats/shared";
import { transport } from "./net";

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

  const emit = () => {
    opts.onSnapshot(
      sim.snapshot(Date.now(), [{ id: "debug", name: "solo", connected: true }]),
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
        sim.place("debug", 0, msg, now);
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
