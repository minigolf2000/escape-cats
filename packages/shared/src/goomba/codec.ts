// A level, packed small enough to live in a URL.
//
// The level editor (the game's own level selector, behind `\`) has no database: a
// design is saved by BEING a link, exactly the trade qr-studio makes for its
// drawings. So this file is the save format — encode a `GoombaLevel` to a
// base64url string that rides in `location.hash`, decode it back.
//
// It lives in shared/ rather than in the app because three very different
// programs have to agree on it byte for byte: the browser writes the link, the
// lobby Durable Object validates it by DECODING, and the node tools read it. A
// second copy of the format would break that the first time one side gained a
// field — which has now happened once (`frame`), so the rule is not theoretical.
// `tools/goomba/test-codec.mjs` is the proof.
//
// Layout (little-endian; every coordinate is a signed 16-bit value in TENTHS
// of a world unit, so ±3276.7 at 0.1 precision). Tenths rather than a binary
// fraction because that is the precision the level data actually uses: terrain
// is drawn on halves, and a band endpoint carries one decimal — a binary scale
// quantises those and moves a placement by a hundredth of a unit for no reason.
// At tenths a level round-trips byte-identical.
//
//   u8    fmt          2 today; 1 still READS (see below)
//   u8    flags        bit0: a legacy per-level maxSpeed follows (never written
//                      now; still READ, see below)
//                      bit1: a frame box follows (see the tail)
//   u8    nameLen, then that many UTF-8 bytes
//   i16×2 start, i16×2 goal
//   i16   maxSpeed     (only when flags bit0) — legacy, read and discarded
//   u8    nPolys,   then per poly: u8 nPts, then nPts × i16×2
//   u8    nCans,    then × i16×2
//   u8    nPops,    then × i16×4  (x, y, deg, spd)
//   u8    nCushions,then × i16×3  (x, y, w)
//   u8    nBumpers, then × i16×2
//   u8    nSolution,then × i16×4  — **fmt 1 ONLY**, read and discarded
//   i16×4 frame       (only when flags bit1) — x0, y0, x1, y1
//
// **Why the version went to 2.** A level used to carry `solution`, a baked
// answer key: the band set a designer swore by, which the design bench graded
// against. The bench and the gate it served are deleted, nothing has produced a
// solution since Figma frames stopped carrying `band` layers, and so the field
// was bytes describing a concept the game no longer has.
//
// It could not leave the way `frame` arrived, behind a flag. `frame` rides at
// the TAIL and is OPTIONAL, so every offset before it is untouched and an older
// reader just stops early. `nSolution` sits in the MIDDLE and is unconditional —
// every link ever written has that byte — so dropping it moves every byte after
// it. There is no flag that fixes that, because an old link has no flag bit set
// to say "I have one": it simply does.
//
// So the version does the work, and it buys the one property worth having: an
// old reader meeting a fmt-2 link REFUSES it (`fmt !== 2` → null → the pack
// drops that entry, visibly) instead of reading the frame's first byte as a
// band count and handing back a level made of garbage. A missing level is a bug
// someone can see. Meanwhile every fmt-1 link ever written still decodes here,
// exactly, minus a field nothing reads.
//
// **This makes a new link unreadable by an older bundle**, which is the one
// thing this format had never done before. Ship the Worker first (see CLAUDE.md,
// "Deploy order"); during the window an old phone drops a newly-pasted level
// rather than misreading it.
//
// `budget` is not carried either: the room gives out `MAX_BANDS` and a save
// format that could disagree with it would be a way to smuggle a different
// number into a party.
import type { GoombaLevel, Pt } from "./levels";

/** What `encodeLevel` writes. `decodeLevel` also accepts 1 — see the header. */
const LEVEL_CODEC_FMT = 2;
/** The version that carried a baked `solution`, still read for old links. */
const FMT_WITH_SOLUTION = 1;

/** Fixed-point scale: tenths of a unit. Exact for every coordinate the design
 * tools produce, and ±3276.7 is far more world than a portrait level uses. */
const FP = 10;

