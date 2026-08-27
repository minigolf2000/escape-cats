// The LEVELS menu — and, on a laptop, the level editor. One screen either way.
//
// Every level as a card drawn from its own geometry; tapping one sends the whole
// room there. Who may open it is `levelSelect()` in state.js; this draws the same
// grid for a cleared team and for `\`.
//
// A card carries NO verdict. It held two once — a baked solution's result, then
// the bare run's — and both are gone with the bench that graded them. Nothing
// evaluates a level now except people playing it, so there is no true word to put
// on a card, and opening the menu no longer sims every level to label one.

import { GOOMBA_LEVELS, levelLabel } from "@escape-cats/shared";
import { transport } from "./net";
import { hudEl } from "./dom";
import {
  S, DESKTOP, SOLO, editorOn, askConfirm, levelSelect,
} from "./state";
import {
  ctx, W, H, cam, setCamOffset, tGlobal,
  drawTerrain, drawCan, drawGoalPlant, drawGoomba,
  drawCushion, drawPopper, drawBumper,
} from "./render";

/** Hit targets, rebuilt every frame the grid draws. */
let labCells = [];
let labBtns = [];

/**
 * A card tap is a wire intent, so the room answers a round trip later. Closing
 * the grid on the tap would uncover the OLD level for that gap and then swap it
 * under the player — so the tap only LATCHES, and the grid stays up until the
 * authority's snapshot lands on the chosen level. The timeout is the escape
 * hatch for an intent the room never echoes (dropped socket, proctor seat).
 */
let labJump = null;
const LAB_JUMP_MS = 1500;

export function clearLabJump() {
  if (labJump) clearTimeout(labJump.timer);
  labJump = null;
}
/** Open or close the grid. Everything it was in the middle of goes with it: a
 * latched card tap can pull the grid out from under a drag, and a drag with no
 * cards under it has nothing left to mean. */
export function setLab(open) {
  S.labOpen = open;
  hudEl.classList.toggle("lab", open);
  if (!open) { clearLabJump(); labDrag = null; }
}
/** The latched tap resolves on the goto's exact signature — that level, a fresh
 * edit phase, no bands — so a snapshot merely in flight when we tapped does not
 * drop the grid early. */
export function resolveLabJump(s) {
  if (labJump && s.level === labJump.level && s.phase === "edit" && !s.bands.length)
    setLab(false);
}

/** A card being dragged to a new slot. `gap` is an insertion point (0..n), not a
 * card index — "between these two" is what a drop actually means. */
let labDrag = null;
/** The press was consumed by a dialog or a button, so its release must not also
 * count as a click on the card underneath. */
let labDownHandled = false;
/** Hand-rolled double-click, because a tap-to-play on a touchscreen laptop never
 * gets a synthesised `dblclick` — touchstart is preventDefault'd here. */
let lastLabClick = { i: -1, t: 0 };
const DBL_MS = 420;
const DRAG_SLOP = 10;

/** The line under the grid's title: what the last edit did, for four seconds. */
let editMsg = "", editMsgT = 0;
export function editSay(msg) { editMsg = msg; editMsgT = 4; }
export const tickEditMsg = (dt) => { if (editMsgT > 0) editMsgT = Math.max(0, editMsgT - dt); };

/**
 * Open the levels grid. Two things reach it — the dot strip's plate, and a tap
 * anywhere on the congratulations screen (`splashTap`) — so the gate and the
 * "stop whatever is running first" live in one place and cannot disagree.
 */
export function openSelector() {
  if (!levelSelect()) return; // an indicator until the team clears the game
  if (S.snap && S.snap.phase === "run") transport.send({ type: "stop" });
  setLab(true);
}

/** The pack changed under us: a selection past the end and a drag naming a slot
 * that has just been renumbered can neither of them be re-aimed honestly. */
export function onPackChanged() {
  if (S.selected !== null && S.selected >= GOOMBA_LEVELS.length) S.selected = null;
  labDrag = null;
}

/** Ellipsise `s` to at most `maxW` px in the current ctx font. */
function fitText(s, maxW) {
  if (ctx.measureText(s).width <= maxW) return s;
  let n = s.length;
  while (n > 1 && ctx.measureText(s.slice(0, n) + "…").width > maxW) n--;
  return s.slice(0, n) + "…";
}
/** The card under a point, or -1. */
function labCardAt(px, py) {
  for (const c of labCells)
    if (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h) return c.i;
  return -1;
}
/** The editor button under a point, or null. */
function labButtonAt(px, py) {
  for (const b of labBtns)
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b;
  return null;
}
/**
 * Where a dragged card would land: an insertion GAP (0..n), read off the
 * nearest card as "left of its middle = before it, right = after it".
 *
 * Nearest CARD rather than a rect hit, because the pointer spends a drag in
 * the gutters between cards and at the ragged end of the last row, and a drop
 * there still has an obvious answer — the alternative is a drag that goes
 * dead in the space it is aiming at.
 */
