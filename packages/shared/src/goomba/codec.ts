// A level, packed small enough to live in a URL.
//
// The level editor (apps/goomba-editor) has no server and no database: a
// design is saved by BEING a link, exactly the trade qr-studio makes for its
// drawings. So this file is the save format — encode a `GoombaLevel` to a
// base64url string that rides in `location.hash`, decode it back.
//
// It lives in shared/ rather than in the editor because two very different
// programs have to agree on it byte for byte: the browser editor writes the
// link, and `tools/goomba/verify.mjs` reads it to run THE GATE on a level that
// never entered `levels.ts`. That handoff — designer shares a link, the bench
// verifies it — is the whole point, and a second copy of the format would
// break it the first time one side gained a field.
//
// Layout (little-endian; every coordinate is a signed 16-bit value in TENTHS
// of a world unit, so ±3276.7 at 0.1 precision). Tenths rather than a binary
// fraction because that is the precision the level data actually uses: terrain
// is drawn on halves, and the band endpoints that `scan.mjs`/`solve.mjs` hand
// back carry one decimal — a binary scale quantises those and moves a shipped
// solution by a hundredth of a unit for no reason. At tenths every level in
// `levels.ts` round-trips byte-identical.
//
//   u8    fmt = 1
//   u8    flags        bit0: maxSpeed present
//   u8    nameLen, then that many UTF-8 bytes
//   i16×2 start, i16×2 goal
//   i16   maxSpeed     (only when flags bit0)
//   u8    nPolys,   then per poly: u8 nPts, then nPts × i16×2
//   u8    nCans,    then × i16×2
//   u8    nPops,    then × i16×4  (x, y, deg, spd)
//   u8    nCushions,then × i16×3  (x, y, w)
//   u8    nBumpers, then × i16×2
//   u8    nSolution,then × i16×4  (ax, ay, bx, by)
//
// `budget` is not carried: the party rule locks every level to MAX_BANDS, and
// a save format that could disagree with it would be a way to smuggle a
// 3-band level past the gate.
import type { GoombaLevel, Pt } from "./levels";

const LEVEL_CODEC_FMT = 1;

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
  const hasMax = typeof L.maxSpeed === "number";
  w.u8(LEVEL_CODEC_FMT);
  w.u8(hasMax ? 1 : 0);

  const name = new TextEncoder().encode(L.name ?? "");
  const nameLen = Math.min(255, name.length);
  w.u8(nameLen);
  for (let i = 0; i < nameLen; i++) w.u8(name[i]);

  w.pt(L.start);
  w.pt(L.goal);
  if (hasMax) w.fx(L.maxSpeed as number);

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

  const sol = L.solution ?? [];
  const nSol = w.count(sol.length);
  for (let i = 0; i < nSol; i++) {
    w.pt(sol[i][0]);
    w.pt(sol[i][1]);
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
  if (r.u8() !== LEVEL_CODEC_FMT) return null;
  const flags = r.u8();

  const nameLen = r.u8();
  if (!r.need(nameLen)) return null;
  const name = new TextDecoder().decode(bytes.slice(r.o, r.o + nameLen));
  r.o += nameLen;

  const start = r.pt();
  const goal = r.pt();
  const maxSpeed = flags & 1 ? r.fx() : undefined;

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

  const solution: [Pt, Pt][] = [];
  const nSol = r.u8();
  for (let i = 0; i < nSol; i++) solution.push([r.pt(), r.pt()]);

  // Only now: any short read anywhere above tripped `ok`, and a level needs at
  // least one polyline to be simulable at all.
  if (!r.ok || !terrain.length) return null;

  const L: GoombaLevel = { name, start, goal, terrain, cans, cushions, pops, bumpers, solution };
  if (maxSpeed !== undefined) L.maxSpeed = maxSpeed;
  return L;
}