class Writer {
  bytes: number[] = [];
  u8(v: number): void {
    this.bytes.push(v & 255);
  }
  /** A world coordinate, quantised to a tenth and clamped to the i16 range. */
  fx(v: number): void {
    const q = Math.max(-32768, Math.min(32767, Math.round(v * FP)));
    this.bytes.push(q & 255, (q >> 8) & 255);
  }
  pt(p: Pt): void {
    this.fx(p[0]);
    this.fx(p[1]);
  }
  /** Length-prefixed collection. Counts are u8, so 255 of anything is the
   * cap — far past what a portrait level can hold. Exceeding it THROWS rather
   * than truncating: this is the format boundary, and a link that silently
   * dropped geometry would be a different level everywhere it was opened. */
  count(n: number): number {
    if (n > 255) throw new Error(`level too detailed to encode (${n} of something, max 255)`);
    this.u8(n);
    return n;
  }
}

class Reader {
  o = 0;
  ok = true;
  constructor(readonly b: Uint8Array) {}
  /** Every read goes through the bounds check, so a truncated or corrupted
   * hash fails as `null` rather than as a level made of NaN. */
  need(n: number): boolean {
    if (this.o + n > this.b.length) this.ok = false;
    return this.ok;
  }
  u8(): number {
    if (!this.need(1)) return 0;
    return this.b[this.o++];
  }
  fx(): number {
    if (!this.need(2)) return 0;
    const lo = this.b[this.o++],
      hi = this.b[this.o++];
    const raw = lo | (hi << 8);
    return ((raw << 16) >> 16) / FP; // sign-extend the 16-bit value
  }
  pt(): Pt {
    return [this.fx(), this.fx()];
  }
}