function labGapAt(px, py) {
  let best = null, bestD = Infinity;
  for (const c of labCells) {
    const dx = px - (c.x + c.w / 2), dy = py - (c.y + c.h / 2);
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) return 0;
  return px > best.x + best.w / 2 ? best.i + 1 : best.i;
}
/** Send the whole room to a level — the one thing a card tap has always done.
 * Latches BEFORE sending: the ?solo backend answers inside send(), and that
 * synchronous snapshot is what closes the lab. */
export function labJumpTo(i) {
  if (i < 0 || i >= GOOMBA_LEVELS.length) return;
  clearLabJump();
  labJump = {
    level: i,
    timer: setTimeout(() => { labJump = null; setLab(false); }, LAB_JUMP_MS),
  };
  transport.send({ type: "goto", level: i });
}
/** A per-card editor button, pressed. */
function labButtonHit(b) {
  const lv = GOOMBA_LEVELS[b.i];
  switch (b.kind) {
    // DELETE — behind a confirm, because it is the one control here that
    // destroys a level rather than moving it, and the pack is the only copy.
    case "del":
      askConfirm(`Delete level ${b.i + 1}?`, lv ? lv.name : "", () => {
        // Follow the selection across the hole this leaves, or it silently
        // re-aims at whatever slides up into the slot.
        if (S.selected === b.i) S.selected = null;
        else if (S.selected !== null && S.selected > b.i) S.selected -= 1;
        transport.send({ type: "packDelete", index: b.i });
        editSay(`deleted level ${b.i + 1}`);
      });
      return;
    case "new":
      S.selected = null;
      editSay("next paste adds a new level — Ctrl+V a Figma frame");
      return;
  }
}
/**
 * A press on the grid. This is where the two surfaces part company: a phone
 * plays the card it touched, a laptop selects it and holds the press open in
 * case it becomes a drag.
 */
export function labPointerDown(px, py) {
  labDownHandled = false;
  labDrag = null;
  // Editor buttons next. They sit ON the cards, so hit-testing them after the
  // card would make ⌫ ask about a level AND select it under the question.
  const btn = labButtonAt(px, py);
  if (btn) { labDownHandled = true; labButtonHit(btn); return; }
  const i = labCardAt(px, py);
  // THE PHONE: a tap plays. There is nothing to select on a phone — no paste
  // to aim, no drag to make — so a select-then-play would be a toll on the one
  // gesture that means anything.
  if (!DESKTOP()) { labDownHandled = true; labJumpTo(i); return; }
  // THE LAPTOP: select on the press, like every file browser. Clicking off the
  // cards clears the selection back to the trailing slot, which is what "the
  // next paste adds a level" looks like.
  S.selected = i < 0 ? null : i;
  if (editorOn() && i >= 0)
    labDrag = { i, sx: px, sy: py, x: px, y: py, moved: false, gap: i };
}
export function labPointerMove(px, py) {
  if (!labDrag) return;
  labDrag.x = px; labDrag.y = py;
  if (!labDrag.moved && Math.hypot(px - labDrag.sx, py - labDrag.sy) > DRAG_SLOP)
    labDrag.moved = true;
  if (labDrag.moved) labDrag.gap = labGapAt(px, py);
}
export function labPointerUp(px, py) {
  const d = labDrag;
  labDrag = null;
  if (labDownHandled) { labDownHandled = false; return; }
  if (d && d.moved) {
    // packMove's `to` is an index in the list with the dragged level already
    // pulled OUT, so a gap to its right has shifted back by one.
    const to = d.gap > d.i ? d.gap - 1 : d.gap;
    if (to !== d.i && to >= 0 && to < GOOMBA_LEVELS.length) {
      S.selected = to; // the selection is the level, not the slot it was in
      transport.send({ type: "packMove", from: d.i, to });
      editSay(`moved level ${d.i + 1} to slot ${to + 1}`);
    }
    return;
  }
  // Not a drag, so the press already selected — and a SECOND press on the same
  // card inside the double-click window is what plays it. Hand-rolled rather
  // than left to the `dblclick` event because touchstart is preventDefault'd
  // here (the kiosk lockdown), which is exactly what stops a browser
  // synthesising that event on a laptop with a touchscreen.
  const i = labCardAt(px, py);
  if (i < 0) { lastLabClick = { i: -1, t: 0 }; return; }
  const t = performance.now();
  if (lastLabClick.i === i && t - lastLabClick.t < DBL_MS) {
    lastLabClick = { i: -1, t: 0 };
    labJumpTo(i);
    return;
  }
  lastLabClick = { i, t };
}
/**
 * The one line under the title. It has to describe a DIFFERENT screen on each
 * surface, because the gestures are different: on a phone a tap plays, on a
 * laptop a tap selects and the second one plays. Two lines, not three — a
 * laptop has exactly one grid (editorOn is the surface), so there is no
 * controls-off wording left to write for it.
 */
