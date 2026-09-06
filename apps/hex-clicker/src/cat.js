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
  lookEls,
  pupilLeftEl,
  pupilRightEl,
  eyeLeftEl,
  eyeRightEl,
  stageEl,
} from "./dom.js";
import { nightActive, zoomBuff } from "./state.js";
import { goldState } from "./golden.js";
import { petState } from "./pet.js";

// Pet -> cat animation channel. pet() calls squashPet(big); everything about
// HOW it plays lives here. A timed player — an explicit [frame, ms] list walked
// on wall-clock — never a per-frame decay: a decay is a frame-rate clock (twice
// as fast at 120Hz), gives each frame ~3 frames of screen time (a sprite swap
// under ~60ms reads as a glitch), and let an ordinary tap reset a big reaction
// mid-play.

// How far the PUPIL travels off-centre, in SVG user units of the 828x652 box.
// The v2 socket is ~132x129 against an ~85x77 pupil, so unlike v1's ~109x98 eye
// the room is nearly square. Sideways still gets the larger number because
// sideways is the range that READS — a golden mouse is far more often beside
// her than above her — but the gap is now 17/10 rather than 14/8. The socket
// clip is what lets these stay at full range: a glance pushes the dilated pupil
// AGAINST the rim rather than through it.
const LOOK_X = 17;
const LOOK_Y = 10;
// Pupil SIZE, on its own element so a blink never resets it. Rest is a slit
// (narrow on X, drawn height on Y); a golden mouse on screen — the one thing
// worth being excited about — opens it to a saucer, which the socket clip keeps
// inside the eye. The v2 sheet draws this range out as six keyframes — a dot,
// a disc, a filled round — and these two numbers are how one traced pupil
// covers all of them.
const PUPIL_SLIT = 0.34;
const PUPIL_ROUND = 1.35;

// The pet squash as the artist drew it: [frame, ms held], impact first (contact
// is instantaneous), then recovery. GRADED because the drawn squash folds the
// ears, and ear movement is meant to be a rare idle tell: the full sequence is
// held back for the two beats already treated as bigger, and an ordinary tap
// shows only the gentlest frame. Durations are the point — long enough to read
// as a pose, not a flicker.
const SQUASH_BIG = [["s3", 80], ["s2", 70], ["s1", 90]];
const SQUASH_SOFT = [["s1", 110]];

// ---- IDLE ANIMATIONS — one flag each, all independent. Nothing else reads
// these, so flipping one to false is the whole removal. ----
export const IDLE = {
  chatter: true,          // head quivers at a golden mouse she can't reach
  whiskersForward: true,  // leans toward that same golden mouse
  slowBlink: true,        // the "I trust you" blink, earned by a petting streak
  gazeDrift: true,        // eyes wander when there's nothing to look at
  purr: false,            // rumble while she's being petted
  yawn: true,             // one big yawn as she drops into the night phase
  dreamTwitch: true,      // rare whole-head jerk while dreaming
  headTilt: true,         // an occasional curious tip of the head
  earFlick: true,         // quick independent ear twitches
  earSwivel: true,        // ears prick toward a golden mouse
};
// chatter, whiskersForward and earSwivel are named for parts the drawn cat has
// only as painted pixels; each plays on the nearest channel the drawing offers
// (head quiver, lean, head turn). earFlick/earSwivel also drive the real ear
// layers — a perk from the base, not a rotation; see updateEars.

const SLOW_BLINK_MS = 1100;
const PURR_MS = 900;              // purr keeps going this long after the last pet
export const YAWN_MS = 1300;
// How long she stays put at full size after the yawn, so the zzz register before
// the camera leaves. Mirrored in CSS by #catPose's 3.3s transition-delay and
// #sleepZ's matching counter-scale delay — change one and change all three.
export const ZZZ_HOLD_MS = 2000;

const smoothstep = x => x * x * (3 - 2 * x);
const clamp01 = x => Math.min(1, Math.max(0, x));

