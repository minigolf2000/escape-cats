// BOOT + MAIN LOOP + the multiplayer seam. The room server (or the ?solo sim)
// broadcasts snapshots; state.js mirrors them and reports EDGES; this file
// wires those edges to the UI beats the prototype used to fire from inside
// its own buy path — so the night cutscene, the neon flip and the shop close
// play on every phone in the room, whoever pressed the button.

import { BUILDINGS, UPGRADES, costOf, isRevealed } from "@escape-cats/shared";
import {
  buffEl,
  countIconEl,
  teamEl,
  connToastEl,
  gateEl,
  gateRoomEl,
  gateErrEl,
  roomInputEl,
  nameInputEl,
  joinBtnEl,
  soloBtnEl,
} from "./dom.js";
import {
  game,
  mods,
  nightActive,
  applySnapshot,
  extrapolate,
  setRoomSeed,
  wallNow,
  players,
} from "./state.js";
import { connectRoom, roomFromUrl, soloFromUrl, transport } from "./net";
import { startSolo } from "./solo";
import {
  buildShop,
  refreshShop,
  refreshUpgrades,
  refreshHud,
  initShopSkin,
  setBooted,
  syncDock,
  shopSoldOut,
  shopClosePhase,
  runShopClose,
  reopenShop,
} from "./shop.js";
import { initPetInput } from "./pet.js";
import { spawnGold, despawnGold, moveGold, initGoldenInput } from "./golden.js";
import { updatePops } from "./fx.js";
import { updateCat } from "./cat.js";
import { syncPhase, runNightCutscene, isNightInited } from "./phase.js";
import { drawWall, startWallNeon } from "./wall.js";
import { currencyIconSVG } from "./art.js";

// ---------------------------------------------------------------------------
// Kiosk lockdown: swallow the long-press context menu and the touch gestures
// that would buzz the phone mid-mash. Native controls and the shop scroller
// opt out — they're driven by `click` and the scroll gesture respectively.
// ---------------------------------------------------------------------------
window.addEventListener("contextmenu", (e) => e.preventDefault());
const NATIVE_TOUCH = "#shopScroll, button, a, summary, input, select, textarea";
window.addEventListener(
  "touchstart",
  (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest(NATIVE_TOUCH)) return;
    e.preventDefault();
  },
  { capture: true, passive: false },
);

// ---------------------------------------------------------------------------
// SNAPSHOT WIRING
// ---------------------------------------------------------------------------
let inited = false;
let wasSoldOut = false;

function onSnapshot(snap) {
  const e = applySnapshot(snap);

  if (e.first) {
    initGame();
  } else {
    if (e.reset) {
      // Proctor reset: the whole room starts over. Phase re-derives to day,
      // the shop reopens, and any beat in flight is abandoned.
      document.body.classList.remove("dissolving");
      reopenShop();
      despawnGold();
      syncPhase();
      wasSoldOut = false;
    }
    if (e.nightFlip) {
      // THE TWIST, live: same ordering as the prototype's buy path —
      // `dissolving` carries the cutscene's transition delays and must be on
      // the body BEFORE the phase class lands.
      document.body.classList.add("dissolving");
      syncPhase();
      despawnGold();
      runNightCutscene();
    }
    if (e.neonOn && isNightInited()) startWallNeon();
    if (e.goldSpawn) spawnGold(e.goldSpawn);
    if (e.goldGone) despawnGold();
  }

  // The purchase that empties the rail closes the shop — an edge, so a rejoin
  // that arrives already sold out retires it without the beat (syncDock).
  const soldOut = shopSoldOut();
  if (soldOut && !wasSoldOut && inited && !e.first && !shopClosePhase)
    runShopClose();
  wasSoldOut = soldOut;

  updateTeam();
  if (inited) {
    refreshHud();
    refreshShop();
    refreshUpgrades();
  }
}

