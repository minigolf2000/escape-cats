// "What did they just paste?" — the one resolver behind Ctrl+V in the level
// selector.
//
// This is what is left of the old /editor page. That page existed because the
// game had no way to take a level in; now the SELECTOR is the editor, so the
// only part worth keeping is the part that reads a clipboard. Two shapes
// arrive and both are accepted:
//
//   1. a plain Ctrl+C in Figma — a `fig-kiwi` payload on text/html. Real layer
//      names, stored geometry, nothing corrected on the way in.
//   2. one of our own level links — how a level comes back from `verify.mjs`
//      or from someone else's phone.
//
// There used to be a third: an exported .svg, read through the browser's SVG
// engine. It is gone. It was always the WORSE path and it was never the one
// anyone used — Figma writes layer names into SVG only when the `id` attribute
// is on, and names are the entire contract, so the route people reach for first
// ("Copy as SVG") could not work by construction. What survived it had to undo
// the exporter's half-stroke shift on every line and chase a component's
// dropped padding with `anchor` dots, both leaning on undocumented exporter
// behaviour that could drift without throwing. Ctrl+C needs none of that: it
// carries the numbers the Figma file actually holds. One reader, one contract.
//
// Nothing here is allowed to be silent. "I pressed Ctrl+V and nothing happened"
// is the one report a party cannot act on, so every path either returns a level
// or throws something a person standing at a laptop can act on.

import { decodeLevel } from "@escape-cats/shared";
import { hasFigmaBuffer, levelFromFigmaClipboard } from "./clipboard.js";

/** Does this text look like SVG? Only to say "wrong copy", never to read it. */
const looksLikeSvg = (s) => /^<(\?xml|svg)/i.test(s) || s.includes("<svg");

/** Text on the clipboard is one of our own level links, or nothing we want. */
function fromText(text) {
  const s = String(text || "").trim();
  if (!s || looksLikeSvg(s)) return null;
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
 * Read a paste into a level. Returns `{ level, warnings }`.
 * Throws with a message meant to be read out loud.
 */
export async function levelFromPaste(dt) {
  if (!dt) throw new Error("that paste carried no clipboard data at all");

  const html = dt.getData("text/html") || "";
  const text = dt.getData("text/plain") || "";

  if (hasFigmaBuffer(html)) return await levelFromFigmaClipboard(html);

  const got = fromText(text || html);
  if (got) return got;

  // The one wrong turn that actually happens: Figma's "Copy as SVG" sits right
  // next to plain Copy in the same menu, and it produces something that looks
  // like it ought to work. Name it rather than listing MIME types at someone.
  if (looksLikeSvg(String(text || html).trim()))
    throw new Error(
      "that is “Copy as SVG”, which strips every layer name — and the names are " +
        "the whole contract. Select the frame in Figma and press Ctrl+C instead.",
    );

  throw new Error(
    `that is not a Figma copy or a level link — it held: ${describe(dt)}. ` +
      `In Figma select the frame and press Ctrl+C (not Copy as SVG).`,
  );
}
