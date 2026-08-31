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
// Every coordinate is quantised to TENTHS of a world unit and clamped to
// ±3276.7. Tenths rather than a binary fraction because that is the precision
// the level data actually uses: terrain is drawn on halves, and the Figma
// bridge rounds to one decimal — a binary scale quantises those and moves a
// placement by a hundredth of a unit for no reason. At tenths a level
// round-trips byte-identical.
//
// What CHANGES with the version is how a quantised value is spelled. fmt 1 and
// 2 spend a flat i16 on every one. fmt 3 spends a zigzag varint on the STEP
// from the last point written, because a level is a WALK: consecutive vertices
// of a polyline are a few units apart, and a step of a few units fits in one
// byte where an absolute position never does. Measured on `The Long Way Up`,
// 66 of its 92 terrain values fit in a byte, and the link goes 355 chars → 263.
//
// Layout (little-endian; `vi` = zigzag varint, `pt` = two `vi` steps from the
// running cursor, which starts at the origin and moves to each point written):
//
//   u8    fmt          3 today; 1 and 2 still READ (see below)
//   u8    flags        bit0: a legacy per-level maxSpeed follows (never written
//                      now; still READ, see below)
//                      bit1: a frame box follows (see the tail)
//   u8    nameLen, then that many UTF-8 bytes
//   pt    start, pt goal
//   i16   maxSpeed     (only when flags bit0) — legacy, read and discarded
//   u8    nPolys,   then per poly: u8 nPts, then nPts × pt
//   u8    nCans,    then × pt
//   u8    nPops,    then × (pt, vi deg, vi spd)
//   u8    nCushions,then × (pt, vi w)
//   u8    nBumpers, then × pt
//   u8    nSolution,then × 4 coordinates — **fmt 1 ONLY**, read and discarded
//   pt×2  frame       (only when flags bit1) — (x0,y0) then (x1,y1)
//
// `deg`, `spd` and a cushion's `w` step from the PREVIOUS object of their own
// kind rather than from the point cursor — they are not positions and sharing
// one cursor with them would make every step huge. A lane of identical poppers
// then costs a byte apiece for its aim instead of four.
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
// **Why the version went to 3.** Links were long — a real level runs 350-450
// characters — and the fat was never the fields, it was the flat i16. The
// levels were measured first and the shape of the saving is worth writing down,
// because the obvious alternatives were all tried and all lost:
//
//   * COMPRESSING the packed bytes (deflate, brotli) bought 1-10%: this payload
//     is dense binary with no repetition for LZ77 to quote.
//   * A denser ALPHABET than base64url (the ~80 characters legal in a fragment)
//     bought 5%, and spent the property that a link survives being pasted
//     through a chat client — `+ , ; = ' ( )` are exactly what gets mangled.
//   * Re-encoding terrain SEMANTICALLY — arcs, repeats, anything fitted — is
//     the tempting one and it is a trap. Checked on a real level: not one of
//     its 40 interior vertices is redundant even at 0.3u of tolerance. Every
//     vertex is a corner somebody drew, and a fit that moved one would be
//     geometry changing silently, which is the bug this repo keeps catching.
//
// Varint deltas are the only lever that pays, and like `solution` leaving, it
// moves every byte after the name — so it costs the version rather than a flag.
// fmt 3's own body is otherwise field-for-field what fmt 2's was: the reader
// below is ONE pass with the coordinate spelling chosen at the top, not two
// parsers that have to be kept in step.
//
// **What it actually saves depends on how LONG the chains are**, and that is
// the honest way to read the number. A step is cheap; arriving at a new
// polyline is a jump across the level and costs what an absolute pair cost. So
// `The Long Way Up` (3 polylines, 46 vertices) goes 355 chars → 263, while the
// teaching level (5 polylines, 12 vertices — barely any chain to walk) goes 143
// → 139. That is the right way round: the links people call long are the
// vertex-heavy ones, and those are exactly where a step beats a position.
//
// The floor is worth knowing too. A step only costs MORE than an i16 once it
// crosses ~6553 units, which is twice the world — so fmt 3 can lose, but only
// to a level drawn outside anywhere the camera goes. The `Every Step Size`
// fixture in test-codec.mjs is built to do exactly that and comes out 1% bigger.
// A real level cannot reach it, which is why there is one writer and not a
// pick-the-smaller-of-two.
//
// `budget` is not carried either: the room gives out `MAX_BANDS` and a save
// format that could disagree with it would be a way to smuggle a different
// number into a party.
import type { GoombaLevel, Pt } from "./levels";

