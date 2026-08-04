// PHASE — day/night as a PROJECTION of folded state, the seeded starfield,
// and the night-transition cutscene. In multiplayer the cutscene fires off the
// snapshot's day->night edge (see main.js), so every phone in the room takes
// the beat together — including phones whose player never touched the button.

import { mulberry32 } from "@escape-cats/shared";
import { nightActive, wallSeed } from "./state.js";
import { hexCatEl, starsEl, dockEl, cutsceneVeilEl } from "./dom.js";
import { loadWallScene, resizeWall } from "./wall.js";
import { YAWN_MS, ZZZ_HOLD_MS } from "./cat.js";

let nightInited = false;
export function isNightInited() { return nightInited; }
// Phase is a PROJECTION of folded state, not an event: every caller just
// re-asserts it and this figures out the rest. Replaces an enterNight() that
// mutated the DOM from inside the buy path plus a hand-written devExitNight()
// inverse that had already drifted to a partial copy. Idempotent and cheap —
// safe to call after any state change, forward or backward.
export function syncPhase() {
  const night = nightActive();
  document.body.classList.toggle('night', night);
  hexCatEl.classList.toggle('asleep', night);
  // one-way latch: the scene is expensive to build and never needs rebuilding
  if (night && !nightInited) {
    nightInited = true;
    makeStars();
    loadWallScene();
    resizeWall();
  }
}

// Starfield, built once when night first falls (from the latch above). Seeded so
// the sky is stable across reloads/reconnects rather than reshuffling each time —
// decorative, so it needn't match other clients, but a fixed layout reads calmer.
// % positions + px sizes so it scales with the stage without a resize hook.
function makeStars() {
  if (starsEl.childElementCount) return;   // idempotent — the latch only fires once, but be safe
  const rnd = mulberry32(0x5741 ^ wallSeed());
  const N = 54, frag = document.createDocumentFragment();
  for (let i = 0; i < N; i++) {
    const s = document.createElement("i");
    const size = (0.8 + rnd() * 1.9).toFixed(2);      // 0.8–2.7px
    s.style.left = (rnd() * 100).toFixed(2) + "%";
    s.style.top = (rnd() * 100).toFixed(2) + "%";
    s.style.width = s.style.height = size + "px";
    s.style.setProperty("--o", (0.35 + rnd() * 0.5).toFixed(2));   // base brightness 0.35–0.85
    s.style.setProperty("--dur", (2.4 + rnd() * 3.6).toFixed(2) + "s"); // slow, varied twinkle
    s.style.setProperty("--delay", (-rnd() * 6).toFixed(2) + "s");  // negative → mid-cycle at start, no unison flash-on
    frag.appendChild(s);
  }
  starsEl.appendChild(frag);
}

// The night-transition CUTSCENE. Fired once, only on the live day->night edge (a
// player buying the twist) — never on load/reconnect or a dev preset, so a
// returning player drops straight into night without replaying the beat. It
// takes the screen: the whole static shop slides shut, a transparent veil locks
// ALL input (petting included), the existing yawn->zoom->reveal plays, then input
// frees and the shop slides back in.
let cutsceneLock = false;
// How long #dock takes to slide out and back. Mirrors the .5s transition on
// #dock — the only thing read from here is how long the returning shop stays
// inert (see #dock.settling), so an over-estimate is harmless and an
// under-estimate hands the player a row that is still moving.
const DOCK_SLIDE_MS = 500;
export function runNightCutscene() {
  if (cutsceneLock) return;
  cutsceneLock = true;
  // `dissolving` (the beat's transition delays — see #catPose / #catBreath / #stars)
  // is added by buyUpgrade BEFORE syncPhase, for the ordering reason documented
  // there. It is removed at the end of the beat below. A restored night save never
  // gets it, so it has no choreography to wait through.
  dockEl.classList.add("cutscene-hidden"); // shut the whole static shop for the reveal
  cutsceneVeilEl.classList.add("on"); // nothing selectable while the beat plays
  // Duration read here (not a top-level const) so it can reference YAWN_MS, which
  // is declared further down. Kept in sync with the CSS, and it is now a sum of
  // three beats rather than two: YAWN_MS (1300) + ZZZ_HOLD_MS (2000, she holds
  // still at full size while the first zzz drift off) + the #catPose zoom
  // (1800ms) = the moment the camera settles. The veil has to outlast all three,
  // or the shop comes back in over a cat who is still mid-move.
  setTimeout(() => {
    cutsceneVeilEl.classList.remove("on");
    dockEl.classList.remove("cutscene-hidden"); // slides back up as the reveal settles
    dockEl.classList.add("settling");           // ...and stays untappable until it lands
    setTimeout(() => dockEl.classList.remove("settling"), DOCK_SLIDE_MS);
    document.body.classList.remove("dissolving");
    cutsceneLock = false;
  }, YAWN_MS + ZZZ_HOLD_MS + 1800);
}
