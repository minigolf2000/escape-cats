// CAT rendering — the SVG (#hexCat) is static markup; this toggles classes /
// state on it per frame (squash bounce, blink, gaze, Zoomies recolor, dream
// twitches). Entirely local theatre: nothing here reads the network, only the
// mirrored state and the shared animation scratch below.

import {
  catEl,
  hexCatEl,
  catMotionEl,
  catFaceEl,
  earLeftEl,
  earRightEl,
  irisLeftEl,
  irisRightEl,
  eyeLeftEl,
  eyeRightEl,
  whiskersEl,
  mouthEl,
  stageEl,
} from "./dom.js";
import { nightActive, zoomBuff } from "./state.js";
import { goldState } from "./golden.js";
import { petState } from "./pet.js";

// Pet -> cat animation channel: pet() sets it, updateCat eases it back down.
export const anim = { squash: 0 };

// ---------------------------------------------------------------------------
// CAT rendering — the SVG (#hexCat) is static markup; this just toggles
// classes/state on it per frame (squash bounce, blink, Zoomies recolor).
// ---------------------------------------------------------------------------
const IRIS_LOOK = 4; // svg user-units the iris can travel off-center before it'd clip the socket
// Pupil width — independent of the eyelid squash below, and on its own axis
// (X, not Y) so a blink never resets it. Real cats rest with a vertical slit
// and round out when aroused; a golden mouse on screen is the one thing this
// game has to be excited about, so it's the trigger. `#irisLeft`/`#irisRight`
// are the pupils, not the iris — see hex-cat.svg's header comment for why the
// ids still say "iris" after the coloring flipped.
const PUPIL_SLIT = 0.22;  // resting
const PUPIL_ROUND = 1;    // dilated

// ---------------------------------------------------------------------------
// IDLE ANIMATIONS — one flag each, all independent. These are cat behaviours
// picked to hang off game state that already exists, so none of them invent a
// new mechanic. Flip any to false to cut it; nothing else reads these, so a
// single word here is the whole removal.
// ---------------------------------------------------------------------------
export const IDLE = {
  chatter: true,          // jaw quivers at a golden mouse she can't reach
  whiskersForward: true,  // whiskers fan toward that same golden mouse
  slowBlink: true,        // the "I trust you" blink, earned by a petting streak
  gazeDrift: true,        // eyes wander when there's nothing to look at
  purr: false,            // rumble while she's being petted
  yawn: true,             // one big yawn as she drops into the night phase
  dreamTwitch: true,      // rare whole-head jerk while dreaming
  headTilt: true,         // an occasional curious tip of the head
  earFlick: true,         // quick independent ear twitches
  earSwivel: true,        // ears orient toward a golden mouse
};

const SLOW_BLINK_MS = 1100;
const PURR_MS = 900;              // purr keeps going this long after the last pet
export const YAWN_MS = 1300;
// How long she stays put at full size after the yawn, so the zzz register before
// the camera leaves. Mirrored in CSS by #catPose's 3.3s transition-delay and
// #sleepZ's matching counter-scale delay — change one and change all three.
export const ZZZ_HOLD_MS = 2000;

const smoothstep = x => x * x * (3 - 2 * x);
const clamp01 = x => Math.min(1, Math.max(0, x));

// Lid 1 (wide) -> ~shut -> 1, with a deliberate HOLD at the bottom. The hold is
// the entire difference between a slow blink and a long blink: a cat's slow
// blink is a held gesture, not a slow motion. Without it this just reads as
// lag.
function slowBlinkLid(p) {
  const CLOSE = 0.30, HOLD = 0.34;
  if (p < CLOSE) return 1 - 0.95 * smoothstep(p / CLOSE);
  if (p < CLOSE + HOLD) return 0.05;
  return 0.05 + 0.95 * smoothstep((p - CLOSE - HOLD) / (1 - CLOSE - HOLD));
}
// Yawn: one 0->1->0 arc driving lids shut and jaw open together, peaking
// midway. Same envelope for both so the squeeze and the gape can't desync.
const yawnEnv = p => Math.sin(Math.PI * clamp01(p));

