// BOOT + MAIN LOOP + the multiplayer seam. The room server (or the ?debug sim)
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
  gateStatusEl,
  gateErrEl,
} from "./dom.js";
import {
  game,
  mods,
  nightActive,
  ackPets,
  applySnapshot,
  extrapolate,
  setRoomSeed,
  wallNow,
  players,
} from "./state.js";
import {
  connectRoom,
  debugFromUrl,
  playerId,
  transport,
  watchTeam,
} from "./net";
import { startDebug } from "./debug";
import {
  buildShop,
  refreshShop,
  refreshUpgrades,
  refreshHud,
  initShopSkin,
  setBooted,
  syncDock,
  shopClosePhase,
  runShopClose,
  reopenShop,
} from "./shop.js";
import { initPetInput } from "./pet.js";
import { spawnGold, despawnGold, moveGold, initGoldenInput } from "./golden.js";
import { updatePops } from "./fx.js";
import { clearMateTaps, enqueueMateTaps, updateMateTaps } from "./mates.js";
import { updateCat } from "./cat.js";
import { syncPhase, runNightCutscene, isNightInited } from "./phase.js";
import { drawWall, startWallNeon, resetWallClock } from "./wall.js";
import { currencyIconSVG } from "./art.js";

// ---------------------------------------------------------------------------
// Kiosk lockdown: swallow the long-press context menu and the touch gestures
// that would buzz the phone mid-mash. Native controls and the shop scroller
// opt out — they're driven by `click` and the scroll gesture respectively.
//
// `[data-native-touch]` is the GENERAL form of that opt-out, and anything with
// its own scroller needs it: preventDefault on a capture-phase touchstart stops
// the browser from ever starting a pan, so an `overflow:auto` box inside this
// page is scrollable with a mouse and frozen under a finger. The debug panel's
// buildings & upgrades dump was exactly that (see debug.ts) — it opted out on
// its buttons and its <summary> and nowhere else, so the one part of it worth
// scrolling was the one part that could not be. Subtree-wide via closest(), so
// marking a container covers every scroller inside it.
// ---------------------------------------------------------------------------
window.addEventListener("contextmenu", (e) => e.preventDefault());
const NATIVE_TOUCH =
  "#shopScroll, [data-native-touch], button, a, summary, input, select, textarea";
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

/** This phone's roster slot — the same index the server derives colours from. */
function mySlot(snap) {
  const pid = playerId();
  return (snap.players || []).findIndex((p) => p.id === pid);
}

function onSnapshot(snap) {
  const e = applySnapshot(snap);

  // Teammates' taps ride the snapshot but are drawn on their own timestamps,
  // not on its arrival — see mates.js. My own slot is skipped: pet.js already
  // popped those at my fingertip.
  if (e.reset) clearMateTaps();
  else enqueueMateTaps(snap.taps, snap.serverTime, mySlot(snap));

  if (e.first) {
    initGame();
  } else {
    if (e.reset) {
      // Proctor reset: the whole room starts over. Phase re-derives to day,
      // the shop reopens, the wall clock forgets the old night's anchor, and
      // any beat in flight is abandoned.
      document.body.classList.remove("dissolving");
      reopenShop();
      despawnGold();
      resetWallClock();
      syncPhase();
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
    // The purchase that empties the rail closes the shop — an edge, so a
    // rejoin that arrives already sold out retires it silently (syncDock).
    if (e.soldOut && !shopClosePhase) runShopClose();
    if (e.goldSpawn) spawnGold(e.goldSpawn);
    if (e.goldGone) despawnGold();
  }

  updateTeam();
  // No direct refresh calls: the frame loop repaints within ≤83ms, which is
  // the same 12fps cadence every other HUD/shop write already runs at.
  hudTick = 1;
}

function initGame() {
  inited = true;
  buildShop();
  syncPhase(); // a rejoin restores the phase with no beat, like a saved game
  countIconEl.innerHTML = currencyIconSVG(); // static art, set once
  initShopSkin();
  initPetInput();
  initGoldenInput();
  refreshHud();
  refreshShop();
  refreshUpgrades();
  syncDock();
  gateEl.classList.add("hidden");
  // The restored phase is in the DOM. Flush styles so the browser adopts it
  // with transitions still suppressed, then drop `.booting` next frame.
  void document.body.offsetHeight;
  requestAnimationFrame(() => document.body.classList.remove("booting"));
  setBooted();
  requestAnimationFrame(frame);
}

let teamHtml = "";
function updateTeam() {
  // Rebuilt per snapshot but written only on change — the roster shifts a
  // handful of times per session, not 4x/second.
  const html = players
    .map(
      (p) =>
        `<span class="${p.connected ? "" : "off"}">${escapeHtml(p.name)}</span>`,
    )
    .join(" · ");
  if (html !== teamHtml) {
    teamHtml = html;
    teamEl.innerHTML = html;
  }
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
  updateMateTaps();
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
// BOOT — there is no menu.
//
// By the time a player reaches this page they have been through the physical
// lobby: the proctor has already put their pid on a team, so the page slots
// them in by itself. A phone the proctor HASN'T sorted yet gets a waiting
// screen, not a form — and because watchTeam registers the phone in the lobby
// roster, that phone appears on the proctor's list while it waits and enters
// the game the moment it is assigned. Nobody types a room code; the only
// keyboard this game ever shows is the lobby's name prompt.
//
// The lobby is the ONLY way into a team: `?room=` used to override it and was
// removed (the README's "?room= is gone" has the why, including the room-id
// casing bug it caused). `?debug` still bypasses the server entirely.
// ---------------------------------------------------------------------------
const NAME_KEY = "escape-cats-name";

function boot() {
  if (debugFromUrl()) {
    setRoomSeed("DEBUG");
    // initGame hides the gate when the first snapshot lands — startDebug emits
    // one synchronously, so the page is fully wired before a finger can reach it.
    startDebug({ onSnapshot, onPetAck: ackPets });
    return;
  }

  const name = localStorage.getItem(NAME_KEY) ?? "Cat";

  gateStatusEl.textContent =
    "Waiting for your team — the proctor sorts you in, nothing to do here.";
  watchTeam({
    name,
    onTeam: (team, lobbyName) => {
      // The lobby's name is authoritative — it's the one the proctor saw.
      localStorage.setItem(NAME_KEY, lobbyName);
      enterRoom(team, lobbyName);
    },
    onStatus: (up) => {
      gateErrEl.textContent = up ? "" : "Can't reach the server — check wifi?";
    },
  });
}

/** The room is NEVER written into the URL: a refresh re-asks the lobby, so a
 * proctor re-sort takes effect on reload instead of being pinned by a stale
 * query param. Seat reclaim is by pid, not URL. */
function enterRoom(room, name) {
  setRoomSeed(room);
  gateStatusEl.textContent = "Joining your team…";
  connectRoom({
    room,
    name,
    onSnapshot,
    onPetAck: ackPets,
    onConnection: (up) => {
      connToastEl.classList.toggle("on", !up && inited);
      if (!inited) {
        gateErrEl.textContent = up
          ? ""
          : "Can't reach the room — hang tight, retrying…";
      }
    },
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
