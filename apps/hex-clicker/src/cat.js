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
  stageEl,
} from "./dom.js";
import { nightActive, zoomBuff } from "./state.js";
import { goldState } from "./golden.js";
import { petState } from "./pet.js";

// Pet -> cat animation channel. pet() calls squashPet(big); everything about HOW
// it plays lives here.
//
// This used to be a scalar that pet() set to 1 and updateCat decayed by 0.08 EVERY
// FRAME, with the current frame picked by thresholding it. Three things were
// wrong with that, and together they are what made petting feel broken:
//
//   1. 0.08/frame is a frame-rate clock. The whole squash ran 167ms on a 60Hz
//      screen and 83ms on a 120Hz one, so the animation was literally twice as
//      fast on a ProMotion phone as on the desktop it was tuned on.
//   2. Each drawn frame got ~3 frames of screen time (~50ms, ~25ms at 120Hz).
//      Below about 60ms a sprite swap stops reading as motion and starts reading
//      as a glitch — and these frames differ a lot, so it flashed.
//   3. Worst: a tap RESET the scalar and its stir flag, so the very next tap
//      during a petting streak downgraded the big reaction mid-play. Measured on
//      a 6-tap streak, the flattest frame showed for 50ms and the middle frame
//      never appeared at all. The one moment the artist's animation was supposed
//      to play was the one moment it got cut off.
//
// So it is a timed player now: an explicit [frame, ms] list, advanced against the
// same clock the frame loop already carries, and a big reaction cannot be
// downgraded by an ordinary tap landing on top of it.
export const anim = { squash: 0 };

// ---------------------------------------------------------------------------
// CAT rendering — the SVG (#hexCat) is static markup; this just toggles
// classes/state on it per frame (squash bounce, blink, Zoomies recolor).
// ---------------------------------------------------------------------------
// SVG user-units a ring can travel off-center before it'd cross the coat's edge.
// 17 in the drawing's 828-wide box, which is the same fraction of her face the
// old vector cat's 4-in-200 was — the number grew because the viewBox did.
const IRIS_LOOK = 17;
// Eye WIDTH — independent of the eyelid squash, and on its own axis (X, not Y)
// so a blink never resets it. Real cats rest narrow and open up when aroused; a
// golden mouse on screen is the one thing this game has to be excited about, so
// it's the trigger.
//
// This used to be pupil width, 0.22 -> 1: a slit dilating to a disc. The drawn
// eye has NO pupil — it's a hollow ring — so there is no slit to open. Dilation
// re-reads as the ring itself growing, which is what a ring eye can say, and the
// range is small for the same reason: at 1.0 -> 1.14 it's a widening; push it to
// the old 4.5x ratio and her eyes leave her head. Same trigger, same tell, sized
// to what the art can carry.
const PUPIL_SLIT = 1;     // resting
const PUPIL_ROUND = 1.14; // dilated

// The pet squash, as the artist drew it: four registered frames, held in order.
// This is the one animation that came out of the art file as an ANIMATION rather
// than as a pose, so it plays as frames rather than as a CSS scale.
// `anim.squash` decays 1 -> 0 at 0.08/frame (~12 frames, ~200ms), and these
// thresholds cut that into three held steps plus the return to rest. Descending
// order, because squash counts DOWN: hardest flatten first, easing back up.
// GRADED, because the artist's squash folds the ears as part of the same drawn
// gesture and there is no way to subtract them from it. Ear movement is supposed
// to be an idle tell — rare, and hers rather than the player's — so the full
// sequence is held back for the two beats the game already treats as a bigger
// reaction, and an ordinary tap only ever shows the gentlest frame, where the
// ears barely move.
//
// Impact first, then recovery: contact in a real squash is instantaneous, so the
// flattest frame leads and the rest is her head coming back up. Durations are the
// point of the list — each frame gets long enough to be seen as a pose rather
// than a flicker.
const SQUASH_BIG = [["s3", 80], ["s2", 70], ["s1", 90]];
const SQUASH_SOFT = [["s1", 110]];