let wasAsleep = null, yawnStart = -1;
export function updateCat(t) {
  catEl.classList.toggle("anim.squash", anim.squash > 0.15);
  if (anim.squash > 0) anim.squash = Math.max(0, anim.squash - 0.08);

  catEl.classList.toggle("zoomies", zoomBuff() > 1);

  const asleep = nightActive();

  // Yawn fires on the day->night EDGE: she yawns herself to sleep, which is the
  // one story beat this game has. Edge-detected here rather than fired from the
  // Catnap purchase because night can also arrive by loading a save or a dev
  // preset jump — and `wasAsleep` starting null means the very first frame
  // establishes the baseline instead of yawning at you on boot.
  if (wasAsleep !== null && asleep && !wasAsleep && IDLE.yawn) yawnStart = t;
  wasAsleep = asleep;

  // --- Lid overrides: the yawn and the slow blink -------------------------
  // Both need a CONTINUOUS lid value, which .blink/.asleep can't express —
  // they're binary classes. So they take the lids by writing an inline
  // transform (which beats a class rule outright) and hand them back by
  // clearing it. #eyeLeft/#eyeRight's own .06s transition just smooths the
  // handoff at each end. Yawn outranks slow blink: it only happens once, and
  // it's the phase change.
  let lidOverride = null, yawnP = -1;
  if (yawnStart >= 0) {
    yawnP = (t - yawnStart) / YAWN_MS;
    if (yawnP >= 1) { yawnStart = -1; yawnP = -1; }
    else lidOverride = 1 - 0.93 * yawnEnv(yawnP);
  }
  if (lidOverride === null && petState.slowBlinkStart >= 0) {
    const p = (t - petState.slowBlinkStart) / SLOW_BLINK_MS;
    if (p >= 1) petState.slowBlinkStart = -1;
    else lidOverride = slowBlinkLid(p);
  }
  const lidBusy = lidOverride !== null;

  // asleep at night — the .asleep class owns the eyelids, so never fight it.
  // Suppressed while a lid override is running too, or the class would snap the
  // lids the instant the override let go.
  const blink = !asleep && !lidBusy && Math.sin(t / 1400) > 0.985;
  hexCatEl.classList.toggle("blink", blink);

  const lidT = lidBusy ? `scaleY(${lidOverride.toFixed(3)})` : "";
  if (eyeLeftEl.style.transform !== lidT) {
    eyeLeftEl.style.transform = lidT;
    eyeRightEl.style.transform = lidT;
  }

  // Iris: look toward the golden mouse by day; shut with the lids at night.
  // Owned entirely by JS (not a CSS class) because it has to combine a
  // look-direction translate with the same squash the lids get via .blink/
  // .asleep — an inline transform always wins over a class rule's transform,
  // so splitting this across CSS classes + JS would just fight itself.
  let lookX = 0, lookY = 0, irisScaleY = 1;
  if (lidBusy) {
    // The pupil has to ride the lid down, or it sits there full-size behind a
    // shut eye — the exact bug this block's comment already warns about.
    irisScaleY = Math.max(lidOverride, 0.05);
  } else if (asleep) {
    // REM: the lids stay shut but the eyes rove underneath, and the eyelid
    // gap swells a hair. Deliberately thematic — she's dreaming the wall
    // you're watching. Two out-of-phase sines so it never reads as a clean
    // loop.
    irisScaleY = 0.07 + 0.045 * (0.5 + 0.5 * Math.sin(t / 2600));
    lookX = 1.6 * Math.sin(t / 3100) + 0.7 * Math.sin(t / 1130);
  } else if (blink) {
    irisScaleY = 0.14;
  } else if (goldState.active) {
    const cx = stageEl.clientWidth / 2, cy = stageEl.clientHeight / 2;
    const dx = (goldState.x + 31) - cx, dy = (goldState.y + 31) - cy; // golden mouse's own center, stage-relative
    const mag = Math.hypot(dx, dy) || 1;
    lookX = (dx / mag) * IRIS_LOOK;
    lookY = (dy / mag) * IRIS_LOOK;
  } else if (IDLE.gazeDrift) {
    // Nothing to look at, so she looks at nothing in particular. Without this
    // she stares dead ahead for the ~40-90s between goldens, which is most of
    // the game. Sines are MULTIPLIED, not added: one sine is a metronome
    // sweeping at constant speed, but the product stalls near either factor's
    // zero-crossing, so she drifts, dwells, drifts — closer to looking at
    // things than scanning for them.
    lookX = IRIS_LOOK * 0.5 * Math.sin(t / 2300) * Math.sin(t / 5700);
    lookY = IRIS_LOOK * 0.3 * Math.sin(t / 3300) * Math.sin(t / 7100);
  }
  // Dilated while awake AND excited: either a golden is actually out there, or
  // Zoomies is running (pets worth more) — the buff a caught golden leaves
  // behind, so her eyes stay blown wide through the sprint rather than
  // snapping shut the instant the mouse is gone. Not during sleep even if a
  // golden is drifting past, matching the branch above where asleep never looks
  // toward it either. #irisLeft/#irisRight's own CSS transition (.12s ease-out)
  // is what makes this a dilate rather than a snap.
  const pupilScaleX = (!asleep && (goldState.active || zoomBuff() > 1)) ? PUPIL_ROUND : PUPIL_SLIT;
  const irisTransform = `translate(${lookX}px, ${lookY}px) scale(${pupilScaleX}, ${irisScaleY})`;
  irisLeftEl.style.transform = irisTransform;
  irisRightEl.style.transform = irisTransform;

  // --- Jaw: yawn, else chatter -------------------------------------------
  // "Alert" = awake with a golden actually on screen. It drives the chatter and
  // the whisker fan, and it's the same condition the pupil dilation above uses
  // — one idea (prey is out there), three tells.
  const alert = !asleep && goldState.active;
  let mouthScaleY = 1, mouthScaleX = 1;
  if (yawnP >= 0) {
    // Ceiling of 2.2 is geometric, not taste: the mouth is a 13-unit lip line
    // topped at y=147 and scaled from its own top edge, while the head's inner
    // chin sits at ~182 — so anything past ~2.4 stretches the jaw straight
    // through her face and hangs it outside the silhouette. Measured, not
    // guessed (mouth.getBBox() vs head.getBBox()); re-measure if the art moves.
    // X widens too, because a gape is wide — scaling Y alone just draws a
    // longer squiggle, not an open mouth.
    mouthScaleY = 1 + 1.2 * yawnEnv(yawnP);
    mouthScaleX = 1 + 0.5 * yawnEnv(yawnP);
  } else if (IDLE.chatter && alert && !lidBusy) {
    // The "ekekek" chatter at prey behind glass — here, a golden mouse drifting
    // past a cat who is a head and can do nothing about it. ~11Hz: fast enough
    // to read as a quiver, slow enough to survive a 60fps sample (above ~15Hz
    // it aliases into a blur).
    mouthScaleY = 1 + 0.5 * (0.5 + 0.5 * Math.sin(t / 14));
  }
  const mouthT = (mouthScaleY === 1 && mouthScaleX === 1)
    ? "" : `scale(${mouthScaleX.toFixed(3)}, ${mouthScaleY.toFixed(3)})`;
  if (mouthEl.style.transform !== mouthT) mouthEl.style.transform = mouthT;

  // --- Whole-head micro-motion (#catMotion) ------------------------------
  // Purr keeps running briefly after the last pet, so a steady petting rhythm
  // reads as one continuous rumble rather than restarting on every tap.
  const purring = IDLE.purr && !asleep && (t - petState.lastPetAt) < PURR_MS;
  // ~14Hz. A real purr is ~25Hz, which is past what 60fps can show — this is
  // the fastest rumble that still renders as motion instead of aliasing.
  const purrY = purring ? 0.8 * Math.sin(t / 11) : 0;
  const dreamY = dreamTwitchOffset(t, asleep);
  const motionT = (purrY || dreamY) ? `translateY(${(purrY + dreamY).toFixed(2)}px)` : "";
  if (catMotionEl.style.transform !== motionT) catMotionEl.style.transform = motionT;

  // --- Head tilt + ears --------------------------------------------------
  // All three rest at night (the wall-reveal pose owns Hex then).
  if (asleep) {
    if (catFaceEl.style.transform) catFaceEl.style.transform = "";
    if (earLeftEl.style.transform) earLeftEl.style.transform = "";
    if (earRightEl.style.transform) earRightEl.style.transform = "";
  } else {
    const tilt = headTiltDeg(t, !alert); // only tips her head when nothing's got her attention
    const faceT = tilt ? `rotate(${tilt.toFixed(2)}deg)` : "";
    if (catFaceEl.style.transform !== faceT) catFaceEl.style.transform = faceT;
    // ears orient toward a golden mouse (like the eyes/whiskers), with quick
    // independent flicks superimposed
    let swiv = 0;
    if (IDLE.earSwivel && alert) {
      const cx = stageEl.clientWidth / 2;
      swiv = Math.max(-1, Math.min(1, ((goldState.x + 31) - cx) / cx)) * 6;
    }
    const rotL = swiv + earFlickDeg(t, earStateL);
    const rotR = swiv + earFlickDeg(t, earStateR);
    const eLT = rotL ? `rotate(${rotL.toFixed(2)}deg)` : "";
    const eRT = rotR ? `rotate(${rotR.toFixed(2)}deg)` : "";
    if (earLeftEl.style.transform !== eLT) earLeftEl.style.transform = eLT;
    if (earRightEl.style.transform !== eRT) earRightEl.style.transform = eRT;
  }

  updateWhiskers(t, asleep, alert);
}

