// Goomba Glider, multiplayer client — boot, the frame loop, and the wiring
// between a snapshot and the UI.
//
// The room server owns the bands, the level, the phase and the score; this file
// renders snapshots and sends intents, the same seam hex-clicker has. A run is
// animated LOCALLY: the server scores it the instant PLAY lands (deterministic
// physics), and every phone steps the same shared sim against the server's
// runAt timestamp — so all four screens watch the same ride, and the ending the
// animation reaches is the one the server already banked.
//
// The rest of the client is split by what it owns:
//   dom.js       every element reference
//   state.js     the snapshot mirror + the local presentation that hangs off it
//   render.js    the drawing surface and everything drawn on it
//   selector.js  the levels grid, which on a laptop is the level editor
//   input.js     three ways to lay a band, one way to take it back
//   sheet.js     the how-to-play pictures, which are also the join gate

import "./styles.css";
import {
  GOOMBA_LEVELS,
  MAX_BANDS,
  BAND_MIN,
  R,
  SUB,
  makeRun,
  stepRun,
  snapBand,
  applyPack,
  encodeLevel,
  levelLabel,
  nextLeadsToSplash,
  PACK_MAX,
} from "@escape-cats/shared";
import { connectRoom, watchTeam, transport, playerId } from "./net";
import { adoptHashLevel, startDebug } from "./debug";
import { levelFromPaste } from "./figma/paste.js";
import {
  cv, hudEl, hintEl, dotsEl, invEl, playBtn, bandbarEl, labEl, connEl,
  gateEl, gateStatusEl, gateErrEl,
} from "./dom";
import {
  S, L, bands, level, now, toast, askConfirm, bandInk, FAIL_MSG,
  SOLO, DESKTOP, PARTY_COLORS, levelSelect, editorOn,
} from "./state";
import {
  ctx, cam, sxp, syp, fitScale, clampCam, advanceClock, tGlobal, checkFit,
  postFrame,
  drawBackground, drawTerrain, drawBand, drawTeammatePreview, drawAnchor,
  drawTeammateAnchor, drawCushion, drawPopper, drawCan, drawBumper,
  drawGoalPlant, drawGoomba, drawStartPad, drawSplash,
} from "./render";
import {
  setLab, resolveLabJump, onPackChanged, openSelector, tickEditMsg, drawLab,
  editSay,
} from "./selector";
import {
  resetInput, liveAnchor, heartbeatAnchor, splashTap,
} from "./input";
import {
  drawSheet, armSheet, closeSheet, sheetFrame, sheetIsOpen, sheetIsArmed,
} from "./sheet";
import "./input";

