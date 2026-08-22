// Figma's NATIVE clipboard -> GoombaLevel. Plain Ctrl+C in Figma, Ctrl+V here.
//
// This is the good path, and the reason is that it reads the same numbers the
// Figma file holds rather than the ones its SVG exporter prints:
//
//   * layer names always survive (SVG only carries them when the `id` attribute
//     is switched on, and that flag is unreachable from Copy as SVG);
//   * a Line arrives as x 180, y 220, width 356.93 — its stored geometry — so
//     the half-stroke correction figma-svg.js has to make simply does not exist;
//   * an instance carries its own transform and size, so its centre is exact
//     and the `anchor` dots are not needed at all.
//
// HOW THE PAYLOAD IS SHAPED
// Ctrl+C puts HTML on the clipboard holding two comment-wrapped base64 blobs:
//   <span data-metadata="<!--(figmeta)…-->"></span>
//   <span data-buffer="<!--(figma)…-->"></span>
// The second decodes to a `fig-kiwi` container:
//   "fig-kiwi" magic (8 bytes) | uint32 version | then repeated:
//   uint32 byteLength | that many bytes of RAW DEFLATE
// Block 0 is a binary Kiwi SCHEMA, block 1 is the message. Because the schema
// travels with the data, `kiwi-schema` can decode the message generically —
// there is no hand-rolled varint or float reader in here, and no private
// schema to keep in step with Figma.
//
// It is still an undocumented format. Everything below fails loudly rather than
// guessing, and a pasted level is still only proposed until `verify.mjs --hash`
// has had it.
import { decodeBinarySchema, compileSchema } from "kiwi-schema";
import { stitchTerrain } from "./stitch.js";

const S = 10; // px per world unit
const ROUND = (v) => Math.round(v * 10) / 10; // tenths: the codec's precision

/** Does this clipboard HTML hold a Figma payload at all? */
export const hasFigmaBuffer = (html) =>
  typeof html === "string" && html.includes("data-buffer") && html.includes("(figma)");

/**
 * Pull the base64 payload out of the clipboard HTML.
 *
 * Do NOT regex this out of the raw markup. The attribute is HTML, so how its
 * `<!--` and `-->` survive depends on who serialised it, and a real Figma copy
 * showed up with a buffer this could not read even though the marker was right
 * there. So: let a parser decode the attribute, then slice between the two
 * `(figma)` sentinels rather than trying to match the wrapper, and accept
 * base64url as well as standard base64 — `-` and `_` never appear in standard
 * base64, so translating them is safe once the `--` of the comment wrapper is
 * already gone.
 */
function extractBuffer(html) {
  let raw = null;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const el = doc.querySelector("[data-buffer]");
    if (el) raw = el.getAttribute("data-buffer");
  } catch {
    /* fall through to the text scan */
  }
  if (!raw) {
    const m = /data-buffer\s*=\s*"([^"]*)"/.exec(html) || /data-buffer\s*=\s*'([^']*)'/.exec(html);
    if (m) raw = m[1];
  }
  if (!raw) throw new Error("this clipboard mentions a Figma buffer but carries no data-buffer attribute");

  const open = raw.indexOf("(figma)");
  if (open < 0)
    throw new Error(
      `found the Figma buffer but not its opening (figma) marker — it began "${raw.slice(0, 40)}"`,
    );
  // The payload closes with `(/figma)`, not a second `(figma)` — measured on a
  // real copy, whose buffer began `<!--(figma)ZmlnLWtpd2l…` ("fig-kiwi") and
  // had no second opening sentinel at all. Accept either form, and tolerate a
  // missing one by just trimming the comment tail, since the sanitiser below
  // would otherwise fold the letters of "figma" into the base64.
  const rest = raw.slice(open + "(figma)".length);
  const close = rest.search(/\(\/?figma\)/);
  const inner = close >= 0 ? rest.slice(0, close) : rest.replace(/--\s*(?:>|&gt;)\s*$/, "");
  const b64 = inner.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/=]/g, "");
  if (b64.length < 32)
    throw new Error(`the Figma buffer decoded to only ${b64.length} base64 chars`);
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch (err) {
    throw new Error(`the Figma buffer is not valid base64 (${b64.length} chars): ${err.message}`);
  }
}

