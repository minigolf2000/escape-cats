// WHAT THIS PHONE CAN PLAY, and what it remembers. Three layers, composed once
// at boot and again on every overlay edit:
//
//   baked    `levels.data.ts` — the list the game ships. Read-only at runtime.
//   overlay  localStorage — the power user's scratch pack. Ctrl+V lands here,
//            ⌫ and drag act here, and NOTHING else can see it. Laptop only
//            (`editorOn`), because a phone has no Ctrl+V to follow a delete.
//   hash     one level from `#<link>`, adopted at boot. Scratch: no id, never
//            remembered, gone on the next load. `draft.mjs link` prints these.
//
// The order IS the numbering the player sees, so the shipped levels are always
// 1..n and a pasted one lands after them — nothing a paste does can renumber
// the game underneath somebody's saved progress.
//
// This file owns STORAGE. What the rows and the progress MEAN is shared
// (`goomba/library.ts`), because the same rules have to hold for the export
// that writes `levels.data.ts`.

import {
  BAKED_LEVELS,
  completedFor,
  encodeLevel,
  foldProgress,
  freshProgress,
  initLevel,
  localId,
  readProgress,
  rowsToLevels,
  setGoombaLevels,
  GOOMBA_LEVELS,
} from "@escape-cats/shared";
import { decodeLevel } from "@escape-cats/shared";

const OVERLAY_KEY = "goomba-overlay";
const PROGRESS_KEY = "goomba-progress";
const STATE_KEY = "goomba-state";

/** localStorage is a shared, editable, occasionally ABSENT surface (private
 * windows throw on write). Every read answers with a default and every write
 * is allowed to fail: a game that cannot save is still a game. */
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---------- the overlay ----------

/** The local rows, in order. Anything malformed is dropped rather than thrown:
 * this is hand-editable storage. */
export function readOverlay() {
  const rows = load(OVERLAY_KEY, []);
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (r) => r && typeof r.id === "string" && typeof r.hash === "string",
  );
}
const writeOverlay = (rows) => save(OVERLAY_KEY, rows);

// ---------- the hash layer ----------

/**
 * The level in `location.hash`, or null. Read ONCE at boot and never again —
 * a hash that re-read on change would swap the world out mid-run.
 *
 * Tolerates a bare link (`#AwAK…`, what `draft.mjs link` and every old link
 * print) and ignores anything shaped like a query (`#k=v`), so the fragment
 * has room to grow a key later without eating a level.
 */
function hashLevel() {
  const raw = location.hash.slice(1);
  if (!raw || raw.includes("=") || raw.includes("&")) return null;
  const L = decodeLevel(raw);
  if (!L) return null;
  L.source = "hash";
  L.pasted = true;
  return L; // deliberately no id: a scratch level is never remembered
}

// ---------- composing ----------

let hashed = null; // the boot-time hash level, kept across recomposes

/**
 * Rebuild `GOOMBA_LEVELS` from the three layers. Returns the index of the hash
 * level when there is one, so boot can open straight onto the thing you just
 * pasted into the URL instead of making you find it.
 */
export function composeLibrary({ first = false } = {}) {
  if (first) hashed = hashLevel();
  setGoombaLevels([
    ...rowsToLevels(BAKED_LEVELS, "baked"),
    ...rowsToLevels(readOverlay(), "local"),
    ...(hashed ? [initLevel(hashed)] : []),
  ]);
  return hashed ? GOOMBA_LEVELS.length - 1 : null;
}

// ---------- editing the overlay ----------

/** Where the editable layer starts. A baked level cannot be deleted, moved or
 * overwritten from inside the game — it is source, and the way to change it is
 * a commit. The grid asks this before it draws a ⌫ on a card. */
export const overlayBase = () => BAKED_LEVELS.length;
export const isEditable = (i) => i >= overlayBase() && i < overlayBase() + readOverlay().length;

/** Paste a level in. `index` null appends; otherwise it REPLACES that slot,
 * which is how you fix a level in Figma and paste over it — and the id is kept
 * across the replacement, so a retune does not un-clear it. Returns the index
 * it landed at, or null if it was refused. */