// ---------------------------------------------------------------------------
// IDLE ANIMATIONS — one flag each, all independent. These are cat behaviours
// picked to hang off game state that already exists, so none of them invent a
// new mechanic. Flip any to false to cut it; nothing else reads these, so a
// single word here is the whole removal.
// ---------------------------------------------------------------------------
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
// Three of these were named for parts the vector cat had as separate shapes and
// the drawn cat has as painted pixels — there is no jaw, no whisker path and no
// ear group to address any more. Rather than delete the behaviours, each moved
// to the nearest channel the drawing still offers: chatter became a head
// quiver, whiskersForward became a lean, earSwivel became a head turn. The
// flags keep their old names so the table still reads as a list of cat
// behaviours rather than a list of transforms.
// `earFlick` and `earSwivel` are back on real ear elements — the day coat is
// split into a head plus two ear layers, so the ears move on their own again.
// Both are expressed as a perk from the ear's base rather than a rotation; see
// updateEars for why.

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
  // The frame this pet is on, or null once it has finished. Also the .squash /
  // .big classes, which are what gives the NIGHT phase its feedback: the drawn
  // frames are painted in the day coat and cannot play over the black one, so at
  // night the same beat is a small CSS scale instead (see index.html).
  // (The class was previously toggled as "anim.squash" — a token with a dot in
  // it, which no selector can ever match — so night pets moved nothing at all.)
  const squashPose = squashFrame(t);
  catEl.classList.toggle("squash", squashPose !== null);
  catEl.classList.toggle("big", squashBig && squashPose !== null);
  anim.squash = squashPose === null ? 0 : 1;

  catEl.classList.toggle("zoomies", zoomBuff() > 1);

  const asleep = nightActive();

  // Yawn fires on the day->night EDGE: she yawns herself to sleep, which is the
  // one story beat this game has. Edge-detected here rather than fired from the
  // Catnap purchase because night can also arrive by loading a save or a dev
  // preset jump — and `wasAsleep` starting null means the very first frame
  // establishes the baseline instead of yawning at you on boot.
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

  // --- Lid overrides: the yawn and the slow blink -------------------------
  // Both need a CONTINUOUS lid value, which .blink/.shut can't express — they're
  // binary classes. So they take the lids by writing an inline transform (which
  // beats a class rule outright) and hand them back by clearing it.
  // #eyeLeft/#eyeRight's own .06s transition just smooths the handoff at each
  // end. Yawn outranks slow blink: it only happens once, and it's the phase
  // change.
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

  // The drawn sleeping eye (lash arc + three strokes) replaces the ring — but
  // only once the yawn has finished closing them. Swap it in at the START of the
  // yawn and she blinks shut before she has yawned: the lash arc would appear at
  // full size and then be squashed open by the yawn envelope, backwards. So the
  // yawn plays on the OPEN ring squashing down, and the drawn version takes over
  // the moment the override lets go.
  hexCatEl.classList.toggle("shut", asleep && !lidBusy);

  const blink = !asleep && !lidBusy && Math.sin(t / 1400) > 0.985;
  hexCatEl.classList.toggle("blink", blink);

  const lidT = lidBusy ? `scaleY(${lidOverride.toFixed(3)})` : "";
  if (eyeLeftEl.style.transform !== lidT) {
    eyeLeftEl.style.transform = lidT;
    eyeRightEl.style.transform = lidT;
  }

  // Look: toward the golden mouse by day; roving under the lashes at night.
  // Owned entirely by JS (not a CSS class) because it combines a look-direction
  // translate with the dilation scale, and CSS can't compose an inline transform
  // with a class rule's transform.
  //
  // No vertical squash rides along here any more. It used to, because the pupil
  // was a separate shape INSIDE the socket and had to be squashed to follow a
  // closing lid. The ring is the whole eye now and sits inside the lid group, so
  // the lid's scaleY already carries it — applying it twice shut her eyes at the
  // square of the intended amount.
  let lookX = 0, lookY = 0;
  if (asleep && !lidBusy) {
    // REM: the lids stay shut but the eyes rove underneath. Deliberately
    // thematic — she's dreaming the wall you're watching. Two out-of-phase sines
    // so it never reads as a clean loop. Bigger than it was (the old value moved
    // a pupil inside a socket; this moves the whole lash arc across her face) but
    // still under a lash-width per swing.
    lookX = 5 * Math.sin(t / 3100) + 2.5 * Math.sin(t / 1130);
  } else if (!asleep && goldState.active) {
    const cx = stageEl.clientWidth / 2, cy = stageEl.clientHeight / 2;
    const dx = (goldState.x + 31) - cx, dy = (goldState.y + 31) - cy; // golden mouse's own center, stage-relative
    const mag = Math.hypot(dx, dy) || 1;
    lookX = (dx / mag) * IRIS_LOOK;
    lookY = (dy / mag) * IRIS_LOOK;
  } else if (!asleep && IDLE.gazeDrift) {
    // Nothing to look at, so she looks at nothing in particular. Without this
    // she stares dead ahead for the ~40-90s between goldens, which is most of
    // the game. Sines are MULTIPLIED, not added: one sine is a metronome
    // sweeping at constant speed, but the product stalls near either factor's
    // zero-crossing, so she drifts, dwells, drifts — closer to looking at
    // things than scanning for them.
    lookX = IRIS_LOOK * 0.5 * Math.sin(t / 2300) * Math.sin(t / 5700);
    lookY = IRIS_LOOK * 0.3 * Math.sin(t / 3300) * Math.sin(t / 7100);
  }
  // Widened while awake AND excited: either a golden is actually out there, or
  // Zoomies is running (pets worth more) — the buff a caught golden leaves
  // behind, so her eyes stay wide through the sprint rather than snapping shut
  // the instant the mouse is gone. Not during sleep even if a golden is drifting
  // past, matching the branch above where asleep never looks toward it either.
  const eyeScaleX = (!asleep && (goldState.active || zoomBuff() > 1)) ? PUPIL_ROUND : PUPIL_SLIT;
  const irisTransform = `translate(${lookX.toFixed(2)}px, ${lookY.toFixed(2)}px) scale(${eyeScaleX})`;
  irisLeftEl.style.transform = irisTransform;
  irisRightEl.style.transform = irisTransform;

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
  // CHATTER, relocated. The "ekekek" at prey behind glass used to drop her jaw
  // ~11Hz; the drawn head has no separable jaw, so it plays as the quiver that
  // goes with it — the whole head vibrating, same frequency, same trigger.
  // Small on purpose: it rides on top of the purr and must not read as a
  // second, faster purr. Suppressed while a lid is being driven, as the jaw version was.
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
    // EAR SWIVEL, relocated. The ears used to rotate toward a golden; they are
    // painted into the head now, so the head itself turns that way instead —
    // same information (she has clocked it and is orienting), carried by the
    // one part that can still move. Added to the tilt rather than composed as a
    // second transform, since both are a rotation about the same neck pivot.
    const swivel = (IDLE.earSwivel && alert)
      ? Math.max(-1, Math.min(1, ((goldState.x + 31) - stageEl.clientWidth / 2) / (stageEl.clientWidth / 2))) * 4
      : 0;
    // WHISKERS FORWARD, relocated. Six whiskers on one path used to fan at prey;
    // they are painted in now, so the fan becomes the lean that produced it — she
    // pushes very slightly toward the thing she wants. 2% is under conscious
    // notice, which is right: it was a whisker tell, not a pounce.
    const lean = (IDLE.whiskersForward && alert) ? 1.02 : 1;
    const rot = tilt + swivel;
    const faceT = (rot || lean !== 1)
      ? `rotate(${rot.toFixed(2)}deg) scale(${lean})` : "";
    if (catFaceEl.style.transform !== faceT) catFaceEl.style.transform = faceT;
  }

  updateEars(t, asleep, alert);
}

// EARS — the idle tell, back on its own channel now the day coat is split.
//
// A perk, not the old rig's flick: each ear scales up from its BASE, so the
// pixels where it joins the head never move and the drawn outline stays whole.
// Rotating instead nicks that line visibly at Hex's real size, because the ear
// is a slice cut out of one continuous stroke (see the pivot note in
// index.html). "Ears prick up" says what the flick said anyway.
//
// Two behaviours on one channel, and they ADD rather than override: a sustained
// perk while prey is on screen (the old earSwivel — she is orienting, and with
// no rotation available the orienting reads as attention rather than direction),
// plus the quick independent twitches on top. Each ear keeps its own schedule so
// they fire out of sync, the way a real cat's do.
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
  // Rest at night — the wall-reveal pose owns Hex then, and the night coat is
  // one piece with the ears painted in, so there is nothing to drive anyway.
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

// The squash player. `big` picks the sequence; an ordinary tap can never
// downgrade a big one that is already running, which is the bug that stopped the
// artist's animation from ever playing through. A big one always restarts (a
// second annoyed stir should re-hit), and soft-on-soft restarts too, so holding a
// steady petting rhythm keeps her squashed rather than popping in and out.
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
