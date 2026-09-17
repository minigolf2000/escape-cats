// PHASE — day/night as a PROJECTION of folded state, the seeded starfield, the
// night-transition cutscene, and the win splash. The cutscene fires off the
// snapshot's day->night edge (main.js).

import { hexWon, mulberry32, HEX_CODEWORD } from "@escape-cats/shared";
import { game, nightActive, wallSeed } from "./state.js";
import {
  hexCatEl, starsEl, dockEl, cutsceneVeilEl,
  splashEl, splashArtEl, splashWordTextEl, wonPillEl,
} from "./dom.js";
import { loadWallScene, resizeWall } from "./wall.js";
import { YAWN_MS, ZZZ_HOLD_MS } from "./cat.js";

// The win screen says the same thing every time it is raised, so the word is
// written ONCE here rather than tracked through the snapshot. It is the shared
// constant, not a second copy of the string: hex's bundle already carries it
// (the sim runs in-page), so carrying it through the snapshot would buy the
// player nothing and only give the splash a state it could be wrong about.
splashWordTextEl.textContent = HEX_CODEWORD;

let nightInited = false;
export function isNightInited() { return nightInited; }
// Phase is a PROJECTION of folded state, not an event: every caller re-asserts
// it. Idempotent and cheap — safe after any state change, forward or backward,
// so there is no hand-written inverse to drift.
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

// Starfield, built once when night first falls. Seeded so the sky is stable
// across reloads; decorative, so it needn't match other clients.
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

// ---- THE WIN SPLASH — the picture a finished game gets, and the toggle off it ----
// The win is `legibleAt`: the wall has inked enough of the word to READ. It
// used to be a proctor's press on a separate dashboard, because the code word
// left the game on a phone and came back as four humans saying it out loud, so
// the win was witnessed rather than scored. With one player and nobody to say
// it to, the wall going readable IS the win (`hexWon`).
//
// The splash deliberately has a way BACK to the night scene — the wall they
// read is what they earned. Which view is showing is LOCAL, unlike Goomba's
// level cards, which move what is being PLAYED.
let splashOpen = false;
// The arrival beat plays ONCE per win — see setSplash.
let introPlayed = false;

/** Point the splash at its picture and take the sky colours FROM that picture:
 * replace the file, get a new sky. BASE_URL rather than a literal /hexxygon/ —
 * a public/ asset referenced from JS, and Vite's base is the one string that is
 * right in dev and in the built bundle both. */
export function initSplashArt() {
  splashArtEl.onload = () => {
    const sky = skyStops(splashArtEl, SKY_STOPS);
    // The ends double as the flat bands above and below the picture, so the two
    // fills are the same colours where they meet the art (see the two-slacks
    // note in index.html).
    splashEl.style.setProperty("--sky-top", sky[0]);
    splashEl.style.setProperty("--sky-bottom", sky[sky.length - 1]);
    splashEl.style.setProperty(
      "--sky-ramp",
      `linear-gradient(${sky
        .map((c, i) => `${c} ${((100 * i) / (sky.length - 1)).toFixed(1)}%`)
        .join(",")})`,
    );
  };
  // 200KB that cannot be on screen until the wall goes legible, so it waits
  // for an idle moment rather than riding out with the first snapshot.
  // The timeout is generous because nothing is watching for it.
  const load = () => {
    splashArtEl.src = import.meta.env.BASE_URL + "art/hex-splash.webp";
  };
  if (typeof requestIdleCallback === "function")
    requestIdleCallback(load, { timeout: 5000 });
  else setTimeout(load, 1000);
}

/** The art's own SIDE EDGE, sampled down its height into n colours — the sky to
 * continue the picture with in every direction. The EDGE strip, not a full row
 * (the middle of the picture is a moon), and more than two stops because the
 * ramp has to follow the sky's own turns. Each stop is one exact row, so sky[0]
 * and the last stop are the picture's true first and last rows. */
