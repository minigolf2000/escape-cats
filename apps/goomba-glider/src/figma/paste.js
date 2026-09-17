// "What did they just paste?" — the one resolver behind Ctrl+V in the level
// selector. Two shapes arrive and both are accepted:
//
//   1. a plain Ctrl+C in Figma — a `fig-kiwi` payload on text/html.
//   2. one of our own level links — off someone else's phone or out of a pack.
//
// "Copy as SVG" is NOT read (it strips layer names, which are the contract);
// it is named in the error instead. Nothing here is allowed to be silent: every
// path returns a level or throws something a person at a laptop can act on.

import { decodeLevel } from "@escape-cats/shared";

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

  // EVERY read of `dt` happens before the first await: a DataTransfer is only
  // readable while its event is being dispatched. That includes `held`, or the
  // error at the bottom would say "(empty clipboard)" about a full one.
  const html = dt.getData("text/html") || "";
  const text = dt.getData("text/plain") || "";
  const held = describe(dt);

  // The Figma reader (kiwi, the shape readers, the stitcher, fzstd) is loaded
  // HERE, not imported at the top: only a laptop that pressed Ctrl+V can reach
  // it, and a phone would otherwise download it before the game starts.
  const figma = await import("./clipboard.js");
  if (figma.hasFigmaBuffer(html)) return await figma.levelFromFigmaClipboard(html);

  const got = fromText(text || html);
  if (got) return got;

  // The one wrong turn that actually happens: "Copy as SVG" sits next to
  // plain Copy in the same menu. Name it.
  if (looksLikeSvg(String(text || html).trim()))
    throw new Error(
      "that is “Copy as SVG”, which strips every layer name — and the names are " +
        "the whole contract. Select the frame in Figma and press Ctrl+C instead.",
    );

  throw new Error(
    `that is not a Figma copy or a level link — it held: ${held}. ` +
      `In Figma select the frame and press Ctrl+C (not Copy as SVG).`,
  );
}