export function overlaySet(index, hash) {
  const L = decodeLevel(hash);
  if (!L) return null;
  const rows = readOverlay();
  if (index === null || index === undefined) {
    rows.push({ id: localId(L.name), name: L.name, hash });
  } else {
    const at = index - overlayBase();
    if (at < 0 || at >= rows.length) return null;
    rows[at] = { id: rows[at].id, name: L.name, hash };
  }
  writeOverlay(rows);
  return index ?? overlayBase() + rows.length - 1;
}

export function overlayDelete(index) {
  const rows = readOverlay();
  const at = index - overlayBase();
  if (at < 0 || at >= rows.length) return false;
  rows.splice(at, 1);
  writeOverlay(rows);
  return true;
}

/** Reorder inside the overlay. Both ends must be editable — dragging a local
 * level in among the shipped ones would claim a number it cannot keep. */
export function overlayMove(from, to) {
  const rows = readOverlay();
  const a = from - overlayBase();
  const b = to - overlayBase();
  if (a < 0 || a >= rows.length || b < 0 || b >= rows.length) return false;
  rows.splice(b, 0, ...rows.splice(a, 1));
  writeOverlay(rows);
  return true;
}

/**
 * The overlay as `levels.data.ts` rows, ready to paste in. THE COMMIT STEP:
 * this is the whole distance between "it plays on my laptop" and "it ships",
 * and it is deliberately a copy-paste a human does, not a write this app can
 * make — the list is source, and source goes through review.
 *
 * The id is re-slugged off the name with no `local-` prefix and no random
 * suffix, because the suffix exists only to keep two local pastes apart. Check
 * it before you commit: the id is forever (`library.ts`).
 */
export function exportOverlay() {
  return readOverlay()
    .map((row) => {
      const L = decodeLevel(row.hash);
      if (!L) return null;
      const id = row.id.replace(/^local-/, "").replace(/-[a-z0-9]{4}$/, "");
      return (
        `  {\n    id: ${JSON.stringify(id)},\n` +
        `    name: ${JSON.stringify(L.name)},\n` +
        `    hash: ${JSON.stringify(row.hash)},\n  },`
      );
    })
    .filter(Boolean)
    .join("\n");
}

// ---------- progress ----------

let progress = freshProgress();

/** The durable record, read once. */
export function loadProgress() {
  progress = readProgress(load(PROGRESS_KEY, null));
  return progress;
}

/** `completed` for the list as it stands right now — the projection the sim
 * runs on. */
export const completedNow = () => completedFor(GOOMBA_LEVELS, progress);

/** Fold a snapshot's `completed` back into the record and persist it. Called
 * on every snapshot: cheap, and the alternative is losing a clear to a phone
 * that closed the tab on the win screen. */
export function saveProgress(completed, now) {
  const next = foldProgress(progress, GOOMBA_LEVELS, completed, now);
  const same =
    Object.keys(next.cleared).length === Object.keys(progress.cleared).length &&
    Object.keys(next.cleared).every((id) => progress.cleared[id] === next.cleared[id]);
  progress = next;
  if (!same) save(PROGRESS_KEY, progress);
}

// ---------- the rest of the room's state ----------

/** Bands, level and phase, so closing the tab mid-puzzle does not throw the
 * puzzle away. Progress is NOT read back from here (`completed` is projected
 * from the id-keyed record instead) — this is the convenience half of the save
 * and the other half is the durable one. */
export const loadState = () => load(STATE_KEY, null);
export const saveState = (persisted) => save(STATE_KEY, persisted);

/** Forget everything this browser knows: progress, the saved room, and the
 * local overlay's levels stay (they are the power user's drafts, not
 * progress). Wired to the grid's "start over". */
export function forgetProgress() {
  progress = freshProgress();
  save(PROGRESS_KEY, progress);
  try {
    localStorage.removeItem(STATE_KEY);
  } catch {
    /* nothing to do: a browser that cannot write cannot have saved */
  }
}

/** Re-encode a level as a link — the clipboard format, for the grid's copy. */
export const levelLink = (L) => encodeLevel(L);
