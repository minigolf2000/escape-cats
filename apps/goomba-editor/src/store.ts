/**
 * Where a level lives when it isn't in `levels.ts` yet.
 *
 * The editor has no server and no account, on purpose: a design day produces
 * twenty candidate levels, nineteen of which never ship, and standing up
 * storage for them would be more machinery than the levels are worth. So the
 * save format is the URL — `encodeLevel` packs a whole level into 100–450
 * base64url characters, which fits in a link, a chat message, a sticky note, or
 * a QR code. This is qr-studio's trade, made for the same reason.
 *
 * Three tiers, and they do different jobs:
 *
 *   1. `location.hash` — the SHARE tier. Read once at boot, written only when
 *      someone asks for a link. A link is a whole level, so it travels: paste
 *      it to a teammate, or hand it to `node verify.mjs --hash <link>` to run
 *      the real gate on a level nobody has committed.
 *   2. `localStorage` — the DRAFT tier. Autosaved continuously so a reload or
 *      a closed lid costs nothing. Deliberately not the URL: a hash rewritten
 *      on every drag turns the back button into an undo log nobody asked for,
 *      and buries the shared link the designer arrived on.
 *   3. The TRAY — a named list of links in localStorage, so one laptop can
 *      hold a whole team's output. It exports as the newline-delimited file
 *      `node verify.mjs --file` reads, which is how a jam's morning becomes an
 *      afternoon of verdicts.
 *
 * Everything here is best-effort: a browser with storage disabled still edits
 * and still shares, it just forgets between reloads.
 */
import { encodeLevel, decodeLevel, type GoombaLevel } from "@escape-cats/shared";

const DRAFT_KEY = "goomba-editor-draft";
const TRAY_KEY = "goomba-editor-tray";

export interface TrayEntry {
  /** Stable id so the row survives a rename. */
  id: string;
  name: string;
  hash: string;
}

/** localStorage that never throws — Safari private mode, quota, disabled. */
const readRaw = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeRaw = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* best-effort: the level is still in the URL on demand */
  }
};

/**
 * The level this page should open with, and where it came from — the caller
 * shows the difference, because "I opened someone's link" and "I picked up my
 * own draft" are very different things to a designer mid-jam.
 */
export function bootLevel(): { level: GoombaLevel | null; from: "link" | "draft" | "none" } {
  if (location.hash.length > 1) {
    const level = decodeLevel(location.hash.slice(1));
    // A hash we cannot read is worth saying so about rather than silently
    // replacing with a draft — a truncated paste is the likeliest cause, and
    // the designer needs to know their link arrived damaged.
    if (level) return { level, from: "link" };
  }
  const draft = readRaw(DRAFT_KEY);
  if (draft) {
    const level = decodeLevel(draft);
    if (level) return { level, from: "draft" };
  }
  return { level: null, from: "none" };
}

let draftTimer: ReturnType<typeof setTimeout> | null = null;

/** Autosave the working level. Debounced, because it fires on every drag. */
export function saveDraft(level: GoombaLevel): void {
  if (draftTimer !== null) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      writeRaw(DRAFT_KEY, encodeLevel(level));
    } catch {
      /* a level too strange to encode still edits fine */
    }
  }, 250);
}

/** The whole level as a URL anyone can open. */
export function shareLink(level: GoombaLevel): string {
  return location.origin + location.pathname + "#" + encodeLevel(level);
}

export function readTray(): TrayEntry[] {
  const raw = readRaw(TRAY_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter rather than trust: this is user data that a previous version of
    // this file wrote, and a tray that throws on read loses the whole day.
    return parsed.filter(
      (e): e is TrayEntry =>
        !!e && typeof e.id === "string" && typeof e.name === "string" && typeof e.hash === "string",
    );
  } catch {
    return [];
  }
}

const writeTray = (entries: TrayEntry[]): void =>
  writeRaw(TRAY_KEY, JSON.stringify(entries));

/**
 * Put the current level in the tray. Saving a level whose name is already
 * there REPLACES it, so the tray tracks levels rather than accumulating a
 * version history of each — the same name saved eight times during an
 * afternoon is one level, and eight rows would bury the other teams'.
 */
export function saveToTray(level: GoombaLevel): TrayEntry[] {
  const hash = encodeLevel(level);
  const name = level.name.trim() || "untitled";
  const entries = readTray();
  const at = entries.findIndex((e) => e.name === name);
  const entry: TrayEntry = {
    id: at >= 0 ? entries[at].id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    hash,
  };
  if (at >= 0) entries[at] = entry;
  else entries.push(entry);
  writeTray(entries);
  return entries;
}

export function removeFromTray(id: string): TrayEntry[] {
  const entries = readTray().filter((e) => e.id !== id);
  writeTray(entries);
  return entries;
}

/**
 * The tray as the file `verify.mjs --file` eats: one link per line, each under
 * a `//` comment naming it, so the batch output is readable next to the file
 * that produced it.
 */
export function trayFile(entries: TrayEntry[]): string {
  return (
    "// Goomba Glider levels — run the gate with:\n" +
    "//   cd tools/goomba && node verify.mjs --file <this file>\n\n" +
    entries.map((e) => `// ${e.name}\n${e.hash}\n`).join("\n")
  );
}