// Lid 1 (wide) -> ~shut -> 1, with a deliberate HOLD at the bottom: a cat's
// slow blink is a held gesture, and without the hold this reads as lag.
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
  // The frame this pet is on, or null once finished. The .squash / .big classes
  // are what gives the NIGHT phase its feedback: the drawn frames are painted in
  // the day coat, so at night the same beat is a small CSS scale (styles.css).
  const squashPose = squashFrame(t);
  catEl.classList.toggle("squash", squashPose !== null);
  catEl.classList.toggle("big", squashBig && squashPose !== null);

  catEl.classList.toggle("zoomies", zoomBuff() > 1);

  const asleep = nightActive();

  // Yawn fires on the day->night EDGE, detected here rather than from the Catnap
  // purchase because night can also arrive by a save or a preset jump. `wasAsleep`
  // starting null means the first frame sets the baseline instead of yawning at boot.
  if (wasAsleep !== null && asleep && !wasAsleep && IDLE.yawn) yawnStart = t;
  wasAsleep = asleep;

  // --- Which head is on screen ------------------------------------------
  // The night coat outranks the squash entirely: the four squash frames are
  // drawn in the daytime coat, so playing one at night would flash a brown cat
  // onto a black one for two frames.
  let pose = "day";
  if (asleep) pose = "night";
  else if (squashPose) pose = squashPose;
  if (hexCatEl.dataset.pose !== pose) hexCatEl.dataset.pose = pose;

  // Both need a CONTINUOUS lid value, which .blink/.shut cannot express, so they
  // take the lids by writing an inline transform (beats a class rule) and hand
  // them back by clearing it; the elements' own .06s transition smooths each end.
  // Yawn outranks slow blink: it happens once, and it is the phase change.
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

  // The drawn sleeping eye replaces the ring only once the yawn has finished
  // closing them: swapped in at the START, the lash arc would appear full size
  // and then be squashed open by the yawn envelope, backwards.
  hexCatEl.classList.toggle("shut", asleep && !lidBusy);

  const blink = !asleep && !lidBusy && Math.sin(t / 1400) > 0.985;
  hexCatEl.classList.toggle("blink", blink);

  const lidT = lidBusy ? `scaleY(${lidOverride.toFixed(3)})` : "";
  if (eyeLeftEl.style.transform !== lidT) {
    eyeLeftEl.style.transform = lidT;
    eyeRightEl.style.transform = lidT;
  }

  // Look: toward the golden mouse by day; roving under the lashes at night.
  // JS-owned, not a class: a gaze is a continuous direction. No vertical squash
  // here — the look group sits inside the lid group, so the lid's scaleY already
  // carries the pupil; applying it twice shut her eyes at the square.
  let lookX = 0, lookY = 0;
  if (asleep && !lidBusy) {
    // REM: lids shut, eyes roving underneath — she is dreaming the wall you are
    // watching. Two out-of-phase sines so it never reads as a loop; this moves
    // the whole lash arc, so it stays under a lash-width per swing.
    lookX = 5 * Math.sin(t / 3100) + 2.5 * Math.sin(t / 1130);
  } else if (!asleep && goldState.active) {
    const cx = stageEl.clientWidth / 2, cy = stageEl.clientHeight / 2;
    const dx = (goldState.x + 31) - cx, dy = (goldState.y + 31) - cy; // golden mouse's own center, stage-relative
    const mag = Math.hypot(dx, dy) || 1;
    lookX = (dx / mag) * LOOK_X;
    lookY = (dy / mag) * LOOK_Y;
  } else if (!asleep && IDLE.gazeDrift) {
    // Nothing to look at, so she looks at nothing in particular. Without this
    // she stares dead ahead for the ~40-90s between goldens, which is most of
    // the game. Sines are MULTIPLIED, not added: one sine is a metronome
    // sweeping at constant speed, but the product stalls near either factor's
    // zero-crossing, so she drifts, dwells, drifts — closer to looking at
    // things than scanning for them.
    lookX = LOOK_X * 0.5 * Math.sin(t / 2300) * Math.sin(t / 5700);
    lookY = LOOK_Y * 0.3 * Math.sin(t / 3300) * Math.sin(t / 7100);
  }
  // Widened while awake AND excited: a golden on screen, or Zoomies running (so
  // her eyes stay wide through the sprint rather than snapping shut when the
  // mouse is gone). Never during sleep, matching the look branch above.
  const lookT = `translate(${lookX.toFixed(2)}px, ${lookY.toFixed(2)}px)`;
  for (const el of lookEls) el.style.transform = lookT;
  // Dilation lands one level in, on the pupils, so it composes with the look
  // and stays off the shut-lash arc. Rest opens on X alone (a slit); dilating
  // grows BOTH axes, so a saucer reads as opening rather than stretching.
  const wide = !asleep && (goldState.active || zoomBuff() > 1);
  const r = PUPIL_ROUND;
  const pupilT = wide ? `scale(${r}, ${r})` : `scale(${PUPIL_SLIT}, 1)`;
  if (pupilLeftEl.style.transform !== pupilT) {
    pupilLeftEl.style.transform = pupilT;
    pupilRightEl.style.transform = pupilT;
  }

  // "Alert" = awake with a golden actually on screen. It drives the chatter and
  // the lean, and it's the same condition the eye widening above uses — one idea
  // (prey is out there), three tells.
  const alert = !asleep && goldState.active;

  // --- Whole-head micro-motion (#catMotion) ------------------------------
  // Purr keeps running briefly after the last pet, so a steady petting rhythm
  // reads as one continuous rumble rather than restarting on every tap.
  const purring = IDLE.purr && !asleep && (t - petState.lastPetAt) < PURR_MS;
  // ~14Hz. A real purr is ~25Hz, which is past what 60fps can show — this is
  // the fastest rumble that still renders as motion instead of aliasing.
  const purrY = purring ? 0.8 * Math.sin(t / 11) : 0;
  const dreamY = dreamTwitchOffset(t, asleep);
  // CHATTER: the "ekekek" at prey, played as a whole-head quiver at the jaw's
  // ~11Hz. Small — it rides on the purr and must not read as a second, faster one.
  const chatterY = (IDLE.chatter && alert && !lidBusy && yawnP < 0)
    ? 0.9 * Math.sin(t / 14) : 0;
  const motionY = purrY + dreamY + chatterY;
  const motionT = motionY ? `translateY(${motionY.toFixed(2)}px)` : "";
  if (catMotionEl.style.transform !== motionT) catMotionEl.style.transform = motionT;

  // --- Head tilt + lean --------------------------------------------------
  // Both rest at night (the wall-reveal pose owns Hex then).
  if (asleep) {
    if (catFaceEl.style.transform) catFaceEl.style.transform = "";
  } else {
    const tilt = headTiltDeg(t, !alert); // only tips her head when nothing's got her attention
    // EAR SWIVEL, played as a head turn toward the golden. Added to the tilt
    // rather than composed, since both rotate about the same neck pivot.
    const swivel = (IDLE.earSwivel && alert)
      ? Math.max(-1, Math.min(1, ((goldState.x + 31) - stageEl.clientWidth / 2) / (stageEl.clientWidth / 2))) * 4
      : 0;
    // WHISKERS FORWARD, played as a lean toward the thing she wants. 2% is under
    // conscious notice, which is right: a whisker tell, not a pounce.
    const lean = (IDLE.whiskersForward && alert) ? 1.02 : 1;
    const rot = tilt + swivel;
    const faceT = (rot || lean !== 1)
      ? `rotate(${rot.toFixed(2)}deg) scale(${lean})` : "";
    if (catFaceEl.style.transform !== faceT) catFaceEl.style.transform = faceT;
  }

  updateEars(t, asleep, alert);
}

