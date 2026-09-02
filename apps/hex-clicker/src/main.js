// BOOT + MAIN LOOP + the multiplayer seam. The room server (or the ?debug sim)
// broadcasts snapshots; state.js mirrors them and reports EDGES; this file
// wires those edges to the UI beats the prototype used to fire from inside
// its own buy path — so the night cutscene, the neon flip and the shop close
// play on every phone in the room, whoever pressed the button.

import "./styles.css";
import { BUILDINGS, UPGRADES, costOf, isRevealed } from "@escape-cats/shared";
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

/** How far up the screen the shop tray reaches, published to CSS as `--dock-up`
 * so the roster can ride its top edge (see `#team` in styles.css).
 *
 * MEASURED, never copied. The tray has three heights — open, collapsed to the
 * bare SHOP rail, and gone once the shop retires — and every one of them is a
 * number in the stylesheet; a constant here would be wrong in two of the three.
 *
 * The TRAY alone, and the rail is deliberately not in it. The rail is
 * `position: absolute; bottom: 100%`, so it hangs above the tray and outside
 * its box, and this number summed the two for as long as the rail was a
 * full-width band — under a right-aligned roster as much as anything else.
 * It is a tab in the top-LEFT corner now (`.shopHead`), and adding its height
 * to a measurement the names read from the RIGHT edge just pushed them a tab's
 * height up the empty side of the screen. Whatever the roster ends up riding,
 * it should be something actually beneath it.
 *
 * HEIGHTS rather than a top edge, because the tray arrives and leaves on a
 * transform (`dockIn`, and `.cutscene-hidden` on the way to night). A transform
 * moves a box without resizing it, so a measured position would be wrong for
 * the whole half-second of each slide with no resize to correct it; the height
 * is right throughout, and the names simply stay put while the tray travels.
 * A hidden tray measures 0, which is the answer `#team` wants: it falls to the
 * screen's own bottom inset and stays on screen, both before the shop first
 * appears and after it has retired for good. */
function measureDock() {
  document.documentElement.style.setProperty(
    "--dock-up",
    `${dockEl.getBoundingClientRect().height}px`,
  );
}
const dockRO = new ResizeObserver(measureDock);
dockRO.observe(dockEl);

/** The same trick at the other end of the screen, for #connToast, which hangs
 * off the HUD's bottom edge. HEIGHT rather than a bottom edge for the same
 * reason #team takes the tray's: #hud is top-anchored, so its height IS the
 * offset. It varies with two things this file cannot hardcode — the notch (#hud
 * pads by max(12px, env(safe-area-inset-top))) and the count's own line box,
 * which grows when the number wraps to two lines on a narrow phone. */
function measureHud() {
  document.documentElement.style.setProperty(
    "--hud-h",
    `${hudEl.getBoundingClientRect().height}px`,
  );
}
/* BORDER-BOX, unlike the dock's observer above, and the difference is the whole
 * point of this one: the inset #connToast is trying to clear is #hud's PADDING,
 * and a content-box observation does not fire when padding changes. Rotating a
 * notched phone swapped env(safe-area-inset-top) in and out with no callback and
 * left the toast hanging off a stale height. */
const hudRO = new ResizeObserver(measureHud);
hudRO.observe(hudEl, { box: "border-box" });

let teamKey = "";
function updateTeam() {
  // Rebuilt per snapshot but written only on change — the roster shifts a
  // handful of times per session, not 4x/second.
  const key = players.map((p) => `${p.connected ? 1 : 0}\u0000${p.name}`).join("\u0001");
  if (key === teamKey) return;
  teamKey = key;
  // One element per player and no separator: the names are a COLUMN now, so the
  // dot that used to join them would hang off the end of every line. Built as
  // nodes with textContent rather than a joined HTML string, so a name typed in
  // the lobby is text here by construction and there is no escaper to get wrong.
  teamEl.replaceChildren(
    ...players.map((p) => {
      const el = document.createElement("span");
      if (!p.connected) el.className = "off";
      el.textContent = p.name;
      return el;
    }),
  );
}

// ---------------------------------------------------------------------------
// MAIN LOOP
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// `\` — the same key Goomba uses to swap between playing and its level editor.
//
// Hex has no levels to edit; what it has behind ?debug is the 🛠 panel. But
// ?debug in hex is a different BACKEND — the shared sim running in-page, with
// no room and no server — so switching into it mid-session is a reload by
// construction, not a toggle. That is the honest behaviour and it is why this
// does not pretend to flip a switch: it puts you in debug, and once you are
// there the same key opens and closes the panel.
// ---------------------------------------------------------------------------
window.addEventListener("keydown", (e) => {
  if (e.key !== "\\") return;
  e.preventDefault();
  if (!debugFromUrl()) {
    const u = new URL(location.href);
    // `?debug`, not `?debug=` — it is read with `has()`, but the bare form is
    // what every note and whiteboard in this repo writes.
    u.search = u.search ? `${u.search}&debug` : "?debug";
    location.replace(u.toString());
    return;
  }
  const panel = document.querySelector("#devbar details");
  if (panel) panel.open = !panel.open;
});

boot();

// The alternate cat poses, fetched once the page is up rather than before its
// first paint — see warmPoseFrames in cat.js. Out here rather than in
// initGame() so the frames are on their way while the room is still
// connecting, not after it answers.
warmPoseFrames();

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
