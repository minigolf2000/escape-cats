// BOOT + MAIN LOOP + the snapshot seam. `backend.js` runs the shared HexSim in
// this tab and emits snapshots; state.js mirrors them and reports EDGES; this
// file wires those edges to the UI beats.
//
// The seam is what it was when a server was behind it, and the edge flags
// are why: "the twist just fired", "the wall just went legible", "a golden just
// left" are all differences between two snapshots, and every beat in this file
// hangs off one. Don't reach past `transport` to the sim.

import "./styles.css";
import { BUILDINGS, UPGRADES, costOf, isRevealed } from "@escape-cats/shared";
import {
  buffEl,
  countIconEl,
  gateEl,
  wonPillEl,
} from "./dom.js";
import {
  game,
  mods,
  nightActive,
  applySnapshot,
  extrapolate,
  wallNow,
} from "./state.js";
import { debugFromUrl, transport } from "./transport";
import { startBackend } from "./backend";
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

function onSnapshot(snap) {
  const e = applySnapshot(snap);

  if (e.first) {
    initGame();
  } else {
    if (e.reset) {
      // Start over. Phase re-derives to day,
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
      // The wall just became readable: raise the picture on the beat it
      // happens, with the pill right there to go back with.
      setSplash(true);
    }
    if (e.neonOn && isNightInited()) startWallNeon();
    // The purchase that empties the rail closes the shop — an edge, so a
    // restored save that lands already sold out retires it silently (syncDock).
    if (e.soldOut && !shopClosePhase) runShopClose();
    if (e.goldSpawn) spawnGold(e.goldSpawn);
    if (e.goldGone) despawnGold();
  }

  syncWon(); // projection, not an edge — see phase.js
  // No direct refresh calls: the frame loop repaints within ≤83ms, which is
  // the same 12fps cadence every other HUD/shop write already runs at.
  hudTick = 1;
}

function initGame() {
  buildShop();
  syncPhase(); // a restored save lands on its phase with no beat
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
  const zoomNow = wallNow();
  if (game.zoomUntil > zoomNow) {
    const left = (game.zoomUntil - zoomNow) / 1000;
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

// BOOT — there is no menu. `startBackend` emits its first
// snapshot synchronously, so the page is fully wired (gate down, pet listener
// live) before a finger can reach it; `initGame` hides the gate on that
// snapshot.
//
// The 🛠 panel is loaded only when `?debug` is present, so its module — the
// preset table, the 40-row buildings dump — stays out of the bundle a normal
// player downloads.

function boot() {
  startBackend({
    onSnapshot,
    onSim: debugFromUrl()
      ? (sim, emit) => {
          // Dynamic, for the reason above. The panel mounts a tick or two
          // after the game is already playable, which is right: it is a bench,
          // not part of the boot.
          let sync = null;
          void import("./debug").then((m) => {
            sync = m.mountPanel(sim, emit);
          });
          return () => sync?.();
        }
      : undefined,
  });
}

// `\` — the same key Goomba uses for its editor. Hex's ?debug is the 🛠 panel,
// whose module is only fetched when the flag is present, so switching into it
// mid-session is a reload; once there, the same key opens and closes it.
window.addEventListener("keydown", (e) => {
  if (e.key !== "\\") return;
  e.preventDefault();
  if (!debugFromUrl()) {
    const u = new URL(location.href);
    // `?debug`, not `?debug=`: read with `has()`, and the bare form is what every
    // note in this repo writes. A reload, because the panel's module is not in
    // this bundle — see boot().
    u.search = u.search ? `${u.search}&debug` : "?debug";
    location.replace(u.toString());
    return;
  }
  const panel = document.querySelector("#devbar details");
  if (panel) panel.open = !panel.open;
});

boot();

// Alternate cat poses, fetched once the page is up (warmPoseFrames in cat.js).
// Out here so they are on their way before the first snapshot lands.
warmPoseFrames();

// Debug handle: lets a console (or a Playwright test) inspect the mirror and
// inject intents. Harmless to ship; the sim validates everything.
window.__hex = {
  game,
  mods,
  BUILDINGS,
  UPGRADES,
  costOf,
  isRevealed,
  send: (msg) => transport.send(msg),
};
