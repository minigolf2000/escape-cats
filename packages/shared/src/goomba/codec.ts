// A level packed small enough to live in a URL: `encodeLevel` writes a
// `GoombaLevel` as a base64url string for `location.hash`, `decodeLevel` reads
// it back. There is no database — a design is saved by BEING a link.
//
// Shared because the browser and the node tools must agree byte for byte.
// NEVER fork it; `tools/goomba/test-codec.mjs` is the proof.
//
// Every coordinate is quantised to TENTHS of a unit (exact for everything the
// design tools produce) and clamped to ±3276.7.
//
// Layout (little-endian; `vi` = zigzag varint, `pt` = two `vi` steps from the
// running cursor, which starts at the origin and moves to each point written):
//
//   u8    fmt          3 today; 1 and 2 still READ
//   u8    flags        bit0: a legacy per-level maxSpeed follows (never written
//                      now; still read and discarded)
//                      bit1: a frame box follows (at the tail)
//   u8    nameLen, then that many UTF-8 bytes
//   pt    start, pt goal
//   i16   maxSpeed     (only when flags bit0) — legacy, read and discarded
//   u8    nPolys,   then per poly: u8 nPts, then nPts × pt
//   u8    nCans,    then × pt
//   u8    nPops,    then × (pt, vi deg, vi spd)
//   u8    nCushions,then × (pt, vi w)
//   u8    nBumpers, then × pt
//   u8    nSolution,then × 4 coordinates — fmt 1 ONLY, read and discarded
//   pt×2  frame       (only when flags bit1) — (x0,y0) then (x1,y1)
//
// fmt 1 and 2 spell every value as a flat i16; fmt 3 as a step from the last
// value of its own kind. `deg`, `spd` and a cushion's `w` step from the
// PREVIOUS object of their kind, not from the point cursor — they are not
// positions, and a lane of identical poppers then costs a byte apiece.
//
// VERSIONING RULE: a new field rides at the TAIL behind a flag bit, so an
// older reader stops early. Anything that moves an existing byte costs a
// version — an old bundle then REFUSES the link (null, the list drops it
// visibly) rather than misreading it. There is no longer a Worker that has to
// ship first; a version bump is one deploy, and `levels.data.ts` is rewritten
// by the same build that can read it. Shorter links: compression, a denser alphabet and fitting
// terrain into arcs were all measured and all lost (README); varint steps are
// the one lever that pays, and only a level drawn wider than twice the world
// can make them lose.
//
// `bounds` is NOT carried (derived by initLevel) and neither is a band budget
// (the room's MAX_BANDS is the only one).
import type { GoombaLevel, Pt } from "./levels";

/** What `encodeLevel` writes. `decodeLevel` also accepts 1 and 2. */
const LEVEL_CODEC_FMT = 3;
/** The version that carried a baked `solution`, still read for old links. */
const FMT_WITH_SOLUTION = 1;
/** The last version that spent a flat i16 on every coordinate (1 and 2 both
 * did) — the boundary the reader branches on. */
const FMT_FLAT_I16 = 2;

/** Fixed-point scale: tenths of a unit. */
const FP = 10;

class Writer {
  bytes: number[] = [];
  /** Where the last point landed, in tenths. Writer and reader must walk the
   * level in exactly the same order. */
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
  /** A signed step, zigzagged so a small negative step is as cheap as a
   * positive one. */
  vi(n: number): void {
    this.vu(((n << 1) ^ (n >> 31)) >>> 0);
  }
  /** A world coordinate, quantised to a tenth and clamped — the only place the
   * scale is applied on the way out. */
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
  /** Length-prefixed collection. Counts are u8; more than 255 THROWS rather
   * than truncating, because silently dropped geometry is a different level. */
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
  /** Every read is bounds-checked, so a truncated hash fails as `null`. */
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
  /** LEB128 back. A varint wider than any step this format can hold is
   * corruption: fail the read instead of spinning. */
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
  // bit0 (legacy per-level maxSpeed) is never written; bit1 says a frame box
  // is at the tail. `frame` is authored and must survive the trip; `bounds`
  // is derived and must NOT be carried.
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

  // `deg` and `spd` step from their own cursors, not the point cursor.
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
 * one (truncated, a future format, an unrelated fragment) — the caller's
 * fallback beats half a level. Accepts a bare payload, `#payload`, or a whole
 * share URL.
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

  // The one thing the versions disagree on — flat i16, or a varint step —
  // decided once; every field below reads through these.
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
  // Legacy per-level maxSpeed: consumed so the bytes after it stay aligned,
  // then discarded — MAX_SPEED is the only cap.
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

  // Read into locals in wire order: these calls MOVE the reader, so their
  // order is the layout.
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

  // fmt 1's baked solution: consumed and discarded so the frame after it reads
  // from the right offset.
  if (fmt === FMT_WITH_SOLUTION) {
    const nSol = r.u8();
    for (let i = 0; i < nSol; i++) {
      pt();
      pt();
    }
  }

  // Read BEFORE the `ok` test, so a link that claims a frame and ends early
  // fails as `null` like any other truncation.
  let frame: GoombaLevel["frame"];
  if (flags & 2) {
    const [x0, y0] = pt();
    const [x1, y1] = pt();
    frame = { x0, y0, x1, y1 };
  }

  // Any short read above tripped `ok`. A level needs SOMETHING to interact
  // with — furniture of any kind, not terrain specifically: a level can be all
  // poppers with the players' bands as its only surfaces.
  if (!r.ok || !(terrain.length || pops.length || cushions.length || bumpers.length))
    return null;

  // Attached only when present, never as an explicit `undefined`: the tests
  // (test-codec.mjs, figma/test-real-copy.mjs) compare against literals.
  const L: GoombaLevel = { name, start, goal, terrain, cans, cushions, pops, bumpers };
  if (frame) L.frame = frame;
  return L;
}