const SKY_STOPS = 24;
function skyStops(img, n) {
  const c = document.createElement("canvas");
  c.width = 2; c.height = n;
  const g = c.getContext("2d");
  const w = img.naturalWidth, h = img.naturalHeight;
  const edge = Math.max(1, Math.round(w * 0.02)); // wide enough to average the grain out
  for (let i = 0; i < n; i++) {
    const y = Math.round((i / (n - 1)) * (h - 1));
    g.drawImage(img, 0, y, edge, 1, 0, i, 1, 1);
    g.drawImage(img, w - edge, y, edge, 1, 1, i, 1, 1);
  }
  const d = g.getImageData(0, 0, 2, n).data;
  const mid = (a, b) => (d[a] + d[b]) >> 1; // the two sides, averaged into one ramp
  return Array.from({ length: n }, (_, i) => {
    const l = i * 8, r = l + 4;
    return `rgb(${mid(l, r)},${mid(l + 1, r + 1)},${mid(l + 2, r + 2)})`;
  });
}

/** Show or hide the splash. Local, idempotent, and the pill's label follows it
 * so the one control always says where it goes rather than where you are.
 *
 * Raising it the FIRST time also runs the finale beat Goomba's splash runs
 * (drawSplash there, `#splash.intro` here): the cheer pops on, and the code
 * word rises a beat later. Once only, because unlike Goomba's finale this
 * screen has a way back — someone returning to re-read the word should find it
 * already up rather than wait through the beat again. `syncWon` re-arms it if
 * the win is ever taken back. */
export function setSplash(open) {
  const rising = !splashOpen;
  splashOpen = open && hexWon(game); // no splash without the win
  if (splashOpen && rising && !introPlayed) {
    introPlayed = true;
    splashEl.classList.add("intro");
  }
  splashEl.classList.toggle("on", splashOpen);
  // The picture alone was decoration; the code word is something to read, so
  // the screen stops hiding itself from a reader while it is up.
  splashEl.setAttribute("aria-hidden", splashOpen ? "false" : "true");
  wonPillEl.textContent = splashOpen ? "← back to game" : "🏆 win screen";
}

/** The pill's whole job: whichever of the two views you are not looking at. */
export function toggleSplash() {
  setSplash(!splashOpen);
}

/** A PROJECTION of `legibleAt`, the same way syncPhase is one of the night:
 * every snapshot re-asserts it, so starting over (or the 🛠 panel taking the
 * win back) drops the splash and retires the pill with no inverse to write. */
export function syncWon() {
  const won = hexWon(game);
  wonPillEl.classList.toggle("on", won);
  if (!won) {
    setSplash(false);
    // A taken-back win (or a reset) re-arms the beat: the next one is an
    // arrival again.
    introPlayed = false;
    splashEl.classList.remove("intro");
  }
}

// The night-transition CUTSCENE. Fired once, only on the live day->night edge —
// never on load or a preset — so a returning player drops straight
// into night. A transparent veil locks ALL input while the beat plays.
let cutsceneLock = false;
// How long #dock takes to slide back in. Mirrors the .5s transition on #dock;
// only decides how long the returning shop stays inert (#dock.settling).
const DOCK_SLIDE_MS = 500;
export function runNightCutscene() {
  if (cutsceneLock) return;
  cutsceneLock = true;
  // `dissolving` (the beat's transition delays) is added by main.js BEFORE
  // syncPhase and removed at the end of the beat. A restored save never gets it.
  dockEl.classList.add("cutscene-hidden"); // shut the whole static shop for the reveal
  cutsceneVeilEl.classList.add("on"); // nothing selectable while the beat plays
  // Keep in sync with the CSS: YAWN_MS (1300) + ZZZ_HOLD_MS (2000, she holds
  // still while the first zzz drift off) + the #catPose zoom (1800ms). The veil
  // has to outlast all three, or the shop comes back over a cat still mid-move.
  setTimeout(() => {
    cutsceneVeilEl.classList.remove("on");
    dockEl.classList.remove("cutscene-hidden"); // slides back up as the reveal settles
    dockEl.classList.add("settling");           // ...and stays untappable until it lands
    setTimeout(() => dockEl.classList.remove("settling"), DOCK_SLIDE_MS);
    document.body.classList.remove("dissolving");
    cutsceneLock = false;
  }, YAWN_MS + ZZZ_HOLD_MS + 1800);
}
