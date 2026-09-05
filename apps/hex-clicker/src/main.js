// BOOT + MAIN LOOP + the multiplayer seam. The room server (or the ?debug sim)
// broadcasts snapshots; state.js mirrors them and reports EDGES; this file wires
// those edges to the UI beats, so they play on every phone, whoever pressed.

import "./styles.css";
import { BUILDINGS, UPGRADES, costOf, isRevealed, isTeamRoom } from "@escape-cats/shared";
import {
  buffEl,
  countIconEl,
  teamEl,
  dockEl,
  hudEl,
  connToastEl,
  gateEl,
  gateStatusEl,
  gateErrEl,
  wonPillEl,
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
  myRoom,
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
import { updateCat, warmPoseFrames } from "./cat.js";
import {
  syncPhase, runNightCutscene, isNightInited,
  initSplashArt, setSplash, syncWon, toggleSplash,
} from "./phase.js";
import { drawWall, startWallNeon, resetWallClock } from "./wall.js";
import { currencyIconSVG } from "./art.js";

// Kiosk lockdown: swallow the long-press context menu and the touch gestures
// that would buzz the phone mid-mash. Native controls and scrollers opt out —
// preventDefault on a capture-phase touchstart stops the browser ever starting
// a pan, so any `overflow:auto` box needs `[data-native-touch]` (subtree-wide
// via closest()) or it scrolls with a mouse and freezes under a finger.
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

// ---- SNAPSHOT WIRING ----
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
      // syncWon below retires the pill and drops the splash — a reset takes the
      // win back with everything else, so there is no separate un-win path.
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
    if (e.wonFlip) {
      // The proctor just pressed it: every phone in the room raises the picture
      // together, and the pill is right there to go back with.
      setSplash(true);
    }
    if (e.neonOn && isNightInited()) startWallNeon();
    // The purchase that empties the rail closes the shop — an edge, so a
    // rejoin that arrives already sold out retires it silently (syncDock).
    if (e.soldOut && !shopClosePhase) runShopClose();
    if (e.goldSpawn) spawnGold(e.goldSpawn);
    if (e.goldGone) despawnGold();
  }

  syncWon(); // projection, not an edge — see phase.js
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
  initSplashArt();
  wonPillEl.onclick = toggleSplash;
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

/** The shop tray's height, published to CSS as `--dock-up` so the roster rides
 * its top edge (`#team` in styles.css). MEASURED, never copied: the tray has
 * three heights (open, collapsed, retired) and all live in the stylesheet. The
 * TRAY alone, not the rail — the rail is a tab in the top-LEFT corner, outside
 * the tray's box, and the names read from the RIGHT edge. A HEIGHT rather than
 * a top edge because the tray arrives and leaves on a transform, which moves
 * the box without resizing it. A hidden tray measures 0, which drops the names
 * to the screen's own bottom inset — where they belong. */
function measureDock() {
  document.documentElement.style.setProperty(
    "--dock-up",
    `${dockEl.getBoundingClientRect().height}px`,
  );
}
const dockRO = new ResizeObserver(measureDock);
dockRO.observe(dockEl);

/** The same trick at the top, for #connToast, which hangs off the HUD's bottom
 * edge. #hud is top-anchored, so its height IS the offset; it varies with the
 * notch padding and with the count wrapping to two lines on a narrow phone. */
function measureHud() {
  document.documentElement.style.setProperty(
    "--hud-h",
    `${hudEl.getBoundingClientRect().height}px`,
  );
}
/* BORDER-BOX, unlike the dock's observer: the inset #connToast clears is #hud's
 * PADDING, and a content-box observation does not fire when padding changes
 * (rotating a notched phone swapped the safe-area inset with no callback). */
const hudRO = new ResizeObserver(measureHud);
hudRO.observe(hudEl, { box: "border-box" });

let teamKey = "";
function updateTeam() {
  // WHO IS HERE — and only in one of the four TEAMS: elsewhere the room is
  // whoever turned up, still on the default name, so the column would be one
  // word repeated (isTeamRoom). Same rule as Goomba's roster.
  //
  // Rebuilt per snapshot but written only on change — the roster shifts a
  // handful of times per session, not 4x/second.
  const named = isTeamRoom(myRoom()) ? players : [];
  const key = named.map((p) => `${p.connected ? 1 : 0}\u0000${p.name}`).join("\u0001");
  if (key === teamKey) return;
  teamKey = key;
  // One element per player, no separator (the names are a COLUMN). Built as
  // nodes with textContent, so a name typed in the lobby is text here by
  // construction and there is no escaper to get wrong.
  teamEl.replaceChildren(
    ...named.map((p) => {
      const el = document.createElement("span");
      if (!p.connected) el.className = "off";
      el.textContent = p.name;
      return el;
    }),
  );
}

// ---- MAIN LOOP ----
let last = performance.now(),
  hudTick = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // Income between snapshots, read off the last snapshot's anchor rather than
  // accumulated per frame — see state.js. There is no reconcile: the next
  // snapshot's anchor evaluates to what this one is already showing.
  extrapolate();

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

// BOOT — there is no menu. The proctor has already put this pid on a team in
// the physical lobby, so the page slots itself in; an unsorted phone gets a
// waiting screen (watchTeam registers it in the lobby roster, so it appears on
// the proctor's list and enters the game the moment it is assigned). The lobby
// is the ONLY way into a team — no `?room=`, ever (README). `?debug` bypasses
// the server entirely.
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

// `\` — the same key Goomba uses for its editor. Hex's ?debug is a different
// BACKEND (the sim in-page, no room), so switching into it mid-session is a
// reload by construction; once there, the same key opens and closes the panel.
window.addEventListener("keydown", (e) => {
  if (e.key !== "\\") return;
  e.preventDefault();
  if (!debugFromUrl()) {
    const u = new URL(location.href);
    // `?debug`, not `?debug=`: read with `has()`, and the bare form is what every
    // note in this repo writes.
    u.search = u.search ? `${u.search}&debug` : "?debug";
    location.replace(u.toString());
    return;
  }
  const panel = document.querySelector("#devbar details");
  if (panel) panel.open = !panel.open;
});

boot();

// Alternate cat poses, fetched once the page is up (warmPoseFrames in cat.js).
// Out here so they are on their way while the room is still connecting.
warmPoseFrames();

// Debug handle: lets a console (or a Playwright test) inspect the mirror and
// inject intents. Harmless to ship; the server validates everything.
window.__hex = {
  game,
  mods,
  BUILDINGS,
  UPGRADES,
  costOf,
  isRevealed,
  send: (msg) => transport.send(msg),
};
