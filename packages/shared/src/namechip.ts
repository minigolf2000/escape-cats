// The name chip: the control a player renames themselves with, on the lobby's
// board and on both of the chat's screens. Markup only, as `ears.ts` is —
// each app keeps its own CSS and wires its own repaint, because those are the
// parts that legitimately differ.

import { NAME_MAX, nameDraft } from "./lobby";

/** The ids the markup uses, so the wiring does not retype them. */
export const CHIP = {
  open: "namechip",
  input: "newname",
  save: "savename",
  cancel: "cancelname",
} as const;

/** No `document` here: shared is bundled into the Worker. */
function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The chip, or the editor it becomes. No `maxlength` — it counts UTF-16
 * units, so it would allow six emoji and twelve letters; `clampName` holds the
 * input to `NAME_MAX` characters as read. */
export function nameChipHtml(name: string, draft: string, editing: boolean): string {
  if (editing) {
    return `
      <div class="rename">
        <input id="${CHIP.input}" value="${escape(draft)}"
               placeholder="Your name" autocomplete="off" />
        <button id="${CHIP.save}" class="chip-go">Save</button>
        <button id="${CHIP.cancel}" class="link">Cancel</button>
      </div>`;
  }
  return `
    <button id="${CHIP.open}" class="namechip">
      🐾 <span class="chip-name">${escape(name)}</span>
      <span class="pen">rename</span>
    </button>`;
}

/** Hold an input to what a name may be, as it is typed. Structurally typed, so
 * shared stays free of the DOM for the Worker's sake. Rewritten only when it
 * changed, or the caret jumps to the end on every keystroke. */
export function clampName(input: { value: string }) {
  const next = nameDraft(input.value);
  if (next !== input.value) input.value = next;
}

