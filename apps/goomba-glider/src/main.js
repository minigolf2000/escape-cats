// Goomba Glider, multiplayer client — boot, the frame loop, and the wiring
// between a snapshot and the UI. The room server owns bands, level, phase and
// score; this file renders snapshots and sends intents. A run is animated
// LOCALLY against the server's runAt timestamp with the same shared sim, so
// every phone watches the same ride and reaches the ending the server banked.
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
  PACK_MAX,
  isTeamRoom,
} from "@escape-cats/shared";
import { connectRoom, watchTeam, transport, playerId } from "./net";
import { adoptHashLevel, startDebug } from "./debug";
import { levelFromPaste } from "./figma/paste.js";
import {
  cv, hudEl, hintEl, teamEl, dotsEl, invEl, playBtn, bandbarEl, labEl, connEl,
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
  drawGoalPlant, drawGoomba, drawStartPad, drawSplash, preloadSplashArt,
} from "./render";
import {
  setLab, resolveLabJump, onPackChanged, openSelector, tickEditMsg, drawLab,
  editSay,
} from "./selector";
import {
  resetInput, liveAnchor, heartbeatAnchor,
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
// And no zoom: `user-scalable=no` has not stopped a pinch since iOS 10, so
// these WebKit-only gesture events are the enforcement, closing the hole the
// `button, a` exemption above leaves (a pinch that STARTS on PLAY). Two
// fingers are the game's own (a stretch lays a band); this stops the BROWSER
// reading them as zoom. It cannot reach iOS "Always Allow Zoom", Accessibility
// Zoom or Safari's page zoom.
for (const ev of ["gesturestart", "gesturechange", "gestureend"]) {
  window.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

// Run zoom only: the edit view sits at fitScale so the WHOLE level is on
// screen — nothing pans, so every band point must be reachable by a finger.
const RZ = 1.9;

let shownPhase = "edit", shownLevel = -1, shownRunId = 0;
// tGlobal when the room landed on the finale — the splash animates off ITS
// own clock, so a phone that joins a room already there sees the whole arrival
// rather than the middle of it. -1 until the splash is up.
let splashAt = -1;
// The roster last written to #team, so it is rebuilt only when it changes.
let shownRoster = "";
let anim = null;            // { key, st } — the local replay of the scored run
let winFx = false;          // confetti fired for the current win
// The locked-goal flare: reaching the plant with cans still out accents the
// state the plant already wears, for 0.4s. Local presentation only — passing
// over the goal is legitimate level design, so it may never block or delay her.
let lockT = -9, lockArmed = false;
let shake = 0;
let parts = [], confetti = [], cushAnim = [], popPrev = null;


function refit() {
  const b = L().bounds;
  Object.assign(cam, clampCam((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, fitScale(L()), b));
}

/**
 * The event's levels arrived (on connect, and after any edit). `applyPack`
 * writes into the array every rule reads; the camera is this file's one cache
 * of a level that may just have been replaced under it.
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
  // Crossing into or out of the splash is fresh footing: a `goto` out of it
  // can land on the SAME level (the finale), which no other signal notices.
  const splashEdge = (s.phase === "splash") !== (shownPhase === "splash");
  S.snap = s;
  S.pending = null; // whatever we sent, the authority has now spoken

  // The latched card tap resolves here, in the same handler that recenters
  // the camera below, so the first frame without the lab is the new level.
  resolveLabJump(s);

  if (first) {
    S.inited = true;
    // The room is live: arm the sheet (the player dismisses it). Unless the
    // GRID is already open (`?solo`, a pasted level): `#hud.lab > *` hides
    // the sheet, and an armed invisible sheet would swallow the next key.
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
    // The finale arrives here and only here: `resolve` lands the clearing win
    // straight on the splash, which is a phase edge this branch already owns.
    if (s.phase === "splash") splashAt = tGlobal;
    if (wasReset && !first) toast("fresh start! 🧽", 1400);
    else if (levelChanged && !first) toast(levelLabel(s.level, L().name), 1400);
    syncHud();
    return;
  }

  // Phase edges. run→edit is a scored FAIL (wins go run→win) — only when
  // `runResult` survived the edge; STOP takes the same edge and clears it.
  if (shownPhase === "run" && s.phase === "edit" && s.runResult) {
    shake = 1;
    toast(FAIL_MSG[s.runResult] || "try again!");
    anim = null;
  }
  if (s.phase !== "run" && s.phase !== "win") anim = null;
  shownPhase = s.phase;
  syncHud();
}

function syncHud() {
  const s = S.snap; if (!s) return;
  // Only the win banner ever occupies this line. There is no "all levels
  // clear" banner: that win is on the splash before it could be read.
  hintEl.textContent = s.phase === "win" ? "LEVEL CLEAR! 🎉" : "";

  // Room state, re-read every snapshot (a reset takes the selector back).
  hudEl.classList.toggle("cleared", levelSelect());
  hudEl.classList.toggle("splash", s.phase === "splash");
  // The band plate's CHROME rides the PHASE, never the band count — keyed on
  // the count it would grow and collapse every time it crossed 0 (`#bandbar`
  // in styles.css). At zero bands it only goes quiet: `disabled`, below.
  hudEl.classList.toggle("laying", s.phase === "edit");
  // `editing` is the SURFACE (editorOn), not room state; synced here because
  // the surface can change under a live room (a tablet gaining a trackpad).
  hudEl.classList.toggle("editing", editorOn());

  dotsEl.innerHTML = "";
  s.completed.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "dot" + (i === s.level ? " cur" : c ? " done" : "");
    dotsEl.appendChild(d);
  });

  // WHO IS HERE — one name per line (#team in styles.css), rebuilt only when
  // it CHANGES, and only in one of the four TEAMS: elsewhere the room is
  // whoever turned up, still on the default name, so the column is one word
  // repeated (isTeamRoom). Empty there, not hidden — #team has no box.
  const named = isTeamRoom(S.myTeam) ? s.players : [];
  const roster = named.map((p) => `${p.connected ? 1 : 0}\u0000${p.name}`).join("\u0001");
  if (roster !== shownRoster) {
    shownRoster = roster;
    // textContent, never an HTML string: a name is typed by a player.
    teamEl.replaceChildren(
      ...named.map((p) => {
        const el = document.createElement("span");
        if (!p.connected) el.className = "off";
        el.textContent = p.name;
        return el;
      }),
    );
  }

  // The 4 band slots — the room's whole budget, all in the team's colour. An
  // empty slot during edit is lit: it is one I may fill.
  const ink = bandInk();
  invEl.innerHTML = "";
  for (let i = 0; i < MAX_BANDS; i++) {
    const el = document.createElement("div");
    const bd = s.bands[i];
    const open = !bd && s.phase === "edit";
    el.className = "band" + (bd ? " used" : open ? " open" : "");
    // Inline: only the client knows its team. Mid-run slots keep the CSS dashes.
    if (bd || open) el.style.borderColor = ink;
    if (bd) el.style.background = ink + "33";
    invEl.appendChild(el);
  }

  // NEXT is never the finale's button: the win that clears the room never
  // stops on `win` for one to be drawn (`GoombaSim.resolve`).
  playBtn.textContent =
    s.phase === "run" ? "■ STOP" : s.phase === "win" ? "NEXT ▸" : "▶ PLAY";
  playBtn.className = s.phase === "run" ? "stop" : s.phase === "win" ? "next" : "";
  // The one thing that changes with the band count. The real `disabled`:
  // pointer, `:disabled` ink and the a11y tree in one.
  bandbarEl.disabled = !(s.phase === "edit" && s.bands.length);
}

playBtn.onclick = () => {
  if (!S.snap) return;
  if (S.snap.phase === "edit") transport.send({ type: "play" });
  else if (S.snap.phase === "run") transport.send({ type: "stop" });
  else if (S.snap.phase === "win") transport.send({ type: "next" });
};
// One tap wipes the ROOM's bands, teammates' included, with no confirm and no
// toast: four people in one living room answer a stray out loud. If strays turn
// up, the answer is UNDO, never a confirm step. The whole plate is the target;
// `disabled` (syncHud) limits it to edit-with-bands, and every other moment the
// corner belongs to the canvas underneath.
bandbarEl.onclick = () => { resetInput(); transport.send({ type: "clear" }); };
labEl.onclick = openSelector;
// THE KEYBOARD, AND HOW LITTLE OF IT IS OURS: `\` opens the selector, Escape
// leaves it, Space plays, the sheet answers to GO_KEYS. Everything else belongs
// to the browser — a modifier combo is NEVER ours (a catch-all once ate Cmd+R
// and Ctrl+V, the paste this screen closes itself for). Never add a catch-all.
const chord = (e) => e.metaKey || e.ctrlKey || e.altKey;
const GO_KEYS = [" ", "Enter", "Escape"];

window.addEventListener("keydown", (e) => {
  if (chord(e)) return;
  // THE FINALE TAKES NO INPUT — not a tap (input.js), not `\`, not a paste
  // (below). It is where the game ends; the ways off it are the room's, from
  // the proctor. A laptop is no exception: the door it would open leads to a
  // `goto` the sim refuses (`GoombaSim.goto`).
  if (S.snap && S.snap.phase === "splash") return;
  // The sheet owns those three while it is up: Space behind it would launch
  // a run nobody can see.
  if (sheetIsArmed()) {
    if (!GO_KEYS.includes(e.key)) return;
    e.preventDefault(); closeSheet(); return;
  }
  if (e.key === " ") { e.preventDefault(); playBtn.onclick(); }
  // `\` — the DOOR to the level pack, and only the door: what the grid looks
  // like is the surface's business (editorOn).
  if (e.key === "\\") {
    e.preventDefault();
    // A plain toggle. Closing locks the door behind you.
    if (S.labOpen) { S.unlocked = false; setLab(false); syncHud(); return; }
    S.unlocked = true;
    if (S.snap && S.snap.phase === "run") transport.send({ type: "stop" });
    setLab(true);
    syncHud();
  }
  // Escape only takes back the door `\` opened; a cleared team keeps its grid.
  if (e.key === "Escape" && S.labOpen && S.unlocked) {
    S.unlocked = false; setLab(false); syncHud();
  }
});


/**
 * Everything a paste has to say: the line under the grid's title, and the
 * toast when the grid is SHUT — "did that work?" is never left to guess.
 */
function pasteSay(msg) {
  editSay(msg);
  if (!S.labOpen) toast(msg, 2600);
}

// ---------- pasting a level in ----------
// Ctrl+V lands wherever you were LOOKING: the selection on the grid (a card
// replaces, the trailing slot appends), the level on screen while playing (the
// tweak-copy-paste loop). Only an EMPTY pack opens the grid, having nowhere
// else to land.
window.addEventListener("paste", (e) => {
  // Laptop only, like every other editing gesture.
  if (!DESKTOP()) return;
  if (S.snap && S.snap.phase === "splash") return; // the finale takes no input

  e.preventDefault();
  // No zoop: the grid it is about to open hides `#help`.
  if (sheetIsArmed()) closeSheet(false);   // the grid must not open behind the sheet
  // Read the screen NOW, not when the clipboard resolves.
  const onGrid = S.labOpen;
  const toGrid = !onGrid && GOOMBA_LEVELS.length === 0;
  if (onGrid || toGrid) {
    // A paste earns the door as surely as `\` does, or the grid it opened on
    // an un-cleared room could not be opened again.
    S.unlocked = true;
    if (!S.labOpen) { S.selected = null; setLab(true); }
    syncHud();
  }
  pasteSay("reading the clipboard…");
  levelFromPaste(e.clipboardData).then(
    ({ level: lv, warnings }) => {
      // `selected` on the grid (null = the dashed slot, append); playing, the
      // level on screen — never null, since an empty pack took the grid branch.
      const target = onGrid || toGrid ? S.selected : level();
      if (target === null && GOOMBA_LEVELS.length >= PACK_MAX) {
        return pasteSay(`the pack is full at ${PACK_MAX} levels`);
      }
      const land = () => {
        // Re-read the pack: a teammate's edit can land while a confirm waits.
        if (target !== null && target >= GOOMBA_LEVELS.length)
          return pasteSay("that slot is gone — select another card and paste again");
        // The pack is a list of LINKS, so a paste becomes one here.
        transport.send({ type: "packSet", index: target, hash: encodeLevel(lv) });
        const where = target === null ? "as a new level" : `over level ${target + 1}`;
        pasteSay(warnings.length
          ? `${lv.name} ${where} · ${warnings.join(" · ")}`
          : `${lv.name} — in, ${where}`);
      };
      const over = target === null ? null : GOOMBA_LEVELS[target];
      // A MATCHING name is a redraw from the frame it came from and goes
      // straight through; a DIFFERENT name asks, because nothing here is
      // undoable. Same rule with the grid shut.
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
// The flare's shape: snap up, fall away. Clocked off the RUN's seconds, not
// wall-clock dt, so it survives a late joiner's fast-forward.
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
    toast("LEVEL CLEAR! 🎉", 1800);
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
  // it (see `postFrame` in render.js for why it is a hook, not its own loop).
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
  if (S.snap.phase === "splash") { drawSplash(tGlobal - splashAt); return; }
  const lv = L();
  const st = syncAnim();
  const riding = st && S.snap.phase === "run";

  // Ride effects, off the local replay.
  if (st) {
    if (riding && st.onBand >= 0 && Math.random() < 0.5) {
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
    // She reached the plant with cans still out. 81 is the sim's own win
    // circle (r=9, `stepRun` in physics.ts): the flare must fire on exactly
    // the pass that WOULD have won. Re-armed on the way out, so three passes
    // read as three taps.
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
  // The flare, and the rings off the cans she still needs, staggered in
  // stored order and capped so a twelve-can level is not pinging a second on.
  const lockFx = st ? lockFlare(st.t - lockT) : 0;
  let nth = 0;
  lv.cans.forEach((m, i) => {
    const taken = st ? st.got[i] : false;
    // Each ring is read off its OWN envelope, not gated on the plant's, or a
    // staggered one vanishes mid-fade.
    const ping = !taken && st ? lockFlare(st.t - lockT - Math.min(nth, 5) * 0.06) : 0;
    if (!taken) nth++;
    drawCan(m[0], m[1], taken, i, ping);
  });
  drawGoalPlant(lv, st, lockFx);
  bands().forEach((bd, i) => drawBand(bd, bandExcite.get(i) || 0, false));
  if (S.snap.phase === "edit") {
    // Teammates' bands-in-progress.
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
// THE CONNECTION LINES: held invisible until this phone has been unreachable
// for STALL_MS UNBROKEN, back the instant it reconnects. Time since boot is
// the wrong clock — an unsorted phone is connected and waits indefinitely.
// 1.5s is a floor on complaining, not a timeout: under a second is not a wait
// anyone perceives, and the normal gaps are a couple of hundred ms.
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
  // The finale's picture, fetched at an idle moment: it arrives with no warning
  // (a run ends and the splash is already up), so it cannot be asked for then.
  preloadSplashArt();
  if (SOLO) {
    // Serverless: the shared sim in-page. A level pasted via the hash opens ON
    // that level; otherwise land on the grid.
    const pasted = adoptHashLevel();
    setLab(pasted === null);
    startDebug({ onSnapshot, level: pasted ?? undefined });
    return;
  }
  // Everything else joins the real room like any player; a ?debug phone
  // differs only in reaching the selector before the team has earned it.
  const name = localStorage.getItem(NAME_KEY) ?? "Cat";
  gateStatusEl.textContent = "Loading…";
  netQuiet(false);   // nothing is connected yet: the clock starts here
  let sorted = false;   // a team is known, so the ROOM socket is the live wire
  watchTeam({
    name,
    onTeam: (team, lobbyName) => {
      localStorage.setItem(NAME_KEY, lobbyName);
      // The lobby socket closes once a real team lands (a `false` on onStatus
      // below); from here the room socket is the only one that counts.
      sorted = true;
      netQuiet(false);   // ...and it is not open yet, so the clock restarts
      // Also the band colour (bandInk). Set before the first snapshot, so
      // nothing is painted in the fallback pink and then swapped.
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
      // Silent once sorted, TEXT included: the lobby socket's deliberate close
      // must not leave "check wifi?" sitting under a slow room join.
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
