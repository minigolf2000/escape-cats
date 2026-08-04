// ?solo practice mode: the SAME shared HexSim the server runs, in-page. This
// replaces the old single-file prototype as the tuning bench — one sim, one
// set of rules, whichever side of the wire it runs on.

import { HexSim, type HexSnapshot } from "@escape-cats/shared";
import { transport } from "./net";

const TICK_MS = 250;

export function startSolo(opts: {
  onSnapshot: (snap: HexSnapshot) => void;
}): void {
  const sim = new HexSim(Date.now());

  // ?speed=N accelerates a practice run (income + golden cadence, never click
  // feel) — the solo stand-in for the proctor's dev dial.
  const speed = Number(new URLSearchParams(location.search).get("speed"));
  if (Number.isFinite(speed) && speed > 0) sim.state.speed = Math.min(50, speed);

  const snapshot = (): HexSnapshot => ({
    ...sim.state,
    players: [],
    serverTime: Date.now(),
    progress: sim.progress(),
    codeword: sim.state.legibleAt ? "TO THE MOON" : null,
  });

  let pendingPets = 0;
  setInterval(() => {
    const now = Date.now();
    if (pendingPets > 0) {
      sim.pets(pendingPets, now);
      pendingPets = 0;
    }
    sim.tick(now);
    opts.onSnapshot(snapshot());
  }, TICK_MS);

  transport.queuePet = () => {
    pendingPets++;
  };
  // First snapshot synchronously: the page must be fully interactive (gate
  // down, pet listener live) before the first finger lands, not a tick later.
  opts.onSnapshot(snapshot());

  transport.send = (msg) => {
    const now = Date.now();
    if (pendingPets > 0) {
      sim.pets(pendingPets, now);
      pendingPets = 0;
    }
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
        sim.reset(now);
        break;
    }
    opts.onSnapshot(snapshot());
  };
}