function labHelp() {
  if (editorOn() && editMsgT > 0 && editMsg) return editMsg;
  if (GOOMBA_LEVELS.length === 0)
    return DESKTOP()
      ? "no levels yet — copy a frame in Figma and press Ctrl+V"
      : "no levels yet — a laptop pastes them in from Figma";
  const play = SOLO ? "plays it locally — no server, no room" : "jumps the whole room there";
  if (!DESKTOP()) return `tap a card — it ${play}`;
  return "click selects · double-click plays · drag reorders · Ctrl+V lands on the selection";
}
export function drawLab() {
  ctx.fillStyle = "#100722"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.font = "700 15px ui-rounded, system-ui, sans-serif";
  ctx.fillStyle = "#f2ecff";
  ctx.fillText("Levels", 16, 30);
  ctx.font = "12px ui-rounded, system-ui, sans-serif";
  ctx.fillStyle = editorOn() && editMsgT > 0 ? "#ffd166" : "#8a80b0";
  ctx.fillText(fitText(labHelp(), W - 32), 16, 48);

  // One extra slot on a laptop: the dashed "paste a new level here" card,
  // which is what `selected === null` looks like on screen.
  const slots = GOOMBA_LEVELS.length + (editorOn() ? 1 : 0);
  const cols = W > H ? 3 : 2;
  const rows = Math.max(1, Math.ceil(slots / cols));
  const padX = 12, top = 62, bottom = 24;
  const cw = (W - padX * (cols + 1)) / cols;
  const ch = Math.min((H - top - bottom - 12 * (rows - 1)) / rows, cw * 1.5);
  labCells = [];
  labBtns = [];
  const savedCam = { ...cam };

  /** The per-card editor controls. Drawn last so they sit over the level, and
   * hit-tested BEFORE the card, so pressing ⌫ never also selects it. It acts
   * on the card it sits on whatever is selected — a button on a card is a
   * sentence about that card.
   *
   * ONE button, down from four: ◀ ▶ went to the drag, and `⧉` copy went too.
   * Copy existed to get a level back OUT as a link — to duplicate it, to send
   * it, or to grade it on the bench. Duplicating and sending are Figma's now
   * (the frame is the source, and Ctrl+C there is the way in), and grading is
   * nobody's — the bench is deleted, and a level is judged by being played.
   * `seed.mjs --pull` reads a live event's whole pack off the lobby, which beat
   * copying one card at a time even when there was something to grade with. */
  const cardButtons = (i, x, y) => {
    if (!editorOn()) return;
    const B = 22, G = 4;
    const kinds = [["del", "⌫"]];
    let bx = x + cw - 8 - (B * kinds.length + G * (kinds.length - 1));
    for (const [kind, glyph] of kinds) {
      const by = y + 8;
      labBtns.push({ i, kind, x: bx, y: by, w: B, h: B });
      ctx.beginPath();
      ctx.roundRect(bx, by, B, B, 6);
      ctx.fillStyle = "rgba(16,7,34,0.8)";
      ctx.fill();
      ctx.strokeStyle = "rgba(201,189,240,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#f2ecff";
      ctx.font = "600 11px ui-rounded, system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(glyph, bx + B / 2, by + B / 2 + 0.5);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      bx += B + G;
    }
  };
  GOOMBA_LEVELS.forEach((lv, i) => {
    const c = i % cols, r = (i / cols) | 0;
    const x = padX + c * (cw + padX), y = top + r * (ch + 12);
    labCells.push({ i, x, y, w: cw, h: ch });
    // The card being dragged fades where it came from, so the gap it is about
    // to leave reads as a gap rather than as a duplicate.
    if (labDrag && labDrag.moved && labDrag.i === i) ctx.globalAlpha = 0.35;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 12); ctx.clip();
    ctx.fillStyle = "#180d31"; ctx.fillRect(x, y, cw, ch);
    // the level itself, fitted into the card
    const b = lv.bounds, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    const inner = 16;
    cam.s = Math.min((cw - inner) / bw, (ch - inner - 22) / bh);
    cam.x = (b.x0 + b.x1) / 2; cam.y = (b.y0 + b.y1) / 2;
    setCamOffset(x + cw / 2 - W / 2, y + (ch - 22) / 2 + 11 - H / 2);
    drawTerrain(lv);
    lv.cushions.forEach((cu) => drawCushion(cu, 0));
    lv.pops.forEach((pp, k) => drawPopper(pp, k));
    lv.bumpers.forEach((bp) => drawBumper(bp, 0));
    lv.cans.forEach((m, k) => drawCan(m[0], m[1], false, k));
    drawGoalPlant(lv, null);
    // Her spawn, drawn as herself. A card is read at a glance and every other
    // thing on it is a picture of the thing it is; `start` was the one piece of
    // the level with nothing standing where it says. Idle, so the grid has her
    // waiting on all of them at once.
    drawGoomba(lv.start[0], lv.start[1], lv.startAngle, 1, true, false, true);
    setCamOffset(0, 0);
    ctx.restore();
    // frame + labels
    const jumping = labJump !== null && i === labJump.level;
    const current = S.snap !== null && i === S.snap.level;
    ctx.strokeStyle = jumping ? "#57e6c9" : current ? "#ffd166" : "rgba(201,189,240,0.22)";
    ctx.lineWidth = jumping || current ? 2.5 : 1.5;
    if (lv.pasted) ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 12); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "700 12px ui-rounded, system-ui, sans-serif";
    ctx.fillStyle = "#f2ecff";
    // The title is all a card says, so trim to the card's real width rather
    // than a guessed character count.
    //
    // The number comes from the card's PLACE, not from the level — see
    // `levelLabel`. A hash-adopted level is the one card that gets no number:
    // it is appended to this array locally and is not in the pack at all, so
    // numbering it would claim a position in a pack it never joined, which is
    // the opposite of what the rest of the card says about itself.
    const title = lv.pasted ? lv.name : levelLabel(i, lv.name);
    ctx.fillText(fitText(title, cw - 18), x + 9, y + ch - 8);
    // A level adopted from the URL hash (?solo#…) is the one kind that is NOT
    // in the event's pack: it plays identically — same sim, same bands, same
    // scoring — but nobody else can see it and no room has to clear it. It
    // takes the top-left corner the bare verdict used to hold.
    if (lv.pasted) {
      ctx.font = "700 9px ui-rounded, system-ui, sans-serif";
      ctx.fillStyle = "#ffd166";
      ctx.fillText("FROM A LINK — not in the pack", x + 9, y + 16);
    }
    // The round trip, made visible: the tap landed, the room is coming with us.
    if (jumping) {
      ctx.save();
      ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 12); ctx.clip();
      ctx.fillStyle = "rgba(16,7,34,0.55)"; ctx.fillRect(x, y, cw, ch);
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(tGlobal * 6);
      ctx.fillStyle = "#57e6c9";
      ctx.font = "700 13px ui-rounded, system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("jumping…", x + cw / 2, y + ch / 2);
      ctx.restore();
    }
    // SELECTION, drawn outside the card's own frame so it can coexist with
    // the amber "this is the level the room is on" — they are different facts
    // and a card is often both.
    if (DESKTOP() && S.selected === i) {
      ctx.strokeStyle = "#f2ecff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x - 4, y - 4, cw + 8, ch + 8, 15); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    cardButtons(i, x, y);
  });

  // Where a drop would land: a bar in the GAP, not a highlight on a card,
  // because "between 2 and 3" is what a reorder actually chooses.
  if (labDrag && labDrag.moved) {
    const g = labDrag.gap;
    const gx = padX + (g % cols) * (cw + padX) - 6;
    const gy = top + ((g / cols) | 0) * (ch + 12);
    ctx.fillStyle = "#57e6c9";
    ctx.beginPath(); ctx.roundRect(gx - 1.5, gy, 3, ch, 2); ctx.fill();
  }

  // The trailing slot: where a paste lands when it is not replacing anything.
  // Drawn as a card rather than explained in a line of help, because "the next
  // paste goes HERE" is a place, and a place is easier to point at than a rule.
  if (editorOn()) {
    const i = GOOMBA_LEVELS.length;
    const c = i % cols, r = (i / cols) | 0;
    const x = padX + c * (cw + padX), y = top + r * (ch + 12);
    labBtns.push({ i, kind: "new", x, y, w: cw, h: ch });
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = S.selected === null ? "#ffd166" : "rgba(201,189,240,0.3)";
    ctx.lineWidth = S.selected === null ? 2.5 : 1.5;
    ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 12); ctx.stroke();
    ctx.restore();
    // The empty slot is selectable like any card — "nothing is S.selected" and
    // "the new-level slot is S.selected" are one state, and this is its face.
    if (S.selected === null) {
      ctx.strokeStyle = "#f2ecff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x - 4, y - 4, cw + 8, ch + 8, 15); ctx.stroke();
    }
    ctx.fillStyle = S.selected === null ? "#ffd166" : "#8a80b0";
    ctx.font = "700 12px ui-rounded, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("+ Ctrl+V", x + cw / 2, y + ch / 2 - 8);
    ctx.font = "10px ui-rounded, system-ui, sans-serif";
    ctx.fillText("a Figma frame", x + cw / 2, y + ch / 2 + 10);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }
  Object.assign(cam, savedCam);
}
