// The LEVELS menu — and, on a laptop, the level editor. One screen either way.
// Every level as a card drawn from its own geometry; tapping one sends the
// game there. Who may open it is `levelSelect()` in state.js.
//
// A card carries NO verdict: nothing evaluates a level except people playing
// it (CLAUDE.md). Don't add one.

import { GOOMBA_LEVELS, hasBonusLevels, levelLabel } from "@escape-cats/shared";
import { exportOverlay, isEditable, overlayBase } from "./library";
import { transport } from "./transport";
import { exportBtn, hudEl } from "./dom";
import {
  S, DESKTOP, editorOn, askConfirm, levelSelect,
} from "./state";
import {
  ctx, W, H, cam, setCamOffset,
  drawTerrain, drawCan, drawGoalPlant, drawGoomba,
  drawCushion, drawPopper, drawBumper,
} from "./render";

/** Hit targets, rebuilt every frame the grid draws. */
let labCells = [];
let labBtns = [];

/** Open or close the grid. A card tap can pull the grid out from under a
 * drag, and a drag with no cards under it has nothing left to mean. */
export function setLab(open) {
  S.labOpen = open;
  hudEl.classList.toggle("lab", open);
  if (open) syncExportBtn();
  if (!open) labDrag = null;
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
 * Open the levels grid. The dot strip's plate is what reaches it, and this is
 * where the gate and the "stop whatever is running first" live, so they cannot
 * disagree.
 *
 * From the FINALE only when there are post-credits levels — the grid is the
 * door to them. With none the screen is terminal and the jump it would make is
 * one the sim refuses (`GoombaSim.goto`).
 */
export function openSelector() {
  if (!levelSelect()) return; // an indicator until the game is cleared
  if (S.snap && S.snap.phase === "splash" && !hasBonusLevels()) return;
  if (S.snap && S.snap.phase === "run") transport.send({ type: "stop" });
  setLab(true);
}

/** The pack changed under us: a selection past the end and a drag naming a slot
 * that has just been renumbered can neither of them be re-aimed honestly. */
export function onPackChanged() {
  if (S.selected !== null && S.selected >= GOOMBA_LEVELS.length) S.selected = null;
  labDrag = null;
  syncExportBtn(); // the first paste is what makes there be anything to export
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
 * Where a dragged card would land: an insertion GAP (0..n), off the NEAREST
 * card (not a rect hit — the pointer spends a drag in the gutters).
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
/** Send the game to a level — the one thing a card tap has always done. The
 * backend answers inside send(), so by the time it returns the snapshot is in;
 * the grid closes only if the sim actually went (that level, a fresh edit
 * phase, no bands), so a refused jump leaves it up rather than uncovering
 * the old level. */
function labJumpTo(i) {
  if (i < 0 || i >= GOOMBA_LEVELS.length) return;
  transport.send({ type: "goto", level: i });
  const s = S.snap;
  if (s && s.level === i && s.phase === "edit" && !s.bands.length) setLab(false);
}
/** A per-card editor button, pressed. */
function labButtonHit(b) {
  const lv = GOOMBA_LEVELS[b.i];
  switch (b.kind) {
    // DELETE — behind a confirm: the pack is the only copy.
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
 * THE COMMIT STEP: your overlay as `levels.data.ts` rows, on the clipboard.
 * Deliberately a copy-paste a human does — the shipped list is source, and
 * source goes through review (`library.js`, `exportOverlay`).
 *
 * A real button rather than a canvas pill, because writing to the clipboard
 * wants a real user gesture behind it.
 */
exportBtn.addEventListener("click", () => {
  const rows = exportOverlay();
  if (!rows.length) return editSay("nothing to export — paste a level in first");
  const text = rows.join("\n");
  navigator.clipboard.writeText(text).then(
    () => editSay(`${rows.length} level(s) copied — paste into levels.data.ts`),
    () => {
      // A clipboard the browser refuses (no permission, an insecure origin) is
      // not a dead end: the rows still have to reach a file somehow.
      console.log(text);
      editSay("clipboard refused — the rows are in the console");
    },
  );
});

/** Nothing pasted in yet means nothing to export. Called from `setLab`, so the
 * button's state is decided the moment the grid opens rather than every frame. */
function syncExportBtn() {
  exportBtn.hidden = !GOOMBA_LEVELS.some((L) => L.source === "local");
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
  // THE PHONE: a tap plays (nothing to select — no paste to aim).
  if (!DESKTOP()) { labDownHandled = true; labJumpTo(i); return; }
  // THE LAPTOP: select on the press. Clicking off the cards selects the
  // trailing slot ("the next paste adds a level").
  S.selected = i < 0 ? null : i;
  // Only YOUR levels reorder. A shipped level's place is its line in
  // `levels.data.ts`, and dragging one here would claim a number that the next
  // load takes straight back.
  if (editorOn() && i >= 0 && isEditable(i))
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
    // Clamped into the overlay: a drop above the shipped levels would ask for
    // a slot the backend refuses, and the card would spring back with no word.
    if (to !== d.i && to >= overlayBase() && to < GOOMBA_LEVELS.length) {
      S.selected = to; // the selection is the level, not the slot it was in
      transport.send({ type: "packMove", from: d.i, to });
      editSay(`moved level ${d.i + 1} to slot ${to + 1}`);
    }
    return;
  }
  // Not a drag, so the press already selected; a SECOND press inside the
  // double-click window plays. Hand-rolled: the kiosk lockdown's
  // preventDefault on touchstart stops `dblclick` on a touchscreen laptop.
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
 * The one line under the title, per surface: a phone taps to play, a laptop
 * selects then plays. Two wordings, not three — a laptop has exactly one grid.
 */
function labHelp() {
  if (editorOn() && editMsgT > 0 && editMsg) return editMsg;
  if (GOOMBA_LEVELS.length === 0)
    return DESKTOP()
      ? "no levels yet — copy a frame in Figma and press Ctrl+V"
      : "no levels yet — a laptop pastes them in from Figma";
  if (!DESKTOP()) return "tap a card to play it";
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
  // Both hit lists are rebuilt every frame the grid draws, and everything that
  // pushes to them is below this line.
  labCells = [];
  labBtns = [];

  // One extra slot on a laptop: the dashed "paste a new level here" card,
  // which is what `selected === null` looks like on screen.
  const slots = GOOMBA_LEVELS.length + (editorOn() ? 1 : 0);
  const cols = W > H ? 3 : 2;
  const rows = Math.max(1, Math.ceil(slots / cols));
  const padX = 12, top = 62, bottom = 24;
  const cw = (W - padX * (cols + 1)) / cols;
  const ch = Math.min((H - top - bottom - 12 * (rows - 1)) / rows, cw * 1.5);
  const savedCam = { ...cam };

  /** The per-card editor controls. Drawn last so they sit over the level, and
   * hit-tested BEFORE the card, so pressing ⌫ never also selects it. Acts on
   * the card it sits on, whatever is selected. ONE button: reorder is the
   * drag, and the copy-out is `export` under the grid, which prints the whole
   * overlay at once because that is the shape `levels.data.ts` wants.
   *
   * Only on a card you may EDIT. A shipped level has no ⌫ because it is
   * source: the way to change one is a commit (`library.js`). */
  const cardButtons = (i, x, y) => {
    if (!editorOn() || !isEditable(i)) return;
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
    // Her spawn, drawn as herself, idle.
    drawGoomba(lv.start[0], lv.start[1], lv.startAngle, 1, true, false, true);
    setCamOffset(0, 0);
    ctx.restore();
    // frame + labels
    const current = S.snap !== null && i === S.snap.level;
    ctx.strokeStyle = current ? "#ffd166" : "rgba(201,189,240,0.22)";
    ctx.lineWidth = current ? 2.5 : 1.5;
    if (lv.source !== "baked") ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 12); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "700 12px ui-rounded, system-ui, sans-serif";
    ctx.fillStyle = "#f2ecff";
    // The number is the card's PLACE (`levelLabel`). The hash level gets none:
    // it is scratch, and numbering it would claim a slot it does not hold.
    const title = lv.source === "hash" ? lv.name : levelLabel(i, lv.name);
    ctx.fillText(fitText(title, cw - 18), x + 9, y + ch - 8);
    // WHERE THIS CAME FROM, on the two cards that are not the shipped game.
    // Both play identically; the difference is what happens to them next.
    const badge =
      lv.source === "hash" ? "FROM A LINK — not saved"
      : lv.source === "local" ? "YOURS — export to ship it"
      : null;
    if (badge) {
      ctx.font = "700 9px ui-rounded, system-ui, sans-serif";
      ctx.fillStyle = "#ffd166";
      ctx.fillText(badge, x + 9, y + 16);
    }
    // SELECTION, outside the card's frame so it coexists with the amber
    // "the game is on this level" — a card is often both.
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
    // "nothing is S.selected" and "the new-level slot is selected" are one
    // state; this is its face.
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
