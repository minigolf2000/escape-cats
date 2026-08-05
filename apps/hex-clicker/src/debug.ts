// ?debug practice mode: the SAME shared HexSim the server runs, in-page. This
// replaces the old single-file prototype as the tuning bench — one sim, one
// set of rules, whichever side of the wire it runs on.

import { HexSim, SNAPSHOT_TICK_MS, type HexSnapshot } from "@escape-cats/shared";
import { transport } from "./net";

export function startDebug(opts: {
  onSnapshot: (snap: HexSnapshot) => void;
  onPetAck: (seq: number) => void;
}): void {
  const sim = new HexSim(Date.now());

  // ?speed=N accelerates a practice run (income + golden cadence, never click
  // feel) — the ?debug stand-in for the proctor's dev dial.
  const speed = Number(new URLSearchParams(location.search).get("speed"));
  if (Number.isFinite(speed) && speed > 0) sim.state.speed = Math.min(50, speed);

  let pendingPets = 0;
  let batchSeq = 0;
  const flushPets = (now: number) => {
    if (pendingPets > 0) {
      sim.pets(pendingPets, now);
      pendingPets = 0;
      // Ack before the snapshot that carries them, exactly as the room does.
      opts.onPetAck(++batchSeq);
    }
  };
  const emit = () => opts.onSnapshot(sim.snapshot(Date.now(), []));

  setInterval(() => {
    flushPets(Date.now());
    sim.tick(Date.now());
    emit();
  }, SNAPSHOT_TICK_MS);

  // First snapshot synchronously: the page must be fully interactive (gate
  // down, pet listener live) before the first finger lands, not a tick later.
  emit();

  transport.queuePet = () => {
    pendingPets++;
    return batchSeq + 1;
  };
  transport.send = (msg) => {
    const now = Date.now();
    // Purchases must land AFTER the taps already queued, or the sim may
    // reject them for a bank the pets have actually filled.
    flushPets(now);
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
    emit();
  };
}