/**
 * The two blocks are not compressed the same way, which is the thing that took
 * longest to find. Measured on a real copy (container version 106): the SCHEMA
 * block is raw deflate, and the MESSAGE block is ZSTANDARD — it begins with
 * zstd's `28 b5 2f fd` magic, which is why inflating it produced "invalid
 * stored block lengths" while the schema beside it inflated perfectly.
 *
 * So pick by magic rather than by position, and never assume both are alike.
 * Chrome has no `DecompressionStream("zstd")` (checked on 151), hence fzstd.
 */
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const isZstd = (b) => ZSTD_MAGIC.every((v, i) => b[i] === v);

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompress(bytes, which) {
  if (isZstd(bytes)) {
    const { decompress: unzstd } = await import("fzstd");
    return unzstd(bytes);
  }
  try {
    return await inflateRaw(bytes);
  } catch (err) {
    throw new Error(
      `could not decompress the ${which} block — it is neither zstd nor raw deflate ` +
      `(begins ${[...bytes.slice(0, 4)].map((v) => v.toString(16).padStart(2, "0")).join(" ")}): ${err.message}`,
    );
  }
}

/** Split the fig-kiwi container into its blocks, each decompressed by magic. */
async function blocks(buf) {
  const magic = String.fromCharCode(...buf.slice(0, 8));
  if (magic !== "fig-kiwi") throw new Error(`not a fig-kiwi payload (magic "${magic}")`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let at = 12; // 8 magic + uint32 version
  const raw = [];
  while (at + 4 <= buf.byteLength) {
    const len = dv.getUint32(at, true);
    at += 4;
    if (!len || at + len > buf.byteLength) break;
    raw.push(buf.subarray(at, at + len));
    at += len;
  }
  if (raw.length < 2) throw new Error("the Figma payload had no schema+message pair");
  return [
    await decompress(raw[0], "schema"),
    await decompress(raw[1], "message"),
  ];
}

const gid = (g) => (g ? `${g.sessionID}:${g.localID}` : null);

/** 2x3 affine, laid out [a b tx / c d ty] — Figma's Matrix is m00…m12. */
const IDENT = [1, 0, 0, 0, 1, 0];
function mul(m, t) {
  const b = [t.m00 ?? 1, t.m01 ?? 0, t.m02 ?? 0, t.m10 ?? 0, t.m11 ?? 1, t.m12 ?? 0];
  return [
    m[0] * b[0] + m[1] * b[3], m[0] * b[1] + m[1] * b[4], m[0] * b[2] + m[1] * b[5] + m[2],
    m[3] * b[0] + m[4] * b[3], m[3] * b[1] + m[4] * b[4], m[3] * b[2] + m[4] * b[5] + m[5],
  ];
}
const apply = (m, x, y) => ({ x: m[0] * x + m[1] * y + m[2], y: m[3] * x + m[4] * y + m[5] });
const degOf = (m) => (Math.atan2(m[3], m[0]) * 180) / Math.PI;

const stripDup = (s) => String(s || "").replace(/_\d+$/, "").trim();
const KINDS = /^(watering-can|party-popper|start|goal|bumper|cushion|band|can|pop|t)\s*-?\s*(\d+)?$/i;
function classify(name) {
  const n = stripDup(name);
  if (!n || n.startsWith("_") || n.startsWith("//")) return null;
  const m = KINDS.exec(n);
  if (!m) return null;
  let kind = m[1].toLowerCase();
  if (kind === "watering-can") kind = "can";
  if (kind === "party-popper") kind = "pop";
  return { kind, num: m[2] ? Number(m[2]) : null };
}
function levelName(name) {
  const m = /^L\s*(?::|--)\s*(.+)$/.exec(String(name || "").trim());
  if (!m) return null;
  const t = m[1].trim();
  return t.includes(" ") ? t : t.replace(/-/g, " ");
}

/**
 * Turn clipboard HTML into { level, warnings }. Throws with something a
 * designer can act on.
 */
export async function levelFromFigmaClipboard(html) {
  const raw = extractBuffer(html);
  const [schemaBytes, messageBytes] = await blocks(raw);
  const codec = compileSchema(decodeBinarySchema(schemaBytes));
  if (typeof codec.decodeMessage !== "function")
    throw new Error("this Figma payload's schema has no Message type");
  const msg = codec.decodeMessage(messageBytes);
  const changes = msg.nodeChanges || [];
  // The one thing the offline test cannot cover is whether Figma still calls
  // these fields what this reader expects. If it does not, say exactly what
  // arrived instead — that turns a single paste into the whole bug report,
  // rather than a level that reads as mysteriously empty.
  if (!changes.length) {
    throw new Error(
      "decoded the Figma clipboard but found no `nodeChanges`. Top-level fields " +
      `were: ${Object.keys(msg).join(", ") || "(none)"}. Figma's schema may have moved.`,
    );
  }
  const shaped = changes.find((n) => n && n.transform && n.size);
  if (!shaped) {
    throw new Error(
      `decoded ${changes.length} node(s), but none carry both \`transform\` and \`size\`. ` +
      `The first node's fields were: ${Object.keys(changes[0] || {}).join(", ") || "(none)"}.`,
    );
  }
  // A matrix whose components are not called m00… would compose as identity and
  // pile every prop onto the origin — a wrong level rather than an error. Refuse
  // instead, and name what the matrix actually holds.
  if (typeof shaped.transform.m00 !== "number") {
    throw new Error(
      "Figma's transform is not shaped the way this reader expects: it holds " +
      `${Object.keys(shaped.transform).join(", ") || "(nothing)"} instead of m00…m12.`,
    );
  }

  const byGuid = new Map();
  for (const n of changes) {
    const k = gid(n.guid);
    if (k) byGuid.set(k, n);
  }

  const warnings = [];
  const terrain = [], bands = [], cans = [], bumpers = [], cushions = [], pops = [];
  let start = null, goal = null, name = null, maxSpeed = null;

  // Children by parent, in sibling order, so `band` order matches the four
  // player colours the way it does on the canvas.
  const kids = new Map();
  for (const n of changes) {
    const p = n.parentIndex && gid(n.parentIndex.guid);
    if (!p) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
  }
  for (const list of kids.values()) {
    list.sort((a, b) => {
      const pa = a.parentIndex?.position ?? "", pb = b.parentIndex?.position ?? "";
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
  }

  // A copy carries far more than the frame you selected: the Document and Page
  // nodes, and the COMPONENT DEFINITIONS behind every instance. Those
  // definitions are named exactly like the instances — a real copy of level 1
  // yielded four cans instead of two, one of them at x 1076, which is the
  // watering-can component sitting at x 10240 over on the kit page. So walk DOWN
  // from the level frame instead of scanning every node, and stop descending at
  // anything that matches, since a component's inner art repeats its own name.
  const frameNode = changes.find((n) => levelName(n.name));
  if (frameNode) {
    const asLevel = levelName(frameNode.name);
    // "L: My Level @145" raises the speed cap, the one level field Figma has
    // nowhere else to put.
    const at = /\s*@\s*(\d+)\s*$/.exec(asLevel);
    name = at ? asLevel.slice(0, at.index).trim() : asLevel;
    if (at) maxSpeed = Number(at[1]);
  }
  const roots = frameNode
    ? [frameNode]
    // No frame in the selection: take everything sitting directly on the page.
    : changes.filter((n) => {
        const p = n.parentIndex && gid(n.parentIndex.guid);
        const parent = p && byGuid.get(p);
        return parent && /^(CANVAS|DOCUMENT)$/.test(parent.type || "");
      });
  if (!roots.length) throw new Error("could not find a level frame or any pasted nodes");

  const W = (v) => ROUND(v / S);
  const emit = (n, m) => {
    const hit = classify(n.name);
    if (!hit) return false;
    const { kind, num } = hit;
    const w = n.size?.x ?? 0, h = n.size?.y ?? 0;
    if (kind === "t" || kind === "band") {
      // A Figma line is a zero-height node: local (0,0)-(width,0) IS the
      // segment, so its stored geometry needs no correction of any kind.
      //
      // Which is exactly why anything ELSE named `t` has to be refused rather
      // than read. For a pen path or a rect, (0,0)-(width,0) is the top edge of
      // its bounding box, which can be nowhere near the shape the designer
      // drew — and it would arrive as a perfectly plausible straight segment
      // that silently changes whether the level is winnable. A named layer that
      // goes missing is a bug someone can SEE; a wrong one is not. (Same rule
      // as the SVG reader, which skips a `t` that is not a <line>.)
      if (n.type !== "LINE" || Math.abs(h) > 0.01) {
        warnings.push(
          `"${n.name}" is a ${n.type || "shape"}, not a Line — skipped. ` +
          `Draw terrain with the Line tool (L), never the pen.`,
        );
        return true;
      }
      const a = apply(m, 0, 0), b = apply(m, w, 0);
      (kind === "t" ? terrain : bands).push([[W(a.x), W(a.y)], [W(b.x), W(b.y)]]);
      return true;
    }
    const c = apply(m, w / 2, h / 2); // instance centre
    if (kind === "start") start = [W(c.x), W(c.y)];
    else if (kind === "goal") goal = [W(c.x), W(c.y)];
    else if (kind === "can") cans.push([W(c.x), W(c.y)]);
    else if (kind === "bumper") bumpers.push({ x: W(c.x), y: W(c.y) });
    else if (kind === "pop") pops.push({ x: W(c.x), y: W(c.y), deg: ROUND(degOf(m)), spd: num ?? 76 });
    else if (kind === "cushion") {
      const left = apply(m, 0, h / 2);
      cushions.push({ x: W(left.x), y: W(left.y), w: ROUND(w / S) });
    }
    return true;
  };

  const walk = (node, m, depth) => {
    if (depth > 32) return;
    for (const child of kids.get(gid(node.guid)) || []) {
      const cm = child.transform ? mul(m, child.transform) : m;
      // Stop at anything that matched: a component's inner art repeats the
      // component's own name, so descending would count every toy twice.
      if (!emit(child, cm)) walk(child, cm, depth + 1);
    }
  };
  for (const r of roots) {
    if (frameNode) {
      // The frame IS the coordinate space, so its own placement on the Figma
      // canvas is ignored and the walk starts from identity inside it.
      walk(r, IDENT, 0);
    } else {
      const rm = r.transform ? mul(IDENT, r.transform) : IDENT;
      if (!emit(r, rm)) walk(r, rm, 0);
    }
  }

  const found = terrain.length + bands.length + cans.length + bumpers.length +
    cushions.length + pops.length + (start ? 1 : 0) + (goal ? 1 : 0);
  if (!found)
    throw new Error(
      "read the Figma clipboard, but nothing in it is named for a level. " +
      "Terrain must be Lines named `t`; toys are instances of the kit.",
    );
  if (!start) throw new Error("no layer named `start` — the level has no spawn");
  if (!goal) throw new Error("no layer named `goal` — the level has no cake");
  if (!terrain.length) warnings.push("no terrain: nothing named `t`. She will just fall.");

  const level = {
    name: name || "pasted from Figma",
    budget: 4,
    start, goal,
    // One Figma Line per segment; chains of them are one surface. See stitch.js
    // — bands are deliberately NOT stitched, since two bands meeting at a point
    // are still two players' bands.
    terrain: stitchTerrain(terrain),
    cans, cushions, pops, bumpers,
    solution: bands,
  };
  if (maxSpeed) level.maxSpeed = maxSpeed;
  return { level, warnings };
}
