// ?debug — the shared GoombaSim running in-page, no server, no lobby. Same
// architecture as hex-clicker's debug mode: the game code sees snapshots
// arriving and intents leaving, and cannot tell there is no room behind them.
// The server validates everything in a real room, so shipping this costs
// nothing security-wise; it exists so a level designer can open the LEVEL LAB
// (see main.js) and poke any level on any phone straight from the deployed
// site — the multiplayer stand-in for the deleted prototype's 🔬 button.

import { GoombaSim } from "@escape-cats/shared";
import { transport } from "./net";

export function debugFromUrl() {
  return new URLSearchParams(location.search).has("debug");
}

export function startDebug(opts) {
  const sim = new GoombaSim(Date.now());
  let runTimer = null;

  const emit = () => {
    opts.onSnapshot(
      sim.snapshot(Date.now(), [{ id: "debug", name: "🔬 lab", connected: true }]),
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
      // Lab-only intent: jump straight to a level. Not in the wire protocol —
      // a real room progresses linearly and the server would ignore it.
      case "goto": {
        sim.resolve(now);
        sim.st.level = msg.level;
        sim.st.phase = "edit";
        sim.st.bands = [];
        sim.st.runAt = sim.st.runResult = sim.st.runT = null;
        sim.st.fails = 0;
        break;
      }
    }
    emit();
  };

  emit(); // synchronous first snapshot, so the page is wired before boot returns
}