// EARS — a perk from the BASE (scaleY), not a rotation: each ear is a slice cut
// out of one continuous hand-drawn line, and rotating it nicks that line at
// Hex's real size (see the pivot note in index.html). A sustained perk while
// prey is on screen plus quick twitches on top; each ear keeps its own schedule
// so they fire out of sync.
const EAR_PERK_MS = 260;
const EAR_TWITCH = 0.09;   // scaleY added at the peak of a twitch
const EAR_ALERT = 0.05;    // held while a golden is out there
const earStateL = { at: 0, start: -1 };
const earStateR = { at: 0, start: -1 };
function earTwitch(t, ear) {
  if (!IDLE.earFlick) return 0;
  if (!ear.at) ear.at = t + 2500 + Math.random() * 6000;
  if (ear.start < 0 && t >= ear.at) { ear.start = t; ear.at = t + 3500 + Math.random() * 8000; }
  if (ear.start < 0) return 0;
  const e = t - ear.start;
  if (e >= EAR_PERK_MS) { ear.start = -1; return 0; }
  return EAR_TWITCH * Math.sin(Math.PI * e / EAR_PERK_MS);
}
function updateEars(t, asleep, alert) {
  // Rest at night: the wall-reveal pose owns Hex, and the night coat is one piece.
  if (asleep) {
    if (earLeftEl.style.transform) earLeftEl.style.transform = "";
    if (earRightEl.style.transform) earRightEl.style.transform = "";
    earStateL.at = earStateR.at = 0;
    return;
  }
  const held = (IDLE.earSwivel && alert) ? EAR_ALERT : 0;
  for (const [el, ear] of [[earLeftEl, earStateL], [earRightEl, earStateR]]) {
    const s = 1 + held + earTwitch(t, ear);
    const v = s === 1 ? "" : `scaleY(${s.toFixed(3)})`;
    if (el.style.transform !== v) el.style.transform = v;
  }
}

