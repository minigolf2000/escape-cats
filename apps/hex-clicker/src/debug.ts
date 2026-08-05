// ?debug mode: the SAME shared HexSim the server runs, in-page. This
// replaces the old single-file prototype as the tuning bench — one sim, one
// set of rules, whichever side of the wire it runs on. The floating 🛠 panel
// is the prototype's dev panel ported over, now driving SHIPPED balance; its
// controls call the sim directly, so nothing debug-only touches the wire
// protocol and none of this can reach a real room.

import {
  DEBUG_PRESETS,
  HexSim,
  SNAPSHOT_TICK_MS,
  type HexSnapshot,
} from "@escape-cats/shared";
import { transport } from "./net";

export function startDebug(opts: {
  onSnapshot: (snap: HexSnapshot) => void;
  onPetAck: (seq: number) => void;
}): void {
  const sim = new HexSim(Date.now());

  // ?speed=N accelerates a debug run (income + golden cadence, never click
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

  mountPanel(sim, emit);

  // Console handle on the AUTHORITY, not the mirror: window.__hex.game is the
  // render mirror and deliberately drops server-private fields (legibleAt), so
  // tuning work and tests assert against the sim itself.
  (window as unknown as { __hexSim: HexSim }).__hexSim = sim;
}

/** The floating 🛠 panel: grant, story-beat jumps, time scale, reset. DOM is
 * injected only here, so nothing panel-related ships into a real session. */
function mountPanel(sim: HexSim, emit: () => void): void {
  const st = document.createElement("style");
  st.textContent = `
    #devbar { position: fixed; top: max(10px, env(safe-area-inset-top)); right: 10px; z-index: 40;
      font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: #e8eaf0; }
    #devbar details { background: rgba(9,11,18,.92); border: 1px solid #363b4d;
      border-radius: 10px; padding: 4px 8px; }
    #devbar summary { cursor: pointer; user-select: none; opacity: .85; }
    #devbar .r { display: flex; gap: 4px; align-items: baseline; flex-wrap: wrap;
      margin: 4px 0; }
    #devbar .r > span { opacity: .55; min-width: 38px; }
    #devbar button { font: inherit; color: inherit; background: #1c2030;
      border: 1px solid #363b4d; border-radius: 6px; padding: 1px 7px;
      cursor: pointer; }
    #devbar button:active { background: #2a3049; }
  `;
  document.head.appendChild(st);

  const bar = document.createElement("div");
  bar.id = "devbar";
  const grants: [string, number][] = [
    ["+10K", 1e4],
    ["+1M", 1e6],
    ["+100M", 1e8],
  ];
  bar.innerHTML = `<details open><summary>🛠 debug</summary>
    <div class="r"><span>grant</span>${grants
      .map(([label, n]) => `<button data-g="${n}">${label}</button>`)
      .join("")}</div>
    <div class="r"><span>jump</span>${Object.keys(DEBUG_PRESETS)
      .map((k) => `<button data-p="${k}">${k}</button>`)
      .join("")}</div>
    <div class="r"><span>speed</span>${[1, 5, 20]
      .map((n) => `<button data-s="${n}">×${n}</button>`)
      .join("")}<button data-r="1">reset</button></div>
  </details>`;
  document.body.appendChild(bar);

  bar.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    const now = Date.now();
    if (b.dataset.g) sim.grant(Number(b.dataset.g), now);
    else if (b.dataset.p) sim.applyPreset(DEBUG_PRESETS[b.dataset.p], now);
    else if (b.dataset.s)
      sim.state.speed = Math.max(0.25, Math.min(50, Number(b.dataset.s)));
    else if (b.dataset.r) sim.reset(now);
    emit();
  });
}