const b64urlEncode = (u8: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64urlDecode = (str: string): Uint8Array => {
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};

/** Pack a level into the base64url payload that goes after the `#`. */
export function encodeLevel(L: GoombaLevel): string {
  const w = new Writer();
  w.u8(LEVEL_CODEC_FMT);
  // flags bit0 used to mean "a per-level maxSpeed follows". Speed is one game
  // constant now (MAX_SPEED in levels.ts), so nothing sets it any more — but
  // the bit keeps its meaning on the way IN, because links written before this
  // are sitting in live lobby packs.
  //
  // bit1 says a frame box is at the tail. `bounds` is NOT carried and must not
  // be: it is derived, and a link that could disagree with initLevel would be
  // two answers to where the world ends. `frame` is authored — it is the box
  // somebody drew in — so it is the half that has to survive the trip.
  const frame = L.frame;
  w.u8(frame ? 2 : 0);

  const name = new TextEncoder().encode(L.name ?? "");
  const nameLen = Math.min(255, name.length);
  w.u8(nameLen);
  for (let i = 0; i < nameLen; i++) w.u8(name[i]);

  w.pt(L.start);
  w.pt(L.goal);

  const polys = L.terrain ?? [];
  const nPolys = w.count(polys.length);
  for (let i = 0; i < nPolys; i++) {
    const pts = polys[i];
    const n = w.count(pts.length);
    for (let j = 0; j < n; j++) w.pt(pts[j]);
  }

  const cans = L.cans ?? [];
  const nCans = w.count(cans.length);
  for (let i = 0; i < nCans; i++) w.pt(cans[i]);

  const pops = L.pops ?? [];
  const nPops = w.count(pops.length);
  for (let i = 0; i < nPops; i++) {
    const p = pops[i];
    w.fx(p.x);
    w.fx(p.y);
    w.fx(p.deg);
    w.fx(p.spd);
  }

  const cush = L.cushions ?? [];
  const nCush = w.count(cush.length);
  for (let i = 0; i < nCush; i++) {
    const c = cush[i];
    w.fx(c.x);
    w.fx(c.y);
    w.fx(c.w);
  }

  const bumps = L.bumpers ?? [];
  const nBumps = w.count(bumps.length);
  for (let i = 0; i < nBumps; i++) {
    w.fx(bumps[i].x);
    w.fx(bumps[i].y);
  }

  if (frame) {
    w.fx(frame.x0);
    w.fx(frame.y0);
    w.fx(frame.x1);
    w.fx(frame.y1);
  }

  return b64urlEncode(Uint8Array.from(w.bytes));
}

/**
 * Unpack a payload back into a level. Returns `null` for anything that isn't
 * one — a truncated hash, a future format, someone's unrelated fragment —
 * because the caller's fallback (boot an empty level, or exit non-zero) is
 * always better than half a level made of garbage coordinates.
 *
 * Accepts a bare payload, a `#payload`, or a whole share URL, so a designer
 * can paste whatever their browser gave them.
 */
export function decodeLevel(input: string): GoombaLevel | null {
  const hash = input.includes("#") ? input.slice(input.lastIndexOf("#") + 1) : input;
  const payload = hash.trim();
  if (!payload) return null;

  let bytes: Uint8Array;
  try {
    bytes = b64urlDecode(payload);
  } catch {
    return null;
  }

  const r = new Reader(bytes);
  const fmt = r.u8();
  if (fmt !== LEVEL_CODEC_FMT && fmt !== FMT_WITH_SOLUTION) return null;
  const flags = r.u8();

  const nameLen = r.u8();
  if (!r.need(nameLen)) return null;
  const name = new TextDecoder().decode(bytes.slice(r.o, r.o + nameLen));
  r.o += nameLen;

  const start = r.pt();
  const goal = r.pt();
  // A link from before speed became one constant carries its level's own cap
  // here. Read it — the bytes have to be consumed either way or everything
  // after them shifts — then drop it on the floor: MAX_SPEED is the only cap
  // now, and honouring an old one would leave two levels in the same pack
  // running different physics.
  if (flags & 1) r.fx();

  const terrain: Pt[][] = [];
  const nPolys = r.u8();
  for (let i = 0; i < nPolys; i++) {
    const n = r.u8();
    const pts: Pt[] = [];
    for (let j = 0; j < n; j++) pts.push(r.pt());
    terrain.push(pts);
  }

  const cans: Pt[] = [];
  const nCans = r.u8();
  for (let i = 0; i < nCans; i++) cans.push(r.pt());

  const pops = [];
  const nPops = r.u8();
  for (let i = 0; i < nPops; i++)
    pops.push({ x: r.fx(), y: r.fx(), deg: r.fx(), spd: r.fx() });

  const cushions = [];
  const nCush = r.u8();
  for (let i = 0; i < nCush; i++)
    cushions.push({ x: r.fx(), y: r.fx(), w: r.fx() });

  const bumpers = [];
  const nBumps = r.u8();
  for (let i = 0; i < nBumps; i++) bumpers.push({ x: r.fx(), y: r.fx() });

  // fmt 1 carried a baked solution here. Consume it and throw it away — the
  // bytes have to be read either way or the frame after them is read from the
  // wrong offset, which is the whole reason this costs a version.
  if (fmt === FMT_WITH_SOLUTION) {
    const nSol = r.u8();
    for (let i = 0; i < nSol; i++) {
      r.pt();
      r.pt();
    }
  }

  // The frame the level was drawn in, if the writer had one. Read it BEFORE the
  // `ok` test below, so a link that claims a frame and then ends early fails as
  // `null` like any other truncation rather than quietly losing its padding.
  let frame: GoombaLevel["frame"];
  if (flags & 2) frame = { x0: r.fx(), y0: r.fx(), x1: r.fx(), y1: r.fx() };

  // Only now: any short read anywhere above tripped `ok`, and a level needs
  // SOMETHING to interact with — terrain, poppers, cushions or bumpers. That
  // second test is the cheapest filter there is against a stray fragment that
  // happened to decode without erroring, which is the whole reason it exists.
  //
  // It used to demand a polyline ("a level needs at least one to be simulable
  // at all"), which was true right up until Cat's Cradle: no terrain at all,
  // twelve poppers and the players' four bands as the only surfaces in the
  // world. A level like that is perfectly simulable, and refusing to decode it
  // meant the one shipped level that a share link could not carry — so the
  // rule is furniture of any kind, not terrain specifically.
  if (!r.ok || !(terrain.length || pops.length || cushions.length || bumpers.length))
    return null;

  // `frame` is attached only when there was one, rather than left sitting as an
  // explicit `undefined`: a decoded level is compared against a literal in both
  // benches, and a key that exists holding nothing is not equal to no key.
  const L: GoombaLevel = { name, start, goal, terrain, cans, cushions, pops, bumpers };
  if (frame) L.frame = frame;
  return L;
}