// Dream twitch: a single whole-head jerk every ~9-20s while asleep, the
// paw-running dream. Deliberately rarer and bigger than the whisker twitch so
// the two read as one animal at two intensities rather than a shared tic.
// Scheduled, not sine-driven, for the same reason as the whiskers.
let dreamAt = 0, dreamUntil = 0, dreamDir = 1;
const DREAM_MS = 220;
function dreamTwitchOffset(t, asleep) {
  if (!asleep || !IDLE.dreamTwitch) { dreamAt = 0; return 0; }
  if (!dreamAt) dreamAt = t + 6000 + Math.random() * 9000;
  if (t >= dreamAt) {
    dreamUntil = t + DREAM_MS;
    dreamDir = Math.random() < 0.5 ? -1 : 1;
    dreamAt = t + 9000 + Math.random() * 11000;
  }
  if (t >= dreamUntil) return 0;
  // One damped bounce over the twitch's life, not a loop — a twitch is a single
  // event that dies out, so amplitude has to decay to zero by the end or it
  // would cut off mid-motion.
  const p = 1 - (dreamUntil - t) / DREAM_MS;
  return dreamDir * 3.2 * Math.sin(p * Math.PI * 2) * (1 - p);
}

// Head tilt: an occasional curious tip of the head, pivoting at the neck. A
// discrete scheduled gesture (ease in -> hold -> ease out), like the dream
// twitch — she only offers it when nothing else has her attention (`calm`).
let tiltAt = 0, tiltStart = -1, tiltDir = 1;
const TILT_IN = 430, TILT_HOLD = 950, TILT_OUT = 640, TILT_MAX = 7;
function headTiltDeg(t, calm) {
  if (!IDLE.headTilt) return 0;
  if (!tiltAt) tiltAt = t + 6000 + Math.random() * 9000;
  if (tiltStart < 0 && calm && t >= tiltAt) {
    tiltStart = t; tiltDir = Math.random() < 0.5 ? -1 : 1;
    tiltAt = t + 9000 + Math.random() * 12000;
  }
  if (tiltStart < 0) return 0;
  const e = t - tiltStart, dur = TILT_IN + TILT_HOLD + TILT_OUT;
  if (e >= dur) { tiltStart = -1; return 0; }
  let a;
  if (e < TILT_IN) a = smoothstep(e / TILT_IN);
  else if (e < TILT_IN + TILT_HOLD) a = 1;
  else a = 1 - smoothstep((e - TILT_IN - TILT_HOLD) / TILT_OUT);
  return tiltDir * TILT_MAX * a;
}

