// ?debug mode: the SAME shared HexSim the server runs, in-page — the tuning
// bench. The floating 🛠 panel calls the sim directly, so nothing debug-only
// touches the wire protocol and none of this can reach a real room.

import {
  BUILDINGS,
  DEBUG_PRESETS,
  HexSim,
  SNAPSHOT_TICK_MS,
  UPGRADES,
  costOf,
  isRevealed,
  nightOf,
  onRail,
  unlockMet,
  type HexUpgrade,
  type HexSnapshot,
} from "@escape-cats/shared";
import { effectText } from "./shop.js";
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
  // Income up to the instant the snapshot is STAMPED, exactly as the room's
  // broadcastState does it — a snapshot banked at the last tick but stamped
  // now is a bank the page then has to count backwards to. Every path that
  // emits (the loop, a purchase, the panel) goes through here, so none of them
  // can forget.
  const emit = () => {
    const now = Date.now();
    sim.tick(now);
    opts.onSnapshot(sim.snapshot(now, []));
  };

  // Mounted before the loop, because the loop is what keeps the panel's
  // day-only control in step with the phase: the twist lands on a PURCHASE,
  // which never passes through the panel's own click handler.
  const syncPanel = mountPanel(sim, emit);

  setInterval(() => {
    flushPets(Date.now());
    emit(); // ticks
    syncPanel();
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

  // Console handle on the AUTHORITY, not the mirror: window.__hex.game is the
  // render mirror and deliberately drops server-private fields (legibleAt), so
  // tuning work and tests assert against the sim itself.
  (window as unknown as { __hexSim: HexSim }).__hexSim = sim;
}

const buildingName = (id: string) =>
  (BUILDINGS.find((b) => b.id === id) || { name: id }).name;

// NOT the shop's fmt(): that one appends "M" to every number at night (the
// dream's joke), which in a tuning table makes 60,000,000 a misprint. The effect
// column IS still shop text, M suffix and all — checking what the rail says is
// half of what the table is for.
const num = (n: number) => Math.floor(n).toLocaleString("en-US");

// Human-readable unlock condition. Mirrors the AND-ed checks in unlockMet() —
// keep the two in sync; this is the column a tuning pass reads to find rows
// whose gates can never both be met, or whose second gate silently binds later
// than the one that was chosen to place the row.
function unlockText(u: HexUpgrade): string {
  const c = u.unlock,
    parts: string[] = [];
  if (c.owned) {
    const pairs = (
      typeof c.owned[0] === "string" ? [c.owned] : c.owned
    ) as [string, number][];
    for (const [id, n] of pairs) parts.push(`own ${n}× ${buildingName(id)}`);
  }
  if (c.total != null) parts.push(`${num(c.total)} lifetime`);
  if (c.clicks != null) parts.push(`${c.clicks} pets`);
  if (c.golden != null) parts.push(`${c.golden} golden`);
  if (c.requires) {
    const r = UPGRADES.find((x) => x.key === c.requires);
    parts.push(`after ${r ? r.name : c.requires}`);
  }
  return parts.join(" + ") || "always";
}

// The full content table, read off the SIM (the authority), not the mirror,
// which drops server-private fields. `available` is unlockMet against live
// state, NOT the shop's sticky `unlocked`: "are this row's gates met right
// now?" is the useful truth for tuning. Rows walk in UPGRADES order, which is
// shop order, so a row out of cost sequence here is out of sequence on the rail.
function devContentHTML(sim: HexSim): string {
  const s = sim.state;
  const night = nightOf(s.bought);
  const bRows = BUILDINGS.map((b) => {
    const owned = s.owned[b.id] || 0;
    // "off-phase" (retired by the twist) vs "hidden" (threshold not crossed) mean
    // opposite things to a tuning pass. Compare the two booleans: b.night is
    // `undefined` on day buildings, so `b.night === !night` mislabels the day rail.
    const state = !isRevealed(b, s)
      ? !!b.night !== night
        ? "off-phase"
        : "hidden"
      : owned
        ? `owned ${owned} @ ${num(costOf(b, owned))}`
        : `revealed @ ${num(costOf(b, owned))}`;
    return `<tr class="${owned ? "" : "done"}"><td>${b.icon} ${b.name}</td>
      <td class="n">${num(b.base)}</td><td class="n">${b.mps}</td>
      <td>${b.night ? "night" : "day"}</td><td class="s">${state}</td></tr>`;
  }).join("");
  const uRows = UPGRADES.map((u) => {
    const bought = !!s.bought[u.key];
    const state = bought
      ? "BOUGHT"
      : !onRail(u, s.bought)
        ? "off-phase"
        : unlockMet(u, s)
          ? s.mice >= u.cost
            ? "AFFORDABLE"
            : "available"
          : "locked";
    return `<tr class="${bought ? "done" : ""}"><td>${u.icon} ${u.name}</td>
      <td class="n">${num(u.cost)}</td><td>${unlockText(u)}</td>
      <td>${effectText(u, true)}</td><td class="s">${state}</td></tr>`;
  }).join("");
  return `<h4>Buildings (${BUILDINGS.length})</h4>
    <table><thead><tr><th>name</th><th>base</th><th>mps</th><th>phase</th><th>state</th></tr></thead>
    <tbody>${bRows}</tbody></table>
    <h4>Upgrades (${UPGRADES.length})</h4>
    <table><thead><tr><th>name</th><th>cost</th><th>unlock</th><th>effect</th><th>state</th></tr></thead>
    <tbody>${uRows}</tbody></table>`;
}

/** The floating 🛠 panel: grant, story-beat jumps, a forced golden, time scale,
 * reset, and the buildings & upgrades dump. DOM is injected only here, so
 * nothing panel-related ships into a real session.
 *
 * Returns a sync callback the tick loop calls, for the one control whose
 * availability depends on state the panel does not itself move (see below). */
function mountPanel(sim: HexSim, emit: () => void): () => void {
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
    #devbar button:disabled { opacity: .4; cursor: default; }
    #devbar button:disabled:active { background: #1c2030; }
    /* The content dump. Capped and scrollable — 7 buildings plus 40-odd
       upgrades is taller than a phone, and the panel must not cover the wall
       (the one thing the night phase exists to show).

       On a phone the cap is the whole point and it was the whole problem: the
       box scrolled with a trackpad and not with a finger. Three things had to be
       true at once, and only the first was:
         - overflow:auto                    (it was)
         - the page must not swallow the pan (it did — see NATIVE_TOUCH in
           main.js; #devbar carries data-native-touch now)
         - touch-action must allow it       (an inherited manipulation/none from
           a kiosk-locked ancestor is enough to kill it, so state it)
       overscroll-behavior stops a flick that reaches the end from scrolling the
       page behind the panel, which on iOS reads as the panel jumping away. */
    #devList { margin-top: 4px; }
    #devContent { margin-top: 4px; overflow: auto; max-height: 46vh; max-width: 88vw;
      touch-action: pan-x pan-y; overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch; }
    #devContent h4 { margin: 10px 0 5px; color: #f6c86a; font-size: 11px;
      letter-spacing: .1em; text-transform: uppercase; }
    #devContent h4:first-child { margin-top: 0; }
    /* border-collapse: separate, NOT collapse, and that is the sticky header's
       requirement rather than a style choice: a collapsed table's borders
       belong to the
       table, so a stuck <th> paints its own background but not the collapsed
       border row, and the cells it is supposed to be occluding bleed through it
       as it scrolls under. Separate borders live on the cells, so each th
       carries its own opaque box. Nothing was wrong with it until the panel
       could actually be scrolled on a phone. */
    #devContent table { border-collapse: separate; border-spacing: 0; width: 100%; }
    #devContent th, #devContent td { text-align: left; padding: 3px 7px;
      border-bottom: 1px solid #1b2130; vertical-align: top; }
    #devContent th { color: #6fe3d0; font-weight: 600; position: sticky; top: 0;
      background: #090c12; z-index: 1; }
    #devContent td.n { text-align: right; font-variant-numeric: tabular-nums;
      color: #f6c86a; white-space: nowrap; }
    #devContent td.s { color: #6f7a8c; white-space: nowrap; }
    #devContent tr.done td { opacity: .45; }
  `;
  document.head.appendChild(st);

  const bar = document.createElement("div");
  bar.id = "devbar";
  // Opt the whole panel out of the kiosk touch lockdown (see NATIVE_TOUCH in
  // main.js). On the panel it costs nothing — there is no pettable cat under it
  // — and it is what lets the dump below scroll under a finger.
  bar.dataset.nativeTouch = "";
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
    <div class="r"><span>spawn</span><button data-gold="1">🐭 golden</button></div>
    <!-- The win is the PROCTOR's press in a real room (HexSim.setWon), so a
         debug phone needs its own way in or the splash is only ever testable
         with a second surface open. Same sim call the room makes, and a toggle
         for the same reason theirs is one. -->
    <div class="r"><span>won</span><button data-won="1">🏆 toggle</button></div>
    <div class="r"><span>speed</span>${[1, 5, 20]
      .map((n) => `<button data-s="${n}">×${n}</button>`)
      .join("")}<button data-r="1">reset</button></div>
    <details id="devList"><summary>buildings &amp; upgrades</summary><div id="devContent"></div></details>
  </details>`;
  document.body.appendChild(bar);

  const list = bar.querySelector("#devList") as HTMLDetailsElement;
  const content = bar.querySelector("#devContent") as HTMLElement;
  // Regenerated on open, and again after any control that moves the state,
  // so the state column reflects the moment you looked. NOT per snapshot tick:
  // rebuilding a 40-row table four times a second throws away the scroll
  // position you were reading it at.
  const redrawList = () => {
    if (list.open) content.innerHTML = devContentHTML(sim);
  };
  list.addEventListener("toggle", redrawList);

  // Goldens are day-only in the sim, so the button is greyed out at night
  // rather than silently doing nothing. Night arrives on a PURCHASE (and leaves
  // on a reset or a day preset), so this is driven from the tick loop, not only
  // from the click handler below.
  const goldBtn = bar.querySelector("[data-gold]") as HTMLButtonElement;
  let goldWas: boolean | null = null; // null so the first sync always paints
  const syncGold = () => {
    const night = sim.night();
    if (goldWas === night) return;
    goldWas = night;
    goldBtn.disabled = night;
    goldBtn.title = night
      ? "day-only: Zoomies multiplies pets, which mint nothing at night"
      : "put a golden mouse up now";
  };
  syncGold();

  bar.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b || b.disabled) return;
    const now = Date.now();
    if (b.dataset.g) sim.grant(Number(b.dataset.g), now);
    else if (b.dataset.p) sim.applyPreset(DEBUG_PRESETS[b.dataset.p], now);
    else if (b.dataset.gold) sim.spawnGold(now);
    else if (b.dataset.s)
      sim.state.speed = Math.max(0.25, Math.min(50, Number(b.dataset.s)));
    else if (b.dataset.won) sim.setWon(sim.state.wonAt === null, now);
    else if (b.dataset.r) sim.reset(now);
    emit();
    syncGold();
    redrawList();
  });

  return syncGold;
}