/** What `encodeLevel` writes. `decodeLevel` also accepts 1 and 2 — see the
 * header. */
const LEVEL_CODEC_FMT = 3;
/** The version that carried a baked `solution`, still read for old links. */
const FMT_WITH_SOLUTION = 1;
/** The last version that spent a flat i16 on every coordinate. Both older
 * versions did, so this is the boundary the reader branches on, not a list. */
const FMT_FLAT_I16 = 2;

/** Fixed-point scale: tenths of a unit. Exact for every coordinate the design
 * tools produce, and ±3276.7 is far more world than a portrait level uses. */
const FP = 10;

class Writer {
  bytes: number[] = [];
  /** Where the last point landed, in tenths. Every coordinate is written as
   * its step from here, so the writer and the reader have to walk the level in
   * exactly the same order — which is why there is one pass, not two. */
  cx = 0;
  cy = 0;
  u8(v: number): void {
    this.bytes.push(v & 255);
  }
  /** Unsigned LEB128: seven bits a byte, the high bit saying another follows. */
  vu(v: number): void {
    let n = v >>> 0;
    while (n > 127) {
      this.bytes.push((n & 127) | 128);
      n >>>= 7;
    }
    this.bytes.push(n);
  }
  /** A signed step, zigzagged so a small move left costs what a small move
   * right does — two's complement would spend all five bytes on -1. */
  vi(n: number): void {
    this.vu(((n << 1) ^ (n >> 31)) >>> 0);
  }
  /** A world coordinate, quantised to a tenth and clamped. The clamp lives
   * here rather than at each call site because the range the format promises
   * must not depend on which field is being written. There is no absolute
   * WRITER any more — fmt 3 spells every coordinate as a step — so this is the
   * only place the scale is applied on the way out. */
  q(v: number): number {
    return Math.max(-32768, Math.min(32767, Math.round(v * FP)));
  }
  /** A value written as its step from `prev` (both in tenths). Returns the new
   * `prev`, so the caller carries whichever cursor this value belongs to. */
  dv(v: number, prev: number): number {
    const q = this.q(v);
    this.vi(q - prev);
    return q;
  }
  /** A point, as its step from the last point written. */
  dpt(p: Pt): void {
    this.cx = this.dv(p[0], this.cx);
    this.cy = this.dv(p[1], this.cy);
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
  /** The writer's LEB128, back. A varint longer than the widest step this
   * format can hold is corruption rather than a big number, so it fails the
   * read instead of spinning to the end of the buffer. */
  vu(): number {
    let out = 0,
      shift = 0;
    for (;;) {
      if (!this.need(1)) return 0;
      const b = this.b[this.o++];
      out += (b & 127) * 2 ** shift;
      if (!(b & 128)) return out;
      shift += 7;
      if (shift > 21) {
        this.ok = false;
        return 0;
      }
    }
  }
  vi(): number {
    const u = this.vu();
    return (u >>> 1) ^ -(u & 1);
  }
  /** The step back onto `prev` (both in tenths); returns the new `prev`. */
  dv(prev: number): number {
    return prev + this.vi();
  }
  cx = 0;
  cy = 0;
  dpt(): Pt {
    this.cx = this.dv(this.cx);
    this.cy = this.dv(this.cy);
    return [this.cx / FP, this.cy / FP];
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

  w.dpt(L.start);
  w.dpt(L.goal);

  const polys = L.terrain ?? [];
  const nPolys = w.count(polys.length);
  for (let i = 0; i < nPolys; i++) {
    const pts = polys[i];
    const n = w.count(pts.length);
    for (let j = 0; j < n; j++) w.dpt(pts[j]);
  }

  const cans = L.cans ?? [];
  const nCans = w.count(cans.length);
  for (let i = 0; i < nCans; i++) w.dpt(cans[i]);

  // `deg` and `spd` carry their own cursors: they are not positions, and
  // stepping them off the point cursor would price every popper at its
  // distance from the last vertex. Off their own, a lane of poppers aimed and
  // thrown alike costs one byte each.
  const pops = L.pops ?? [];
  const nPops = w.count(pops.length);
  let pdeg = 0,
    pspd = 0;
  for (let i = 0; i < nPops; i++) {
    const p = pops[i];
    w.dpt([p.x, p.y]);
    pdeg = w.dv(p.deg, pdeg);
    pspd = w.dv(p.spd, pspd);
  }

  const cush = L.cushions ?? [];
  const nCush = w.count(cush.length);
  let pw = 0;
  for (let i = 0; i < nCush; i++) {
    const c = cush[i];
    w.dpt([c.x, c.y]);
    pw = w.dv(c.w, pw);
  }

  const bumps = L.bumpers ?? [];
  const nBumps = w.count(bumps.length);
  for (let i = 0; i < nBumps; i++) w.dpt([bumps[i].x, bumps[i].y]);

  if (frame) {
    w.dpt([frame.x0, frame.y0]);
    w.dpt([frame.x1, frame.y1]);
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
  if (fmt !== LEVEL_CODEC_FMT && fmt !== FMT_FLAT_I16 && fmt !== FMT_WITH_SOLUTION) return null;
  const flags = r.u8();

  // The one thing the versions disagree about, decided once here: a flat i16
  // per value, or a varint step from the running cursor. Every field below is
  // read through these, so the layout is written down once no matter which
  // spelling a link arrived in.
  const flat = fmt <= FMT_FLAT_I16;
  const pt = (): Pt => (flat ? r.pt() : r.dpt());
  let pdeg = 0,
    pspd = 0,
    pw = 0;
  const deg = (): number => (flat ? r.fx() : (pdeg = r.dv(pdeg)) / FP);
  const spd = (): number => (flat ? r.fx() : (pspd = r.dv(pspd)) / FP);
  const wid = (): number => (flat ? r.fx() : (pw = r.dv(pw)) / FP);

  const nameLen = r.u8();
  if (!r.need(nameLen)) return null;
  const name = new TextDecoder().decode(bytes.slice(r.o, r.o + nameLen));
  r.o += nameLen;

  const start = pt();
  const goal = pt();
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
    for (let j = 0; j < n; j++) pts.push(pt());
    terrain.push(pts);
  }

  const cans: Pt[] = [];
  const nCans = r.u8();
  for (let i = 0; i < nCans; i++) cans.push(pt());

  // Read into locals first, in wire order. These calls all MOVE the reader, so
  // the order they happen in is the layout — not something to leave implied by
  // where a value lands in an object literal.
  const pops = [];
  const nPops = r.u8();
  for (let i = 0; i < nPops; i++) {
    const [x, y] = pt();
    const d = deg();
    const v = spd();
    pops.push({ x, y, deg: d, spd: v });
  }

  const cushions = [];
  const nCush = r.u8();
  for (let i = 0; i < nCush; i++) {
    const [x, y] = pt();
    cushions.push({ x, y, w: wid() });
  }

  const bumpers = [];
  const nBumps = r.u8();
  for (let i = 0; i < nBumps; i++) {
    const [x, y] = pt();
    bumpers.push({ x, y });
  }

  // fmt 1 carried a baked solution here. Consume it and throw it away — the
  // bytes have to be read either way or the frame after them is read from the
  // wrong offset, which is the whole reason this costs a version.
  if (fmt === FMT_WITH_SOLUTION) {
    const nSol = r.u8();
    for (let i = 0; i < nSol; i++) {
      pt();
      pt();
    }
  }

  // The frame the level was drawn in, if the writer had one. Read it BEFORE the
  // `ok` test below, so a link that claims a frame and then ends early fails as
  // `null` like any other truncation rather than quietly losing its padding.
  let frame: GoombaLevel["frame"];
  if (flags & 2) {
    const [x0, y0] = pt();
    const [x1, y1] = pt();
    frame = { x0, y0, x1, y1 };
  }

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
  // explicit `undefined`: a decoded level is compared against a literal in the
  // tests (test-codec.mjs, figma/test-real-copy.mjs), and a key that exists
  // holding nothing is not equal to no key.
  const L: GoombaLevel = { name, start, goal, terrain, cans, cushions, pops, bumpers };
  if (frame) L.frame = frame;
  return L;
}