// Ear flick: a quick 0 -> peak -> 0 twitch of one ear over a quarter-second.
// Each ear keeps its own schedule so they fire out of sync, the way a real
// cat's do; sign points each ear's flick outward.
const EAR_FLICK_MS = 240;
const earStateL = { at: 0, start: -1, sign: -1 };
const earStateR = { at: 0, start: -1, sign: 1 };
function earFlickDeg(t, ear) {
  if (!IDLE.earFlick) return 0;
  if (!ear.at) ear.at = t + 2500 + Math.random() * 6000;
  if (ear.start < 0 && t >= ear.at) { ear.start = t; ear.at = t + 3500 + Math.random() * 8000; }
  if (ear.start < 0) return 0;
  const e = t - ear.start;
  if (e >= EAR_FLICK_MS) { ear.start = -1; return 0; }
  return ear.sign * 11 * Math.sin(Math.PI * e / EAR_FLICK_MS);
}

// Whiskers have two behaviours and one element, so they get one owner:
//   asleep — a single flick every ~5-11s, chasing something in a dream.
//            Scheduled rather than sine-driven so it stays irregular; a
//            periodic twitch reads as a machine, not an animal.
//   awake  — fanned forward whenever prey is on screen (`alert`).
// They're mutually exclusive by construction (you can't be alert while asleep),
// which is why one function can hand back a single transform without blending.
let twitchAt = 0, twitchUntil = 0, twitchDir = 1;
function updateWhiskers(t, asleep, alert) {
  let w = "";
  if (!asleep) {
    twitchAt = 0;
    // Fanned forward at prey. A scale, not a rotate, and not per-whisker: all
    // six whiskers are one <path>, so they can only ever move together — the
    // same constraint that rules out independent ear flicks on this art.
    if (IDLE.whiskersForward && alert) w = "scale(1.07, 1.12)";
  } else {
    if (!twitchAt) twitchAt = t + 4000 + Math.random() * 6000;
    if (t >= twitchAt) {
      twitchUntil = t + 320;
      twitchDir = Math.random() < 0.5 ? -1 : 1;
      twitchAt = t + 5000 + Math.random() * 6000;
    }
    if (t < twitchUntil) w = `rotate(${twitchDir * 1.6}deg)`;
  }
  if (whiskersEl.style.transform !== w) whiskersEl.style.transform = w;
}

