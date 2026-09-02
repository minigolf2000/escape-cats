// CLICK / PET. A pet credits the display optimistically and joins the next
// batched `pets` message; the server's snapshot reconciles within a tick.
// Night pets never leave the phone — Hex is asleep and the sleepy reaction is
// entirely local theatre.

import { stageEl, hexCatEl } from "./dom.js";
import { nightActive, clickGain, petCredit } from "./state.js";
import { fmt } from "./format.js";
import { floatNum, spawnMousePop } from "./fx.js";
import { refreshHud } from "./shop.js";
import { transport } from "./net";
import { squashPet, IDLE } from "./cat.js";

// Petting streak. Feeds two idle animations (the purr, and the slow blink she
// gives you for a sustained streak). Wall-clock, not frame count.
export const PET_STREAK_NEEDED = 6; // pets, within...
export const PET_STREAK_WINDOW_MS = 1200; // ...this gap of each other
export const petState = {
  lastPetAt: -1e9,
  petStreak: 0,
  slowBlinkStart: -1,
};

// Night-poke state: a fifth insistent tap escalates from "Zzz" to a grumble.
let lastPokeAt = -1e9,
  nightPokes = 0;
const NIGHT_GRUMBLE_POKES = 5;

export function pet(clientX, clientY) {
  const rect = stageEl.getBoundingClientRect();
  const x = clientX - rect.left,
    y = clientY - rect.top;

  // Night: Hex is asleep and petting is no longer a mechanic. The absence of
  // the "+N" the player has floated all day is the real signal.
  if (nightActive()) {
    const now = performance.now();
    if (now - lastPokeAt > PET_STREAK_WINDOW_MS) nightPokes = 0;
    nightPokes++;
    lastPokeAt = now;
    if (nightPokes >= NIGHT_GRUMBLE_POKES) {
      squashPet(true); // a bigger, annoyed stir
      floatNum(x, y, "grr…");
      nightPokes = 0;
    } else {
      squashPet(false); // a gentle half-stir
      floatNum(x, y, "Zzz");
    }
    return; // no mice, no mouse-pop, no HUD write, nothing sent
  }

  const gain = clickGain();
  // Where on Hex the finger landed, as a fraction of her box — stage px cannot
  // cross the wire, since a teammate's phone has Hex somewhere else at another
  // size. Measured against #hexCat so the fraction survives every layout.
  const cat = hexCatEl.getBoundingClientRect();
  // Queue first: the credit is held against the batch this tap leaves in.
  petCredit(
    gain,
    transport.queuePet(
      (clientX - cat.left) / cat.width,
      (clientY - cat.top) / cat.height,
    ),
  );
  // Every tap squashes; the streak beat below upgrades it, and squashPet ignores
  // a soft call landing on a big one already playing.
  squashPet(false);

  const now = performance.now();
  if (now - petState.lastPetAt > PET_STREAK_WINDOW_MS) petState.petStreak = 0;
  petState.petStreak++;
  petState.lastPetAt = now;
  // Earned, not periodic: she only offers the slow blink after you've kept it up.
  if (
    IDLE.slowBlink &&
    petState.petStreak >= PET_STREAK_NEEDED &&
    petState.slowBlinkStart < 0
  ) {
    petState.slowBlinkStart = now;
    petState.petStreak = 0;
    // The one day beat that earns the full drawn squash — the same threshold as
    // the slow blink, so "she really is being petted" has one meaning here.
    squashPet(true);
  }

  floatNum(x, y, "+" + fmt(gain));
  spawnMousePop(x, y);
  refreshHud();
}

// Hit-testing an SVG shape defaults to its painted area, so this alone makes
// petting require an actual tap on Hex's silhouette.
export function initPetInput() {
  hexCatEl.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      pet(e.clientX, e.clientY);
    },
    { passive: false },
  );
}
