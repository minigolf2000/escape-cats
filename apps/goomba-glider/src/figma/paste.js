// "What did they just paste?" — the one resolver behind Ctrl+V in the level
// selector.
//
// This is what is left of the old /editor page. That page existed because the
// game had no way to take a level in; now the SELECTOR is the editor, so the
// only part worth keeping is the part that reads a clipboard. Three shapes
// arrive in practice and all three are accepted:
//
//   1. a plain Ctrl+C in Figma  — a `fig-kiwi` payload on text/html. The good
//      path: real layer names, stored geometry, no exporter corrections.
//   2. an exported .svg (dropped, or its text pasted) — needs the `id`
//      attribute switched on, which Copy as SVG cannot do.
//   3. one of our own level links — how a level comes back from `verify.mjs`
//      or from someone else's phone.
//
// Nothing here is allowed to be silent. "I pressed Ctrl+V and nothing happened"
// is the one report a party cannot act on, so every path either returns a level
// or throws something a person standing at a laptop can act on.

import { decodeLevel } from "@escape-cats/shared";
import { hasFigmaBuffer, levelFromFigmaClipboard } from "./clipboard.js";
import { levelFromFigmaSvg } from "./svg.js";

/** Text on the clipboard is either an SVG or one of our own level links. */
function fromText(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  if (/^<(\?xml|svg)/i.test(s) || s.includes("<svg")) return levelFromFigmaSvg(s);
  const hash = s.startsWith("#") ? s.slice(1) : s.slice(s.indexOf("#") + 1);
  const level = decodeLevel(hash || s);
  return level ? { level, warnings: [] } : null;
}

/** Everything the clipboard actually held, for the error that says so. */
function describe(dt) {
  const types = [...(dt.types || [])];
  return (
    types
      .map((t) =>
        t === "Files"
          ? `Files(${(dt.files || []).length})`
          : `${t} ${(dt.getData(t) || "").length}b`,
      )
      .join(" · ") || "(empty clipboard)"
  );
}

/**
 * Read a paste (or a drop) into a level. Returns `{ level, warnings }`.
 * Throws with a message meant to be read out loud.
 */
export async function levelFromPaste(dt) {
  if (!dt) throw new Error("that paste carried no clipboard data at all");

  const file = [...(dt.files || [])].find(
    (f) => /svg/i.test(f.type) || /\.svg$/i.test(f.name),
  );
  if (file) {
    const text = await file.text();
    const got = fromText(text);
    if (!got) throw new Error(`${file.name} did not parse as a Figma SVG`);
    return got;
  }

  const html = dt.getData("text/html") || "";
  const text = dt.getData("text/plain") || "";

  // The Figma copy first: it needs none of the SVG path's corrections.
  if (hasFigmaBuffer(html)) return await levelFromFigmaClipboard(html);

  const got = fromText(text || html);
  if (got) return got;

  throw new Error(
    `that is not a Figma copy, an SVG, or a level link — it held: ${describe(dt)}. ` +
      `In Figma select the frame and press Ctrl+C (not Copy as SVG).`,
  );
}