function initGame() {
  inited = true;
  buildShop();
  syncPhase(); // a rejoin restores the phase with no beat, like a saved game
  if (game.zoomUntil > performance.now()) {
    /* buff pill picks it up on the first frame */
  }
  countIconEl.innerHTML = currencyIconSVG(); // static art, set once
  initShopSkin();
  initPetInput();
  initGoldenInput();
  refreshHud();
  refreshShop();
  refreshUpgrades();
  syncDock();
  wasSoldOut = shopSoldOut();
  gateEl.classList.add("hidden");
  // The restored phase is in the DOM. Flush styles so the browser adopts it
  // with transitions still suppressed, then drop `.booting` next frame.
  void document.body.offsetHeight;
  requestAnimationFrame(() => document.body.classList.remove("booting"));
  setBooted();
  requestAnimationFrame(frame);
}

function updateTeam() {
  teamEl.innerHTML = players
    .map(
      (p) =>
        `<span class="${p.connected ? "" : "off"}">${escapeHtml(p.name)}</span>`,
    )
    .join(" · ");
}
const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------------------------------------------------------------------------
// MAIN LOOP
// ---------------------------------------------------------------------------
let last = performance.now(),
  hudTick = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // Income between snapshots — same shared rules the server ticks with, so
  // the reconcile on the next snapshot is a sub-frame nudge.
  extrapolate(dt);

  // Buff pill countdown
  if (game.zoomUntil > now) {
    const left = (game.zoomUntil - now) / 1000;
    buffEl.textContent =
      "⚡ ZOOMIES ×" + mods.zoomMult + " · " + left.toFixed(1) + "s";
    buffEl.style.display = "block";
  } else if (buffEl.style.display === "block") {
    buffEl.style.display = "none";
  }

  const night = nightActive();
  if (!night) moveGold(dt);
  updateCat(now);
  updatePops(dt);
  // The wall draws against the SHARED clock — all phones, one timeline.
  if (night) drawWall(wallNow());

  // throttle HUD/shop updates to ~12fps (cheap, avoids layout thrash)
  hudTick += dt;
  if (hudTick > 0.08) {
    hudTick = 0;
    refreshHud();
    refreshShop();
    refreshUpgrades();
  }

  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// JOIN GATE
// ---------------------------------------------------------------------------
const NAME_KEY = "escape-cats-name";

function boot() {
  if (soloFromUrl()) {
    setRoomSeed("SOLO");
    // initGame hides the gate when the first snapshot lands — startSolo emits
    // one synchronously, so the page is fully wired before a finger can reach it.
    startSolo({ onSnapshot });
    return;
  }

  const urlRoom = roomFromUrl();
  if (urlRoom) {
    roomInputEl.value = urlRoom;
    gateRoomEl.style.display = "none";
  }
  nameInputEl.value = localStorage.getItem(NAME_KEY) ?? "";

  const validate = () => {
    joinBtnEl.disabled = !(
      roomInputEl.value.trim() && nameInputEl.value.trim()
    );
  };
  roomInputEl.addEventListener("input", validate);
  nameInputEl.addEventListener("input", validate);
  validate();

  const join = () => {
    const room = roomInputEl.value.trim().toUpperCase();
    const name = nameInputEl.value.trim();
    if (!room || !name) return;
    localStorage.setItem(NAME_KEY, name);
    // Put the room in the URL so a refresh rejoins the same seat.
    const url = new URL(location.href);
    url.searchParams.set("room", room);
    history.replaceState(null, "", url);
    setRoomSeed(room);
    gateErrEl.textContent = "";
    joinBtnEl.disabled = true;
    joinBtnEl.textContent = "Joining…";
    connectRoom({
      room,
      name,
      onSnapshot,
      onConnection: (up) => {
        connToastEl.classList.toggle("on", !up && inited);
        if (!up && !inited) {
          gateErrEl.textContent = "Can't reach the room — check the code?";
          joinBtnEl.disabled = false;
          joinBtnEl.textContent = "Join";
        }
      },
    });
  };
  joinBtnEl.addEventListener("click", join);
  nameInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !joinBtnEl.disabled) join();
  });

  soloBtnEl.addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.delete("room");
    url.searchParams.set("solo", "1");
    location.href = url.toString();
  });
}

boot();

// Debug handle — the multiplayer stand-in for the prototype's ?debug panel.
// Lets a console (or a Playwright test) inspect the mirror and inject intents;
// harmless to ship since the server validates everything anyway.
window.__hex = {
  game,
  mods,
  BUILDINGS,
  UPGRADES,
  costOf,
  isRevealed,
  send: (msg) => transport.send(msg),
};