// The squash player. An ordinary tap can never downgrade a big one already
// running; a big one always restarts, and soft-on-soft restarts too, so a steady
// petting rhythm keeps her squashed rather than popping in and out.
let squashSeq = null, squashAt = 0, squashBig = false;
export function squashPet(big) {
  if (squashSeq && squashBig && !big) return;
  squashSeq = big ? SQUASH_BIG : SQUASH_SOFT;
  squashBig = big;
  squashAt = performance.now();
}
// Wall-clock, not a per-frame decrement, so the sequence lasts the same wall time
// at 60Hz and 120Hz. `t` is the frame loop's rAF timestamp, same origin as the
// performance.now() stamped above.
function squashFrame(t) {
  if (!squashSeq) return null;
  let e = t - squashAt;
  for (const [frame, ms] of squashSeq) {
    if (e < ms) return frame;
    e -= ms;
  }
  squashSeq = null;
  return null;
}

// Dream twitch: one whole-head jerk every ~9-20s while asleep — rarer and
// bigger than the ear twitch, so the two read as one animal at two intensities.
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

// POSE FRAMES, OFF THE CRITICAL PATH. All five heads and four shadows are in the
// served markup so a pose swap is a `visibility` flip — but an SVG <image> has
// no `loading="lazy"`, and fetching all eleven before first paint made
// #headNight (the SLEEPING cat) the page's LCP. So the frames that cannot be on
// screen at boot park their URL in `data-href` and land here, one idle callback
// after the page is up; the 2s deadline beats the first pet on any phone, and a
// pet cannot land before the room's first snapshot anyway. The paths are
// BASE_URL-relative: Vite rewrites `href` through `base` but not `data-href`.
export function warmPoseFrames() {
  const land = () => {
    for (const el of hexCatEl.querySelectorAll("[data-href]")) {
      el.setAttribute("href", import.meta.env.BASE_URL + el.dataset.href);
      el.removeAttribute("data-href");
    }
  };
  if (typeof requestIdleCallback === "function")
    requestIdleCallback(land, { timeout: 2000 });
  else setTimeout(land, 200);
}