// Kiosk lockdown, same as hex: no long-press menu, no browser pan under a
// finger. Buttons opt out via the selector.
window.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener(
  "touchstart",
  (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest("button, a")) return;
    e.preventDefault();
  },
  { capture: true, passive: false },
);
// And no zoom. `user-scalable=no` in the viewport meta has not stopped a pinch
// since iOS 10 — Safari ignores it deliberately, so the meta is a statement of
// intent and these three are the enforcement. WebKit-only events, and the only
// ones that fire for a MAC trackpad pinch as well as an iOS one.
//
// The touchstart above already suppresses a pinch nearly everywhere, so this
// closes one specific hole: the `button, a` exemption up there is load-bearing
// (preventDefault on touchstart kills the synthesised click), which means a
// pinch that happens to START on PLAY or the Figma link is not covered. Gesture
// events synthesise no click, so they need no such exemption and get none.
//
// Two fingers are the game's own (`input.js` — a stretch lays a band), so
// nothing here is taking a gesture away from a player; it is stopping the
// BROWSER from reading the same two fingers as a zoom. What it cannot reach:
// iOS "Always Allow Zoom", the system three-finger Accessibility Zoom, and
// Safari's own AA-menu / Cmd+- page zoom. Those are browser chrome, and a page
// that pretends otherwise is making a promise it cannot keep.
for (const ev of ["gesturestart", "gesturechange", "gestureend"]) {
  window.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

// Run zoom only: the edit view sits at fitScale so the WHOLE level is on screen.
// Nothing pans any more, so every point a band can reach has to be reachable by
// a finger without moving the camera.
const RZ = 1.9;

let shownPhase = "edit", shownLevel = -1, shownRunId = 0;
let anim = null;            // { key, st } — the local replay of the scored run
let winFx = false;          // confetti fired for the current win
// The locked-goal flare: when she reaches the plant with cans still out, the
// state the plant is ALREADY wearing gets accented for four tenths of a second.
// Local presentation only — passing over the goal on the way to somewhere else
// is legitimate level design, so this may never block, bounce or delay her.
let lockT = -9, lockArmed = false;
let shake = 0;
let parts = [], confetti = [], cushAnim = [], popPrev = null;


function refit() {
  const b = L().bounds;
  Object.assign(cam, clampCam((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, fitScale(L()), b));
}

/**
 * The event's levels arrived (on connect, and again after any edit).
 *
 * `applyPack` writes into the same `GOOMBA_LEVELS` array every rule already
 * reads, so nothing downstream has to know the levels can change. What DOES
 * have to know is this file's one cache: the camera, which is framed on a level
 * whose geometry may have just been replaced under it.
 */
function onPack(pack) {
  applyPack(pack);
  onPackChanged();
  anim = null; // a replay of geometry that may no longer exist
  if (S.snap) { refit(); syncHud(); }
}

function onSnapshot(s) {
  S.serverOffset = s.serverTime - Date.now();
  const first = !S.inited;
  const levelChanged = s.level !== shownLevel;
  const wasReset = s.runId !== shownRunId;
  // Crossing into or out of the splash is fresh footing as much as a level
  // change is: leaving it via a `goto` can land on the SAME level it was
  // covering (the finale), which no other signal here would notice — and that
  // would leave the finale's confetti and its finished run replay on screen.
  const splashEdge = (s.phase === "splash") !== (shownPhase === "splash");
  S.snap = s;
  S.pending = null; // whatever we sent, the authority has now spoken

  // The latched card tap resolves here — on the goto's exact signature (that
  // level, fresh edit phase, no bands), so a snapshot merely in flight when we
  // tapped doesn't drop the grid early. Closing now, in the same handler that
  // recenters the camera below, means the first frame without the lab is
  // already the new level, framed: no gap for the old one to show through.
  resolveLabJump(s);

  if (first) {
    S.inited = true;
    // The room is live, so the sheet stops waiting and starts asking: it is
    // now dismissible, and the player is the one who dismisses it. Unless the
    // GRID is already open — `?solo` and a pasted level both land there — in
    // which case the sheet has nowhere to sit: `#hud.lab > *` hides it, so
    // arming it would only leave an invisible sheet swallowing the next key.
    if (S.labOpen) closeSheet(false);
    else armSheet();
    requestAnimationFrame(frame);
  }
  if (s.phase !== "edit") resetInput(); // a run kills any half-drawn band

  if (first || wasReset || levelChanged || splashEdge) {
    // Fresh footing: recenter the camera, drop run debris.
    const b = L().bounds;
    Object.assign(cam, clampCam((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, fitScale(L()), b));
    resetInput();
    anim = null; winFx = false; parts = []; confetti = [];
    lockT = -9; lockArmed = false;
    cushAnim = L().cushions.map(() => 0); popPrev = null;
    shownRunId = s.runId; shownLevel = s.level; shownPhase = s.phase;
    if (wasReset && !first) toast("fresh start! 🧽", 1400);
    else if (levelChanged && !first) toast(levelLabel(s.level, L().name), 1400);
    syncHud();
    return;
  }

  // Phase edges. run→edit is a scored FAIL (wins go run→win) — but only when
  // `runResult` survived the edge. STOP takes the same edge and clears it,
  // because an abort is nobody's failure and has nothing to shake or say.
  if (shownPhase === "run" && s.phase === "edit" && s.runResult) {
    shake = 1;
    toast(FAIL_MSG[s.runResult] || "try again!");
    anim = null;
  }
  if (s.phase !== "run" && s.phase !== "win") anim = anim && null;
  shownPhase = s.phase;
  syncHud();
}

function syncHud() {
  const s = S.snap; if (!s) return;
  const done = s.completed.filter(Boolean).length;
  // The level's own name is deliberately off the HUD now — only the win
  // banner ever occupies this line; editing and running say nothing.
  hintEl.textContent =
    s.phase === "win"
      ? (done === s.levelCount ? "ALL LEVELS CLEAR! 🎉🪴" : "LEVEL CLEAR! 🎉")
      : "";

  // Both of these are room state, so they are re-read every snapshot: the
  // selector arrives when the team clears the game and leaves on a reset, and
  // the splash is a phase like any other.
  hudEl.classList.toggle("cleared", levelSelect());
  hudEl.classList.toggle("splash", s.phase === "splash");
  // The band plate's CHROME rides the phase, never the band count: keyed on the
  // count it would grow and collapse every time the count crossed 0 (see the
  // `#bandbar` comment in styles.css). At zero bands the plate stays exactly
  // where it is and only goes quiet — `disabled`, below.
  hudEl.classList.toggle("laying", s.phase === "edit");
  // `editing` is JS-only state (set by the `\` key, the paste handler, and an
  // empty pack via editorOn) with no snapshot behind it, so it needs its own
  // sync point rather than riding this function's `s`-driven toggles above —
  // this is just the one place already re-run on every UI-relevant change.
  hudEl.classList.toggle("editing", editorOn());

  dotsEl.innerHTML = "";
  s.completed.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "dot" + (i === s.level ? " cur" : c ? " done" : "");
    dotsEl.appendChild(d);
  });

  // The 4 band slots — the room's whole budget, in the team's colour. Every
  // one of them is the same colour now, because every one of them is anybody's
  // to lay: the row says "two of the four are out", which is the only thing
  // left to say about them. An empty slot during edit is lit rather than faded,
  // since an empty slot is one I may fill — there is no share of them to be
  // outside of any more.
  const ink = bandInk();
  invEl.innerHTML = "";
  for (let i = 0; i < MAX_BANDS; i++) {
    const el = document.createElement("div");
    const bd = s.bands[i];
    const open = !bd && s.phase === "edit";
    el.className = "band" + (bd ? " used" : open ? " open" : "");
    // Inline, because only the client knows which team it is on. A slot that is
    // neither filled nor fillable (mid-run) keeps the faded dashes from CSS.
    if (bd || open) el.style.borderColor = ink;
    if (bd) el.style.background = ink + "33";
    invEl.appendChild(el);
  }

  // On the finale of a cleared room NEXT is the curtain call, not another
  // level — nextLeadsToSplash is the sim's own predicate for that transition,
  // so the label cannot disagree with where the button actually goes.
  playBtn.textContent =
    s.phase === "run" ? "■ STOP" :
    s.phase === "win" ? (nextLeadsToSplash(s) ? "FINISH ▸" : "NEXT ▸") : "▶ PLAY";
  playBtn.className = s.phase === "run" ? "stop" : s.phase === "win" ? "next" : "";
  // The one thing that changes with the band count. `disabled` rather than a
  // class: it blocks the pointer, greys the words through `:disabled`, and is
  // the only one of the three a screen reader can hear.
  bandbarEl.disabled = !(s.phase === "edit" && s.bands.length);
}

playBtn.onclick = () => {
  if (!S.snap) return;
  if (S.snap.phase === "edit") transport.send({ type: "play" });
  else if (S.snap.phase === "run") transport.send({ type: "stop" });
  else if (S.snap.phase === "win") transport.send({ type: "next" });
};
// One tap wipes, no confirm — and it wipes the ROOM's bands, teammates'
// included (`clear` in goomba/sim.ts), from the corner of the screen a thumb
// has to stretch for. That is a deliberate trade: the four players are in one
// living room, so a clear nobody wanted is answered out loud in a second and
// the bands go back down, whereas a confirm step would tax every deliberate
// tap to insure against the rare stray one. No toast either: four bands
// vanishing off the board IS the feedback, and the only phone a local toast
// could reach is the one that already knows.
//
// The whole plate is the target, slots included — tapping the four bands is
// what takes the four bands away. It only accepts a tap during edit with at
// least one band down (`disabled` in syncHud); every other moment this corner
// belongs to the canvas underneath, where a band may legally be anchored.
bandbarEl.onclick = () => { resetInput(); transport.send({ type: "clear" }); };
labEl.onclick = openSelector;
// THE KEYBOARD, AND HOW LITTLE OF IT IS OURS.
//
// This listener exists for the laptop that EDITS: `\` is the whole level
// selector on one key, and Escape is the way back out of it. Space is a
// convenience on the same machine. That is the entire list, and everything else
// on a keyboard belongs to the browser.
//
// It used to end with a catch-all — any key at all dismissed the help sheet —
// and a catch-all on a keyboard is a promise you cannot keep. It skipped the
// modifier keys THEMSELVES but not modifier COMBOS, so Cmd+R arrived as `r`
// with metaKey set and preventDefault ate the reload; Ctrl+V went the same way,
// which stopped the `paste` listener below from ever seeing a paste, on a
// screen that closes itself precisely so a paste can land. Enumerating what to
// skip does not fix that shape — F5, Tab and whatever a phone keyboard sends
// next are all the same bug waiting — so the rule is inverted: a modifier combo
// is never ours, and the sheet answers to the three keys that mean "go" rather
// than to all of them.
const chord = (e) => e.metaKey || e.ctrlKey || e.altKey;
const GO_KEYS = [" ", "Enter", "Escape"];

window.addEventListener("keydown", (e) => {
  if (chord(e)) return;
  // The help sheet owns those three while it is up: Space behind it would
  // launch a run nobody on this screen can see.
  if (sheetIsArmed()) {
    if (!GO_KEYS.includes(e.key)) return;
    e.preventDefault(); closeSheet(); return;
  }
  if (e.key === " ") { e.preventDefault(); playBtn.onclick(); }
  // `\` — the whole editor, on one key. Swapping between the game and the
  // level pack has to be instant or nobody uses it mid-party: this is the same
  // screen either way, so there is nothing to load and nothing to leave.
  if (e.key === "\\") {
    e.preventDefault();
    if (S.labOpen && S.editing) { S.editing = false; setLab(false); syncHud(); return; }
    S.editing = true;
    if (S.snap && S.snap.phase === "run") transport.send({ type: "stop" });
    setLab(true);
    syncHud();
  }
  if (e.key === "Escape" && S.labOpen && S.editing) {
    S.editing = false; setLab(false); syncHud();
  }
});


/**
 * Everything a paste has to say. `editSay` is the line under the grid's title,
 * which is no use to a paste that landed while the grid was SHUT — so when it
 * is, the game's own toast carries the same words. Without it a paste over the
 * level you are playing is silent unless the geometry happens to move somewhere
 * you were looking, and "did that work?" is the one thing this loop must never
 * make you guess.
 */
function pasteSay(msg) {
  editSay(msg);
  if (!S.labOpen) toast(msg, 2600);
}

// ---------- pasting a level in ----------
// Ctrl+V anywhere on the page. Where it LANDS is the one question, and the
// answer is simply which screen you were looking at:
//
//   · the GRID is up — the selection. A card replaces that level, the trailing
//     dashed slot appends. That is the whole reason the laptop grid grew a
//     selection: "which level does this overwrite" is a question about a place
//     on the screen, and now the answer is the place that is lit.
//   · you are PLAYING — the level in front of you. Pasting over the level you
//     are looking at is the editor's tightest loop (tweak the frame in Figma,
//     Ctrl+C, Ctrl+V, watch the same level redraw under you), and it used to
//     cost a bounce out to the grid and back for no reason: the paste already
//     said which level it meant.
//
// The only paste that still opens the grid is the one with nowhere to land: an
// EMPTY pack has no level in front of you and no card to select, so the first
// one in is an append, and the grid is where you watch it arrive.
window.addEventListener("paste", (e) => {
  // Laptop only, like every other editing gesture. A phone reaching here would
  // have had to grow a Ctrl+V first, and if one ever does, it gets the grid the
  // rest of this file gives it — not a hidden second way to rewrite the pack.
  if (!DESKTOP()) return;
  e.preventDefault();
  // No zoop: this is a laptop editing gesture, and the grid it is usually
  // about to open hides `#help` with the rest of the HUD.
  if (sheetIsArmed()) closeSheet(false);   // the grid must not open behind the sheet
  // Read the screen NOW, not when the clipboard resolves: this is about what
  // the person was looking at when they pressed the key.
  const onGrid = S.labOpen;
  const toGrid = !onGrid && GOOMBA_LEVELS.length === 0;
  if (onGrid || toGrid) {
    // Always `editing`, not just when the grid was shut: pasting IS editing,
    // and the first paste into an EMPTY pack used to hand the controls back
    // the moment it succeeded — editorOn() had been true only because there
    // were no levels, so landing one turned the buttons off under the person
    // using them.
    S.editing = true;
    if (!S.labOpen) { S.selected = null; setLab(true); }
    syncHud();
  }
  pasteSay("reading the clipboard…");
  levelFromPaste(e.clipboardData).then(
    ({ level: lv, warnings }) => {
      // `selected` on the grid (null = the dashed slot, so append); playing,
      // the level on screen — which is never an append, and never null, since
      // an empty pack took the grid branch above.
      const target = onGrid || toGrid ? S.selected : level();
      if (target === null && GOOMBA_LEVELS.length >= PACK_MAX) {
        return pasteSay(`the pack is full at ${PACK_MAX} levels`);
      }
      const land = () => {
        // Re-read the pack on the way in: a confirm is answered by a person,
        // and a teammate's edit can land on this socket while they think.
        if (target !== null && target >= GOOMBA_LEVELS.length)
          return pasteSay("that slot is gone — select another card and paste again");
        // The pack is a list of level LINKS, so a paste becomes one here and
        // the authority stores exactly what it validated.
        transport.send({ type: "packSet", index: target, hash: encodeLevel(lv) });
        const where = target === null ? "as a new level" : `over level ${target + 1}`;
        pasteSay(warnings.length
          ? `${lv.name} ${where} · ${warnings.join(" · ")}`
          : `${lv.name} — in, ${where}`);
      };
      const over = target === null ? null : GOOMBA_LEVELS[target];
      // A paste whose NAME matches the card it lands on is a redraw: the Figma
      // frame it came from is the frame that card was made from, and stopping
      // to ask would tax the loop the editor exists for (tweak in Figma, copy,
      // paste, re-read the verdict) on every single lap. A DIFFERENT name is a
      // different level, and "I meant to add this, not to overwrite level 3"
      // is worth one click to catch — nothing on this grid is undoable. That
      // holds just as much when the paste landed on the level you are playing:
      // same rule, same question, no grid required to ask it.
      if (over && over.name !== lv.name)
        askConfirm(
          `Replace level ${target + 1}?`,
          `“${over.name}” → “${lv.name}”`,
          land,
        );
      else land();
    },
    (err) => pasteSay(String(err.message || err)),
  );
});


// ---------- the run replay ----------
// The flare's shape: snap up, fall away. It is clocked off the RUN's own
// seconds rather than off wall-clock dt, which is what makes it survive the
// fast-forward — a phone that joins late walks the missed substeps in one
// frame, and reading `st.t - lockT` lands it at the right point of the
// envelope instead of starting a fresh 0.4s that nobody else is seeing.
const LOCK_ATTACK = 0.06, LOCK_RELEASE = 0.34;
const lockFlare = (dt) =>
  dt < 0 ? 0
    : dt < LOCK_ATTACK ? dt / LOCK_ATTACK
    : Math.max(0, 1 - (dt - LOCK_ATTACK) / LOCK_RELEASE);
/** Keep the local animation in step with the room's shared clock. Returns the
 * RunState to draw, or null when nobody is riding. */
function syncAnim() {
  const s = S.snap;
  if (!s || s.runAt === null || (s.phase !== "run" && s.phase !== "win")) return null;
  const key = `${s.runId}:${s.level}:${s.runAt}`;
  if (!anim || anim.key !== key) {
    anim = { key, st: makeRun(L(), s.bands) };
    popPrev = anim.st.popT.slice();
    lockT = -9; lockArmed = false;
  }
  // Step to the shared timeline. A phone that joins late fast-forwards through
  // the missed part in one frame — same substeps, same ending.
  const target = Math.min((now() - s.runAt) / 1000, s.runT ?? 0);
  const st = anim.st;
  while (!st.result && st.t < target) stepRun(st, SUB);
  // The scored win, celebrated exactly when the replay reaches it.
  if (s.phase === "win" && st.result === "win" && !winFx) {
    winFx = true;
    const lv = L();
    for (let i = 0; i < 90; i++) confetti.push({
      x: lv.goal[0], y: lv.goal[1] - 4,
      vx: (Math.random() - 0.5) * 70, vy: -Math.random() * 70 - 15,
      c: PARTY_COLORS[i % 4], r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 10,
      life: 2.2 + Math.random(),
    });
    toast(s.completed.filter(Boolean).length === s.levelCount ? "ALL LEVELS CLEAR! 🎉🪴" : "LEVEL CLEAR! 🎉", 1800);
  }
  return st;
}


// ---------- main loop ----------
const bandExcite = new Map(); // band index -> 0..1 wobble

let lastFitCheck = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);
  frameBody(nowMs);
  // AFTER the body, unconditionally — frameBody's early returns must not skip
  // it. The probe's rack used to be its own rAF loop, and both interleavings of
  // two self-re-arming rAF loops are self-perpetuating: whichever ran first at
  // boot ran first forever. On the phone the race landed rack-then-game, so the
  // game erased the rack every frame while its paint counter climbed past 800.
  // A hook called from the one real loop cannot lose that race.
  if (postFrame) postFrame();
}
function frameBody(nowMs) {
  const dt = Math.min(0.05, (nowMs - (frame.last || nowMs)) / 1000); frame.last = nowMs;
  advanceClock(dt);
  if (tGlobal - lastFitCheck > 1) { lastFitCheck = tGlobal; checkFit(); }
  tickEditMsg(dt);
  if (sheetIsOpen()) drawSheet();   // `?` mid-party: the pictures keep moving
  if (!S.snap) return;
  if (S.labOpen) { drawLab(); return; }
  if (S.snap.phase === "splash") { drawSplash(); return; }
  const lv = L();
  const st = syncAnim();
  const riding = st && S.snap.phase === "run";

  // Ride effects, driven off the local replay exactly as the prototype drove
  // them off its local run.
  if (st) {
    if (riding && st.onBand >= 0 && Math.random() < 0.5) {
      const bd = bands()[st.onBand];
      parts.push({ x: st.p.x, y: st.p.y + R, vx: -st.v.x * 0.15, vy: -12,
                   c: bandInk(), life: 0.5 });
    }
    st.cushHits.forEach((h, i) => { if (h) { cushAnim[i] = 1; st.cushHits[i] = 0; } });
    st.popT.forEach((t, i) => {
      if (popPrev && t !== popPrev[i]) {
        const pp = lv.pops[i];
        for (let k = 0; k < 22; k++) confetti.push({
          x: pp.x, y: pp.y,
          vx: pp.vx * 0.25 + (Math.random() - 0.5) * 40, vy: pp.vy * 0.25 - Math.random() * 20,
          c: PARTY_COLORS[k % 4], r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 12,
          life: 0.8 + Math.random() * 0.5,
        });
      }
    });
    popPrev = st.popT.slice();
    st.bandHits.forEach((h, i) => { if (h) bandExcite.set(i, 1); });
    // She reached the plant with cans still out. The 81 is the sim's own win
    // circle (r=9, `stepRun`'s last test in physics.ts) read back rather than
    // re-guessed: the flare has to fire on exactly the pass that WOULD have
    // won, or it is telling the player about a line that was never there.
    // Armed on the way in and re-armed on the way out, so a level that threads
    // her over the goal three times reads as three taps, not one stuck alarm.
    const gdx = st.p.x - lv.goal[0], gdy = st.p.y - lv.goal[1];
    const inGoal = gdx * gdx + gdy * gdy < 81 && st.gotN < lv.cans.length;
    if (inGoal && !lockArmed) lockT = st.t;
    lockArmed = inGoal;
  }
  for (const [i, v] of bandExcite) bandExcite.set(i, Math.max(0, v - dt * 1.6));
  cushAnim = cushAnim.map((v) => Math.max(0, v - dt * 2.2));

  // camera: the whole level while editing (nothing pans), chase cam on a run
  const fs = fitScale(lv), b = lv.bounds;
  const target = riding && st
    ? clampCam(st.p.x + st.face * 8, st.p.y, fs * RZ, b)
    : clampCam((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, fs, b);
  const k = Math.min(1, 5 * dt);
  cam.x += (target.x - cam.x) * k; cam.y += (target.y - cam.y) * k; cam.s += (target.s - cam.s) * k;

  drawBackground(dt);
  ctx.save();
  if (shake > 0) { shake = Math.max(0, shake - dt * 3); ctx.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 10 * shake); }

  drawTerrain(lv);
  lv.cushions.forEach((c, i) => drawCushion(c, cushAnim[i] || 0));
  lv.pops.forEach((pp, i) => drawPopper(pp, i));
  lv.bumpers.forEach((bp, i) => drawBumper(bp, st ? Math.max(0, 1 - (st.t - st.bumpT[i]) * 4) : 0));
  // The flare, and the rings it throws off the cans she still needs. They
  // stagger in the order they are stored, which is the order a designer laid
  // them out, so a handful of cans arrives as a list rather than a flashbulb —
  // capped, because a twelve-can level should not still be pinging a second
  // later.
  const lockFx = st ? lockFlare(st.t - lockT) : 0;
  let nth = 0;
  lv.cans.forEach((m, i) => {
    const taken = st ? st.got[i] : false;
    // ...and each ring is read off its OWN envelope, not gated on the plant's:
    // a staggered one is still fading when the plant has finished, and cutting
    // it there is a ring that vanishes mid-fade.
    const ping = !taken && st ? lockFlare(st.t - lockT - Math.min(nth, 5) * 0.06) : 0;
    if (!taken) nth++;
    drawCan(m[0], m[1], taken, i, ping);
  });
  drawGoalPlant(lv, st, lockFx);
  bands().forEach((bd, i) => drawBand(bd, bandExcite.get(i) || 0, false));
  if (S.snap.phase === "edit") {
    // Teammates' bands-in-progress: unmistakably in motion (marching dashes,
    // pulsing alpha) so nobody confuses a drag with a placed band.
    const pid = playerId();
    for (const p of S.snap.previews ?? []) {
      if (p.pid === pid) continue;
      if (now() - p.at > 2500) continue; // stale ghost from a dead drag
      if (Math.hypot(p.bx - p.ax, p.by - p.ay) < BAND_MIN) drawTeammateAnchor(p);
      else drawTeammatePreview(p);
    }
  }
  if (S.pending && S.snap.phase === "edit") drawBand(snapBand(lv, S.pending), 0, true);
  if (S.preview && S.snap.phase === "edit") drawBand(S.preview, 0, true);
  if (S.snap.phase === "edit") {
    const a = liveAnchor();
    if (a && !S.preview) {
      drawAnchor(a);
      heartbeatAnchor(a); // keep it alive on every teammate's phone
    }
  }
  if (S.snap.phase !== "run") drawStartPad(lv);

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.fillStyle = p.c; ctx.globalAlpha = Math.min(1, p.life * 2.5);
    ctx.beginPath(); ctx.arc(sxp(p.x), syp(p.y), 0.4 * cam.s, 0, 6.28); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (let i = confetti.length - 1; i >= 0; i--) {
    const p = confetti[i]; p.life -= dt;
    if (p.life <= 0) { confetti.splice(i, 1); continue; }
    p.vy += 60 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
    ctx.save(); ctx.translate(sxp(p.x), syp(p.y)); ctx.rotate(p.r);
    ctx.fillStyle = p.c; ctx.globalAlpha = Math.min(1, p.life);
    ctx.fillRect(-0.6 * cam.s, -0.3 * cam.s, 1.2 * cam.s, 0.6 * cam.s);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  if (st) drawGoomba(st.p.x, st.p.y, st.boardA * st.face, st.face, st.grounded, !st.grounded, false);
  else drawGoomba(lv.start[0], lv.start[1], lv.startAngle, 1, true, false, true);

  ctx.restore();
}


// ---------- boot — no menu, same contract as hex ----------
const NAME_KEY = "escape-cats-name";
// THE CONNECTION LINES, AND WHY ALMOST NOBODY SEES THEM.
//
// They are held invisible until this phone has been disconnected for STALL_MS
// WITHOUT A BREAK, and they go back the instant it reconnects. Time since boot
// would have been the wrong clock: a phone the proctor has not sorted yet has
// no room to join and waits here indefinitely — connected, healthy, and by far
// the commonest thing on this screen at the start of a party — so a plain timer
// would put "Loading…" under the pictures for everyone. Being unable to REACH
// anything is the only state worth a word.
//
// 1.5s because under a second is not a wait anyone perceives (a line there is
// noise about something that already worked), because two of the three gaps
// this covers — the first socket, and the one between being sorted and the room
// answering — are normally a couple of hundred milliseconds, and because a
// player who has been stuck this long is still wondering rather than long past
// caring. It is a floor on complaining, not a timeout: nothing is given up on
// at 1.5s, the words merely stop being withheld.
const STALL_MS = 1500;
let stallTimer = null;
/** Connected or not; the lines follow, after the delay when the answer is no. */
function netQuiet(up) {
  clearTimeout(stallTimer); stallTimer = null;
  if (up) gateEl.classList.add("quiet");
  else stallTimer = setTimeout(() => gateEl.classList.remove("quiet"), STALL_MS);
}


function boot() {
  requestAnimationFrame(sheetFrame);   // the gate is up: animate it until frame() exists
  // ?debug adds no chrome of its own any more — the roster line it used to
  // hide is gone from every phone. The SELECTOR rides `.cleared`, which syncHud
  // toggles off the room's snapshot, and ?debug simply forces that predicate
  // true (see levelSelect).
  if (SOLO) {
    // Serverless: the shared sim in-page. A level pasted in via the hash opens
    // ON that level; otherwise we land on the grid as before.
    const pasted = adoptHashLevel();
    setLab(pasted === null);
    startDebug({ onSnapshot, level: pasted ?? undefined });
    return;
  }
  // Everything else joins the real room like any player, ?debug or not — the
  // selector's card taps send a room-wide `goto`, so the whole team jumps
  // together, and a ?debug phone differs only in getting at the selector
  // before the team has earned it.
  const name = localStorage.getItem(NAME_KEY) ?? "Cat";
  gateStatusEl.textContent = "Loading…";
  netQuiet(false);   // nothing is connected yet: the clock starts here
  let sorted = false;   // a team is known, so the ROOM socket is the live wire
  watchTeam({
    name,
    onTeam: (team, lobbyName) => {
      localStorage.setItem(NAME_KEY, lobbyName);
      // The lobby socket is deliberately closed the moment a real team lands,
      // and that close is a `false` on onStatus below. From here the room
      // socket is the only connection this phone has an opinion about.
      sorted = true;
      netQuiet(false);   // ...and it is not open yet, so the clock restarts
      // A team id doubles as its room id, so this is also the colour every band
      // on this phone is about to be drawn in (bandInk). Set before the first
      // snapshot can arrive, so nothing is ever painted in the fallback pink
      // and then swapped.
      S.myTeam = team;
      gateStatusEl.textContent = "Joining your team…";
      connectRoom({
        room: team,
        name: lobbyName,
        onSnapshot,
        onPack,
        onConnection: (up) => {
          connEl.classList.toggle("on", !up && S.inited);
          if (!S.inited) {
            gateErrEl.textContent = up ? "" : "Can't reach the room — hang tight, retrying…";
            netQuiet(up);
          }
        },
      });
    },
    onStatus: (up) => {
      // Silent once sorted, TEXT included: the lobby socket is closed on
      // purpose at that point, and letting its "check wifi?" land would leave
      // the wrong sentence sitting there for a slow room join to reveal.
      if (sorted) return;
      gateErrEl.textContent = up ? "" : "Can't reach the server — check wifi?";
      netQuiet(up);
    },
  });
}

boot();

// Console/test handle, like window.__hex — the server validates everything.
window.__goomba = {
  state: () => S.snap,
  send: (msg) => transport.send(msg),
  preview: (bd) => transport.preview(bd),
  LEVELS: GOOMBA_LEVELS,
};
