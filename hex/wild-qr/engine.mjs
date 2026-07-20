// engine.mjs — QR art engine extracted VERBATIM from hex/qr-studio.html
// (script block lines 274-1583). Only the UMD wrapper was replaced with an
// ESM export; zero changes to internal logic. No browser globals are
// referenced inside the engine body, so no adaptations were needed.
export const QRArt = (() => {
  "use strict";

  // ---------------- GF(256), polynomial 0x11D ----------------
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }
  function ginv(a) {
    return EXP[255 - LOG[a]];
  }

  const GEN_CACHE = {};
  function genPoly(n) {
    if (GEN_CACHE[n]) return GEN_CACHE[n];
    let g = [1];
    for (let i = 0; i < n; i++) {
      const a = EXP[i];
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        ng[j + 1] ^= gmul(g[j], a);
      }
      g = ng;
    }
    GEN_CACHE[n] = g;
    return g;
  }

  // data: Uint8Array -> Uint8Array(ecLen) of RS check bytes
  function rsEncode(data, ecLen) {
    const gen = genPoly(ecLen);
    const res = new Uint8Array(data.length + ecLen);
    res.set(data);
    for (let i = 0; i < data.length; i++) {
      const f = res[i];
      if (f === 0) continue;
      const lf = LOG[f];
      for (let j = 1; j <= ecLen; j++) {
        if (gen[j] !== 0) res[i + j] ^= EXP[LOG[gen[j]] + lf];
      }
    }
    return res.slice(data.length);
  }

  // Correct cw (data+ec bytes) in place. Returns {errors} or null if
  // uncorrectable. Standard QR RS: roots alpha^0 .. alpha^(ecLen-1).
  function rsCorrect(cw, ecLen) {
    const n = cw.length;
    const synd = new Array(ecLen);
    let allZero = true;
    for (let i = 0; i < ecLen; i++) {
      let s = 0;
      const a = EXP[i];
      for (let j = 0; j < n; j++) s = gmul(s, a) ^ cw[j];
      synd[i] = s;
      if (s) allZero = false;
    }
    if (allZero) return { errors: 0 };

    // Berlekamp-Massey
    let C = new Uint8Array(ecLen + 1);
    let B = new Uint8Array(ecLen + 1);
    C[0] = 1;
    B[0] = 1;
    let L = 0, m = 1, b = 1;
    for (let i = 0; i < ecLen; i++) {
      let d = synd[i];
      for (let j = 1; j <= L; j++) d ^= gmul(C[j], synd[i - j]);
      if (d === 0) {
        m++;
      } else if (2 * L <= i) {
        const T = C.slice();
        const coef = gmul(d, ginv(b));
        for (let j = 0; j + m <= ecLen; j++) C[j + m] ^= gmul(coef, B[j]);
        L = i + 1 - L;
        B = T;
        b = d;
        m = 1;
      } else {
        const coef = gmul(d, ginv(b));
        for (let j = 0; j + m <= ecLen; j++) C[j + m] ^= gmul(coef, B[j]);
        m++;
      }
    }
    if (L > ecLen >> 1) return null;

    // Chien search over valid degrees
    const positions = []; // degree of erroneous term
    for (let deg = 0; deg < n; deg++) {
      const xinv = EXP[(255 - (deg % 255)) % 255]; // (alpha^deg)^-1
      let s = 0;
      let xp = 1;
      for (let j = 0; j <= L; j++) {
        s ^= gmul(C[j], xp);
        xp = gmul(xp, xinv);
      }
      if (s === 0) positions.push(deg);
    }
    if (positions.length !== L) return null;

    // Forney: omega = (synd * C) mod x^ecLen
    const omega = new Uint8Array(ecLen);
    for (let i = 0; i < ecLen; i++) {
      let s = 0;
      for (let j = 0; j <= Math.min(i, L); j++) s ^= gmul(C[j], synd[i - j]);
      omega[i] = s;
    }
    for (const deg of positions) {
      const x = EXP[deg % 255];
      const xinv = ginv(x);
      let num = 0, xp = 1;
      for (let i = 0; i < ecLen; i++) {
        num ^= gmul(omega[i], xp);
        xp = gmul(xp, xinv);
      }
      // sigma'(x^-1): odd-degree terms
      let den = 0;
      xp = 1; // xinv^0
      for (let j = 1; j <= L; j += 2) {
        den ^= gmul(C[j], xp);
        xp = gmul(xp, gmul(xinv, xinv));
      }
      if (den === 0) return null;
      const mag = gmul(x, gmul(num, ginv(den)));
      const idx = n - 1 - deg;
      if (idx < 0 || idx >= n) return null;
      cw[idx] ^= mag;
    }
    // verify
    for (let i = 0; i < ecLen; i++) {
      let s = 0;
      const a = EXP[i];
      for (let j = 0; j < n; j++) s = gmul(s, a) ^ cw[j];
      if (s !== 0) return null;
    }
    return { errors: L };
  }

  // ---------------- Tables (versions 1-10) ----------------
  // [numBlocks, totalCodewords, dataCodewords] groups, ISO/IEC 18004.
  const EC_BLOCKS = {
    1: { L: [[1, 26, 19]], M: [[1, 26, 16]], Q: [[1, 26, 13]], H: [[1, 26, 9]] },
    2: { L: [[1, 44, 34]], M: [[1, 44, 28]], Q: [[1, 44, 22]], H: [[1, 44, 16]] },
    3: { L: [[1, 70, 55]], M: [[1, 70, 44]], Q: [[2, 35, 17]], H: [[2, 35, 13]] },
    4: { L: [[1, 100, 80]], M: [[2, 50, 32]], Q: [[2, 50, 24]], H: [[4, 25, 9]] },
    5: { L: [[1, 134, 108]], M: [[2, 67, 43]], Q: [[2, 33, 15], [2, 34, 16]], H: [[2, 33, 11], [2, 34, 12]] },
    6: { L: [[2, 86, 68]], M: [[4, 43, 27]], Q: [[4, 43, 19]], H: [[4, 43, 15]] },
    7: { L: [[2, 98, 78]], M: [[4, 49, 31]], Q: [[2, 32, 14], [4, 33, 15]], H: [[4, 39, 13], [1, 40, 14]] },
    8: { L: [[2, 121, 97]], M: [[2, 60, 38], [2, 61, 39]], Q: [[4, 40, 18], [2, 41, 19]], H: [[4, 40, 14], [2, 41, 15]] },
    9: { L: [[2, 146, 116]], M: [[3, 58, 36], [2, 59, 37]], Q: [[4, 36, 16], [4, 37, 17]], H: [[4, 36, 12], [4, 37, 13]] },
    10: { L: [[2, 86, 68], [2, 87, 69]], M: [[4, 69, 43], [1, 70, 44]], Q: [[6, 43, 19], [2, 44, 20]], H: [[6, 43, 15], [2, 44, 16]] },
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };
  const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };
  const LEVELS = ["L", "M", "Q", "H"];
  const LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  function sizeOf(version) {
    return 17 + 4 * version;
  }

  // ---------------- Masks ----------------
  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (((r / 2) | 0) + ((c / 3) | 0)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r * c) % 3) + ((r + c) % 2)) % 2 === 0,
  ];

  // ---------------- BCH format / version info ----------------
  function bchDigit(d) {
    let digit = 0;
    while (d !== 0) {
      digit++;
      d >>>= 1;
    }
    return digit;
  }
  const G15 = 0x537, G15_MASK = 0x5412, G18 = 0x1f25;
  function bchTypeInfo(data) {
    let d = data << 10;
    while (bchDigit(d) - bchDigit(G15) >= 0) d ^= G15 << (bchDigit(d) - bchDigit(G15));
    return ((data << 10) | d) ^ G15_MASK;
  }
  function bchVersion(data) {
    let d = data << 12;
    while (bchDigit(d) - bchDigit(G18) >= 0) d ^= G18 << (bchDigit(d) - bchDigit(G18));
    return (data << 12) | d;
  }

  // ---------------- Function patterns & layout ----------------
  // Returns {size, func, base}: func[i]=1 where module is reserved (finders,
  // separators, timing, alignment, format, version, dark module); base holds
  // the dark/light value of those reserved modules (format filled per-mask
  // later via placeFormat).
  function functionPatterns(version) {
    const size = sizeOf(version);
    const func = new Uint8Array(size * size);
    const base = new Uint8Array(size * size);
    const set = (r, c, dark) => {
      func[r * size + c] = 1;
      base[r * size + c] = dark ? 1 : 0;
    };
    // finders + separators
    const finder = (fr, fc) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = fr + r, cc = fc + c;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
            (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
          set(rr, cc, inRing);
        }
      }
    };
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);
    // alignment (before timing: some centers sit ON the timing lines and
    // must still be drawn; skip only finder-overlapping centers)
    const pos = ALIGN[version];
    for (const r of pos) {
      for (const c of pos) {
        if (func[r * size + c]) continue; // overlaps finder area
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
          }
        }
      }
    }
    // timing
    for (let i = 8; i < size - 8; i++) {
      if (!func[6 * size + i]) set(6, i, i % 2 === 0);
      if (!func[i * size + 6]) set(i, 6, i % 2 === 0);
    }
    // format info areas (values set later) + dark module
    for (let i = 0; i < 9; i++) {
      if (i !== 6) {
        if (!func[8 * size + i]) set(8, i, 0);
        if (!func[i * size + 8]) set(i, 8, 0);
      }
    }
    for (let i = 0; i < 8; i++) {
      if (!func[8 * size + (size - 1 - i)]) set(8, size - 1 - i, 0);
      if (!func[(size - 1 - i) * size + 8]) set(size - 1 - i, 8, 0);
    }
    set(size - 8, 8, 1); // dark module
    // version info (v >= 7)
    if (version >= 7) {
      const bits = bchVersion(version);
      for (let i = 0; i < 18; i++) {
        const mod = ((bits >> i) & 1) === 1;
        set((i / 3) | 0, (i % 3) + size - 11, mod);
        set((i % 3) + size - 11, (i / 3) | 0, mod);
      }
    }
    return { size, func, base };
  }

  // Write the 15 format bits for (level, mask) into matrix.
  function placeFormat(matrix, size, level, mask) {
    const bits = bchTypeInfo((LEVEL_BITS[level] << 3) | mask);
    for (let i = 0; i < 15; i++) {
      const mod = ((bits >> i) & 1) === 1 ? 1 : 0;
      // vertical copy (col 8)
      if (i < 6) matrix[i * size + 8] = mod;
      else if (i < 8) matrix[(i + 1) * size + 8] = mod;
      else matrix[(size - 15 + i) * size + 8] = mod;
      // horizontal copy (row 8)
      if (i < 8) matrix[8 * size + (size - 1 - i)] = mod;
      else if (i < 9) matrix[8 * size + (15 - i - 1 + 1)] = mod;
      else matrix[8 * size + (15 - i - 1)] = mod;
    }
    matrix[(size - 8) * size + 8] = 1;
  }

  // Positions of format modules (to lock them in editors).
  function formatModuleIndices(size) {
    const idx = new Set();
    for (let i = 0; i < 15; i++) {
      if (i < 6) idx.add(i * size + 8);
      else if (i < 8) idx.add((i + 1) * size + 8);
      else idx.add((size - 15 + i) * size + 8);
      if (i < 8) idx.add(8 * size + (size - 1 - i));
      else if (i < 9) idx.add(8 * size + (15 - i - 1 + 1));
      else idx.add(8 * size + (15 - i - 1));
    }
    idx.add((size - 8) * size + 8);
    return idx;
  }

  // ---------------- Interleave + placement metadata ----------------
  function layout(version, level) {
    const size = sizeOf(version);
    const groups = EC_BLOCKS[version][level];
    const blocks = [];
    for (const [count, total, data] of groups) {
      for (let i = 0; i < count; i++) blocks.push({ dataLen: data, ecLen: total - data, total });
    }
    const totalData = blocks.reduce((s, b) => s + b.dataLen, 0);
    const totalCw = blocks.reduce((s, b) => s + b.total, 0);
    const maxData = Math.max(...blocks.map((b) => b.dataLen));
    const maxEc = Math.max(...blocks.map((b) => b.ecLen));

    // interleaved codeword order -> {block, index, isEC}
    const inter = [];
    for (let i = 0; i < maxData; i++) {
      for (let b = 0; b < blocks.length; b++) {
        if (i < blocks[b].dataLen) inter.push({ block: b, index: i, isEC: false });
      }
    }
    for (let i = 0; i < maxEc; i++) {
      for (let b = 0; b < blocks.length; b++) {
        if (i < blocks[b].ecLen) inter.push({ block: b, index: i, isEC: true });
      }
    }
    // sequential data byte index -> interleaved codeword index
    const seqToInter = new Int32Array(totalData);
    // (block, ecIndex) -> interleaved codeword index
    const ecToInter = blocks.map(() => new Int32Array(maxEc).fill(-1));
    {
      const starts = [];
      let acc = 0;
      for (const b of blocks) {
        starts.push(acc);
        acc += b.dataLen;
      }
      inter.forEach((cw, ci) => {
        if (cw.isEC) ecToInter[cw.block][cw.index] = ci;
        else seqToInter[starts[cw.block] + cw.index] = ci;
      });
    }

    // zigzag placement: stream bit i -> module index
    const fp = functionPatterns(version);
    const totalBits = totalCw * 8 + REMAINDER_BITS[version];
    const bitToModule = new Int32Array(totalBits).fill(-1);
    const moduleToBit = new Int32Array(size * size).fill(-1);
    {
      let inc = -1, row = size - 1, bit = 0;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col -= 1;
        for (;;) {
          for (let c = 0; c < 2; c++) {
            const cc = col - c;
            if (!fp.func[row * size + cc]) {
              if (bit < totalBits) {
                bitToModule[bit] = row * size + cc;
                moduleToBit[row * size + cc] = bit;
              }
              bit++;
            }
          }
          row += inc;
          if (row < 0 || row >= size) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    }
    return {
      version, level, size, blocks, totalData, totalCw,
      inter, seqToInter, ecToInter, bitToModule, moduleToBit,
      func: fp.func, base: fp.base,
      remainderBits: REMAINDER_BITS[version],
      formatModules: formatModuleIndices(size),
    };
  }

  // ---------------- Payload building ----------------
  function textToBytes(text) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
    return Uint8Array.from(Buffer.from(text, "utf8"));
  }
  function bytesToText(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(Uint8Array.from(bytes));
    return Buffer.from(bytes).toString("utf8");
  }

  const FRAGMENT_ALPHABET = (() => {
    let s = "";
    for (let c = 65; c <= 90; c++) s += String.fromCharCode(c);
    for (let c = 97; c <= 122; c++) s += String.fromCharCode(c);
    for (let c = 48; c <= 57; c++) s += String.fromCharCode(c);
    return s + "-._~";
  })();

  // Build the sequential data-codeword stream for `text` (byte mode), plus a
  // freedom map: freedom[i] = 0 fixed | 1 free pad byte (any value) |
  // 2 fragment char (FRAGMENT_ALPHABET). fragmentLen chars of text tail are
  // marked free when markFragment is set (they must already be in text).
  function buildData(text, version, level, opts = {}) {
    const { fragmentLen = 0 } = opts;
    const lay = layout(version, level);
    const bytes = textToBytes(text);
    const countBits = version < 10 ? 8 : 16;
    const bitLen = 4 + countBits + bytes.length * 8;
    const capacityBits = lay.totalData * 8;
    if (bitLen + 4 > capacityBits) {
      throw new Error(
        `payload too long for v${version}-${level}: need ${Math.ceil((bitLen + 4) / 8)} of ${lay.totalData} data bytes`
      );
    }
    const buf = new Uint8Array(lay.totalData);
    const freedom = new Uint8Array(lay.totalData);
    let bp = 0;
    const putBits = (val, n) => {
      for (let i = n - 1; i >= 0; i--) {
        if ((val >> i) & 1) buf[bp >> 3] |= 0x80 >> (bp & 7);
        bp++;
      }
    };
    putBits(0b0100, 4);
    putBits(bytes.length, countBits);
    const fragStartByte = [];
    for (let i = 0; i < bytes.length; i++) {
      if (fragmentLen > 0 && i >= bytes.length - fragmentLen) fragStartByte.push(bp >> 3);
      putBits(bytes[i], 8);
    }
    putBits(0, Math.min(4, capacityBits - bp)); // terminator
    // header is byte-aligned after 4+8(+8) bits + terminator? Only if bp % 8 == 0.
    // Byte mode with countBits=8: 4+8+8k+4 = 8k+16 — always aligned. countBits=16: also aligned.
    if (bp % 8 !== 0) bp += 8 - (bp % 8); // zero bit padding (buf already 0)
    const firstPad = bp >> 3;
    for (let i = firstPad, alt = 0; i < lay.totalData; i++, alt ^= 1) {
      buf[i] = alt === 0 ? 0xec : 0x11;
      freedom[i] = 1;
    }
    // fragment chars are whole bytes only when countBits keeps them aligned —
    // true for byte mode (header 12 or 20 bits => bytes start mid-bit)…
    // Actually bytes start at bit 12 (v<10): NOT byte-aligned. Fragment bytes
    // straddle codeword boundaries; handled at the bit level by the solver.
    return { lay, bytes: buf, freedom, headerBits: 4 + countBits, textLen: bytes.length, fragmentLen };
  }

  // ---------------- Encoding ----------------
  // data: sequential data codewords (Uint8Array totalData) -> final matrix.
  function encodeFromData(lay, data, mask, level) {
    const { size, blocks } = lay;
    // split + RS per block
    const cw = new Uint8Array(lay.totalCw);
    {
      let off = 0;
      const dataArrs = [];
      for (const b of blocks) {
        dataArrs.push(data.slice(off, off + b.dataLen));
        off += b.dataLen;
      }
      const ecArrs = dataArrs.map((d, i) => rsEncode(d, blocks[i].ecLen));
      lay.inter.forEach((c, ci) => {
        cw[ci] = c.isEC ? ecArrs[c.block][c.index] : dataArrs[c.block][c.index];
      });
    }
    // place
    const matrix = new Uint8Array(size * size);
    matrix.set(lay.base);
    const maskFn = MASKS[mask];
    const totalBits = lay.totalCw * 8 + lay.remainderBits;
    for (let bit = 0; bit < totalBits; bit++) {
      const mi = lay.bitToModule[bit];
      if (mi < 0) continue;
      const r = (mi / size) | 0, c = mi % size;
      let dark = bit < lay.totalCw * 8 ? (cw[bit >> 3] >> (7 - (bit & 7))) & 1 : 0;
      if (maskFn(r, c)) dark ^= 1;
      matrix[mi] = dark;
    }
    placeFormat(matrix, size, level, mask);
    return matrix;
  }

  function encodeStandard(text, opts = {}) {
    const version = opts.version || minVersionFor(text, opts.level || "M");
    const level = opts.level || "M";
    const built = buildData(text, version, level);
    let best = null;
    const masks = opts.mask != null ? [opts.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
    for (const m of masks) {
      const matrix = encodeFromData(built.lay, built.bytes, m, level);
      const score = penalty(matrix, built.lay.size);
      if (!best || score < best.score) best = { matrix, mask: m, score };
    }
    return { matrix: best.matrix, size: built.lay.size, mask: best.mask, version, level, lay: built.lay };
  }

  function minVersionFor(text, level, extraFreeBytes = 0) {
    const len = textToBytes(text).length;
    for (let v = 1; v <= 10; v++) {
      const lay = layout(v, level);
      const countBits = v < 10 ? 8 : 16;
      const needBits = 4 + countBits + len * 8 + 4;
      if (Math.ceil(needBits / 8) + extraFreeBytes <= lay.totalData) return v;
    }
    throw new Error("payload too long for versions 1-10");
  }

  // ISO penalty (rule 1-4) — used only for standard codes' mask choice.
  function penalty(matrix, size) {
    let score = 0;
    const at = (r, c) => matrix[r * size + c];
    for (let axis = 0; axis < 2; axis++) {
      for (let i = 0; i < size; i++) {
        let run = 1;
        let prev = axis ? at(0, i) : at(i, 0);
        for (let j = 1; j < size; j++) {
          const v = axis ? at(j, i) : at(i, j);
          if (v === prev) {
            run++;
            if (j === size - 1 && run >= 5) score += 3 + run - 5;
          } else {
            if (run >= 5) score += 3 + run - 5;
            run = 1;
            prev = v;
          }
        }
      }
    }
    for (let r = 0; r < size - 1; r++)
      for (let c = 0; c < size - 1; c++) {
        const v = at(r, c);
        if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
      }
    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let axis = 0; axis < 2; axis++) {
      for (let i = 0; i < size; i++) {
        for (let j = 0; j + 11 <= size; j++) {
          let m1 = true, m2 = true;
          for (let k = 0; k < 11; k++) {
            const v = axis ? at(j + k, i) : at(i, j + k);
            if (v !== pat1[k]) m1 = false;
            if (v !== pat2[k]) m2 = false;
          }
          if (m1) score += 40;
          if (m2) score += 40;
        }
      }
    }
    let dark = 0;
    for (let i = 0; i < size * size; i++) dark += matrix[i];
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  // ---------------- Validation (independent decode) ----------------
  function readFormat(matrix, size) {
    const cand = [];
    // copy 1
    let v1 = 0;
    for (let i = 0; i < 15; i++) {
      let mod;
      if (i < 6) mod = matrix[i * size + 8];
      else if (i < 8) mod = matrix[(i + 1) * size + 8];
      else mod = matrix[(size - 15 + i) * size + 8];
      v1 |= (mod & 1) << i;
    }
    cand.push(v1);
    // copy 2
    let v2 = 0;
    for (let i = 0; i < 15; i++) {
      let mod;
      if (i < 8) mod = matrix[8 * size + (size - 1 - i)];
      else if (i < 9) mod = matrix[8 * size + (15 - i - 1 + 1)];
      else mod = matrix[8 * size + (15 - i - 1)];
      v2 |= (mod & 1) << i;
    }
    cand.push(v2);
    let best = null;
    for (const raw of cand) {
      for (let data = 0; data < 32; data++) {
        const ref = bchTypeInfo(data);
        let diff = 0, x = ref ^ raw;
        while (x) {
          diff += x & 1;
          x >>= 1;
        }
        if (diff <= 3 && (!best || diff < best.diff)) {
          const levelBits = (data >> 3) & 3;
          const level = Object.keys(LEVEL_BITS).find((k) => LEVEL_BITS[k] === levelBits);
          best = { level, mask: data & 7, diff };
        }
      }
    }
    return best;
  }

  // Full logical decode of a module matrix. Returns per-block error usage —
  // the honest "how close is this to unscannable" report.
  function validate(matrix, version, opts = {}) {
    const size = sizeOf(version);
    const fmt = readFormat(matrix, size);
    if (!fmt) return { ok: false, reason: "format info unreadable" };
    const level = opts.level || fmt.level;
    const lay = layout(version, level);
    const maskFn = MASKS[fmt.mask];
    const cw = new Uint8Array(lay.totalCw);
    for (let bit = 0; bit < lay.totalCw * 8; bit++) {
      const mi = lay.bitToModule[bit];
      if (mi < 0) continue;
      const r = (mi / size) | 0, c = mi % size;
      let v = matrix[mi];
      if (maskFn(r, c)) v ^= 1;
      if (v) cw[bit >> 3] |= 0x80 >> (bit & 7);
    }
    // deinterleave
    const blockCw = lay.blocks.map((b) => new Uint8Array(b.total));
    {
      const dIdx = lay.blocks.map(() => 0);
      lay.inter.forEach((c, ci) => {
        blockCw[c.block][c.isEC ? lay.blocks[c.block].dataLen + c.index : c.index] = cw[ci];
      });
    }
    const perBlock = [];
    const data = [];
    let ok = true;
    for (let b = 0; b < lay.blocks.length; b++) {
      const block = lay.blocks[b];
      const res = rsCorrect(blockCw[b], block.ecLen);
      const capacity = block.ecLen >> 1;
      if (!res) {
        ok = false;
        perBlock.push({ errors: capacity + 1, capacity, failed: true });
      } else {
        perBlock.push({ errors: res.errors, capacity });
      }
    }
    if (!ok) return { ok, level, mask: fmt.mask, formatDamage: fmt.diff, perBlock, reason: "block unrecoverable" };
    for (let b = 0; b < lay.blocks.length; b++) data.push(blockCw[b].slice(0, lay.blocks[b].dataLen));
    const stream = new Uint8Array(lay.totalData);
    {
      let off = 0;
      for (const d of data) {
        stream.set(d, off);
        off += d.length;
      }
    }
    // parse segments
    let bp = 0;
    const readBits = (n) => {
      let v = 0;
      for (let i = 0; i < n; i++) {
        v = (v << 1) | ((stream[bp >> 3] >> (7 - (bp & 7))) & 1);
        bp++;
      }
      return v;
    };
    const totalBits = lay.totalData * 8;
    let text = "";
    parse: for (;;) {
      if (bp + 4 > totalBits) break;
      const mode = readBits(4);
      if (mode === 0) break;
      switch (mode) {
        case 4: {
          const n = readBits(version < 10 ? 8 : 16);
          const bytes = [];
          for (let i = 0; i < n; i++) bytes.push(readBits(8));
          text += bytesToText(bytes);
          break;
        }
        case 1: {
          const n = readBits(version < 10 ? 10 : 12);
          let i = 0;
          while (i + 3 <= n) {
            text += String(readBits(10)).padStart(3, "0");
            i += 3;
          }
          if (n - i === 2) text += String(readBits(7)).padStart(2, "0");
          else if (n - i === 1) text += String(readBits(4));
          break;
        }
        case 2: {
          const AL = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
          const n = readBits(version < 10 ? 9 : 11);
          let i = 0;
          while (i + 2 <= n) {
            const v = readBits(11);
            text += AL[(v / 45) | 0] + AL[v % 45];
            i += 2;
          }
          if (n - i === 1) text += AL[readBits(6)];
          break;
        }
        default:
          break parse; // ECI etc. — not produced by this tool
      }
    }
    const worst = perBlock.reduce((w, b) => Math.min(w, b.capacity > 0 ? (b.capacity - b.errors) / b.capacity : 1), 1);
    return { ok: true, text, level, mask: fmt.mask, formatDamage: fmt.diff, perBlock, marginLeft: worst };
  }

  // ---------------- Art optimizer ----------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The module set toggled by flipping one bit of one sequential-stream data
  // byte: its own data module + the RS check modules it drags along (via
  // linearity of Reed-Solomon over GF(2)).
  function streamBitBasis(lay, byteIdx, bit) {
    let b = 0, start = 0;
    while (byteIdx >= start + lay.blocks[b].dataLen) {
      start += lay.blocks[b].dataLen;
      b++;
    }
    const block = lay.blocks[b];
    const unit = new Uint8Array(block.dataLen);
    unit[byteIdx - start] = 1 << (7 - bit); // MSB-first bit index
    const ec = rsEncode(unit, block.ecLen);
    const mods = [];
    const mi = lay.bitToModule[lay.seqToInter[byteIdx] * 8 + bit];
    if (mi >= 0) mods.push(mi);
    for (let e = 0; e < block.ecLen; e++) {
      if (ec[e] === 0) continue;
      const eci = lay.ecToInter[b][e];
      for (let k = 0; k < 8; k++) {
        if ((ec[e] >> (7 - k)) & 1) {
          const emi = lay.bitToModule[eci * 8 + k];
          if (emi >= 0) mods.push(emi);
        }
      }
    }
    return Int32Array.from(mods);
  }

  const FRAG_CODES = Int32Array.from(FRAGMENT_ALPHABET, (ch) => ch.charCodeAt(0));

  /*
   * Exact GF(2) solver (the QArt trick). Each free bit's basis is a vector in
   * GF(2)^(size^2): the set of modules it toggles (its own data module + the
   * Reed-Solomon check modules it drags along). The reachable matrices form
   * an affine space baseline ⊕ span(bases). We walk target modules in
   * priority order and pin each one exactly while we still have rank:
   * pick a basis vector that touches the module, use it to fix the module,
   * eliminate that module from every other vector, retire the vector.
   * Higher-priority pins are never disturbed by later ones.
   */
  function solveExact(size, matrix, vectors, target, order, solVars) {
    const W = (size * size + 31) >> 5;
    const pool = vectors;
    let pinned = 0;
    for (const mi of order) {
      if (pool.length === 0) break;
      const w = mi >> 5, b = mi & 31;
      let pv = -1;
      for (let k = 0; k < pool.length; k++) {
        if ((pool[k].mod[w] >>> b) & 1) {
          pv = k;
          break;
        }
      }
      if (pv < 0) continue; // out of reach — left for the flip pass
      const pivot = pool[pv];
      pool[pv] = pool[pool.length - 1];
      pool.pop();
      for (let k = 0; k < pool.length; k++) {
        const v = pool[k];
        if ((v.mod[w] >>> b) & 1) {
          for (let x = 0; x < W; x++) v.mod[x] ^= pivot.mod[x];
          for (let x = 0; x < v.vars.length; x++) v.vars[x] ^= pivot.vars[x];
        }
      }
      if (matrix[mi] !== target[mi]) {
        // apply pivot: toggle its modules, fold its variables into the solution
        for (let x = 0; x < W; x++) {
          let word = pivot.mod[x];
          while (word) {
            const t = word & -word;
            matrix[(x << 5) + (31 - Math.clz32(t))] ^= 1;
            word ^= t;
          }
        }
        for (let x = 0; x < solVars.length; x++) solVars[x] ^= pivot.vars[x];
      }
      pinned++;
    }
    // whatever remains in `pool` spans the null space: XOR-ing any of these
    // vectors into the matrix changes ONLY unpainted modules (pinned coords
    // were eliminated from all of them), so they are the free noise dimensions
    return { pinned, pool };
  }

  /*
   * optimize(options):
   *   text, version, level        payload + geometry
   *   target Uint8Array(size^2)   1 dark, 0 light (only where weight > 0)
   *   weight Uint8Array(size^2)   0 = don't care (noise welcome — it's a tone)
   *   mask                        null = search all 8
   *   margin                      fraction of RS capacity spendable on flips (default 0.5)
   *   fragmentLen                 free #fragment chars appended (constrained alphabet)
   *   seed, sweeps
   * Returns matrix + full report.
   */
  function optimize(opts) {
    const {
      text, version, level,
      target, weight,
      mask = null, margin = 0.5,
      marginCap = null, // hard per-block flip ceiling (default margin * 1.5)
      fragmentLen = 0, seed = 1234, sweeps = 14,
      urlCase = "none", // "none" | "schemehost" | "all" — letter-case bits as free variables
    } = opts;
    let fullText = text;
    if (fragmentLen > 0) {
      const rng0 = mulberry32(seed ^ 0x9e3779b9);
      let frag = "";
      for (let i = 0; i < fragmentLen; i++) frag += FRAGMENT_ALPHABET[(rng0() * FRAGMENT_ALPHABET.length) | 0];
      fullText += (fullText.includes("#") ? "" : "#") + frag;
    }
    const built = buildData(fullText, version, level, { fragmentLen });
    const lay = built.lay;
    const size = lay.size;

    // Free variables for the exact solver:
    //  - pad bytes: fully free 8-bit variables
    //  - URL letter-case bits (0x20): RFC 3986 scheme+host are
    //    case-insensitive, so those letters' case bits are free — and they
    //    live exactly in the otherwise-frozen URL region of the matrix
    // Fragment chars (if any) are constrained to an alphabet and handled by
    // greedy descent instead (byte-mode payload starts 12/20 bits in, so they
    // straddle stream bytes anyway).
    const bitBasisCache = new Map();
    const basisFor = (byteIdx, bit) => {
      const key = byteIdx * 8 + bit;
      let v = bitBasisCache.get(key);
      if (!v) {
        v = streamBitBasis(lay, byteIdx, bit);
        bitBasisCache.set(key, v);
      }
      return v;
    };
    const bases = [];
    for (let byteIdx = 0; byteIdx < lay.totalData; byteIdx++) {
      if (!built.freedom[byteIdx]) continue;
      for (let bit = 0; bit < 8; bit++)
        bases.push({ byte: byteIdx, bit, modules: basisFor(byteIdx, bit) });
    }
    if (urlCase !== "none") {
      const payloadBytes = textToBytes(fullText);
      let caseEnd = payloadBytes.length - fragmentLen;
      if (urlCase === "schemehost") {
        const s = fullText.indexOf("://");
        const slash = s >= 0 ? fullText.indexOf("/", s + 3) : -1;
        caseEnd = slash >= 0 ? slash : caseEnd;
      }
      for (let i = 0; i < caseEnd; i++) {
        const ch = payloadBytes[i];
        const isLetter = (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);
        if (!isLetter) continue;
        // payload byte i sits at stream bit headerBits + 8i; its 0x20 bit is
        // 2 bits further in (MSB-first)
        const abs = built.headerBits + 8 * i + 2;
        bases.push({ byte: abs >> 3, bit: abs & 7, modules: basisFor(abs >> 3, abs & 7) });
      }
    }

    // fragment char variables: char j occupies payload bits
    // headerBits + (textLen - fragmentLen + j)*8 .. +8
    const fragVars = [];
    if (fragmentLen > 0) {
      for (let j = 0; j < fragmentLen; j++) {
        const startBit = built.headerBits + (built.textLen - fragmentLen + j) * 8;
        // bit k of char -> stream byte startBit+k >> 3, bit (startBit+k)&7
        const perBit = [];
        for (let k = 0; k < 8; k++) {
          const sb = (startBit + k) >> 3;
          const bit = (startBit + k) & 7;
          // basis for THAT stream bit: compute like freeBitBases for byte sb
          perBit.push({ byte: sb, bit });
        }
        fragVars.push({ index: j, perBit });
      }
    }
    const rng = mulberry32(seed);
    const scratchParity = new Uint8Array(size * size);
    const touched = new Int32Array(4096);

    // priority order: highest weight first, seeded shuffle within ties
    const order = [];
    for (let i = 0; i < size * size; i++) if (weight[i] > 0) order.push(i);
    {
      const jitter = new Float64Array(size * size);
      for (const i of order) jitter[i] = rng();
      order.sort((a, b) => weight[b] - weight[a] || jitter[a] - jitter[b]);
    }
    const W = (size * size + 31) >> 5;
    const nVars = bases.length;
    const Vw = Math.max(1, (nVars + 31) >> 5);

    function runForMask(m) {
      const bytes = built.bytes.slice();
      const matrix = encodeFromData(lay, bytes, m, level);

      // fragment chars first (greedy descent over the constrained alphabet)
      if (fragVars.length > 0) {
        const matchGain = (mi) => {
          const w = weight[mi];
          if (w === 0) return 0;
          return matrix[mi] === target[mi] ? -w : +w;
        };
        const evalToggle = (lists, commit) => {
          let n = 0;
          for (const list of lists) {
            for (let i = 0; i < list.length; i++) {
              const mi = list[i];
              if (scratchParity[mi] === 0) touched[n++] = mi;
              scratchParity[mi] ^= 1;
            }
          }
          let gain = 0;
          for (let i = 0; i < n; i++) {
            const mi = touched[i];
            if (scratchParity[mi]) {
              gain += matchGain(mi);
              if (commit) matrix[mi] ^= 1;
            }
            scratchParity[mi] = 0;
          }
          return gain;
        };
        for (let sweep = 0; sweep < sweeps; sweep++) {
          let improved = false;
          for (const fv of fragVars) {
            let cur = 0;
            for (let k = 0; k < 8; k++) {
              const { byte, bit } = fv.perBit[k];
              cur = (cur << 1) | ((bytes[byte] >> (7 - bit)) & 1);
            }
            let bestVal = cur, bestGain = 0;
            for (let ci = 0; ci < FRAG_CODES.length; ci++) {
              const v = FRAG_CODES[ci];
              if (v === cur) continue;
              const diff = v ^ cur;
              const lists = [];
              for (let k = 0; k < 8; k++)
                if ((diff >> (7 - k)) & 1) lists.push(basisFor(fv.perBit[k].byte, fv.perBit[k].bit));
              const g = evalToggle(lists, false);
              if (g > bestGain) {
                bestGain = g;
                bestVal = v;
              }
            }
            if (bestVal !== cur) {
              const diff = bestVal ^ cur;
              const lists = [];
              for (let k = 0; k < 8; k++) {
                if ((diff >> (7 - k)) & 1) {
                  lists.push(basisFor(fv.perBit[k].byte, fv.perBit[k].bit));
                  bytes[fv.perBit[k].byte] ^= 1 << (7 - fv.perBit[k].bit);
                }
              }
              evalToggle(lists, true);
              improved = true;
            }
          }
          if (!improved) break;
        }
      }

      // exact solver over the fully-free pad bits
      const vectors = bases.map((bs, vi) => {
        const mod = new Uint32Array(W);
        for (let i = 0; i < bs.modules.length; i++) {
          const mi = bs.modules[i];
          mod[mi >> 5] ^= 1 << (mi & 31);
        }
        const vars = new Uint32Array(Vw);
        vars[vi >> 5] |= 1 << (vi & 31);
        return { mod, vars };
      });
      const solVars = new Uint32Array(Vw);
      const { pinned } = solveExact(size, matrix, vectors, target, order, solVars);
      for (let vi = 0; vi < nVars; vi++) {
        if ((solVars[vi >> 5] >>> (vi & 31)) & 1) bytes[bases[vi].byte] ^= 1 << (7 - bases[vi].bit);
      }

      let score = 0, total = 0;
      for (let i = 0; i < size * size; i++) {
        if (weight[i] === 0) continue;
        total += weight[i];
        if (matrix[i] === target[i]) score += weight[i];
      }
      return { matrix, bytes, score, total, mask: m, pinned };
    }

    const maskList = mask != null ? [mask] : [0, 1, 2, 3, 4, 5, 6, 7];
    let best = null;
    for (const m of maskList) {
      const r = runForMask(m);
      if (!best || r.score > best.score) best = r;
    }

    // ---- EC flip budget ----
    const { matrix, bytes } = best;
    const flips = [];
    const blockUsed = lay.blocks.map(() => 0);
    const allowance = lay.blocks.map((b) => Math.floor((b.ecLen >> 1) * margin));
    // group mismatches by interleaved codeword
    const cwMis = new Map();
    for (let bit = 0; bit < lay.totalCw * 8; bit++) {
      const mi = lay.bitToModule[bit];
      if (mi < 0) continue;
      if (weight[mi] === 0) continue;
      if (matrix[mi] === target[mi]) continue;
      const cwIdx = bit >> 3;
      if (!cwMis.has(cwIdx)) cwMis.set(cwIdx, { gain: 0, mods: [] });
      const e = cwMis.get(cwIdx);
      e.gain += weight[mi];
      e.mods.push(mi);
    }
    const ranked = [...cwMis.entries()].sort((a, b) => b[1].gain - a[1].gain);
    // Two passes: uniform allowance first; then blocks whose bytes were all
    // free rarely need flips, so dirty blocks (the ones stuck with the fixed
    // URL codewords) may borrow a little deeper, up to a hard cap.
    const capFrac = Math.min(1, marginCap != null ? marginCap : margin * 1.5);
    const hardCap = lay.blocks.map((b) => Math.floor((b.ecLen >> 1) * capFrac));
    const taken = new Set();
    for (const cap of [allowance, hardCap]) {
      for (const [cwIdx, e] of ranked) {
        if (taken.has(cwIdx)) continue;
        const block = lay.inter[cwIdx].block;
        if (blockUsed[block] >= cap[block]) continue;
        taken.add(cwIdx);
        blockUsed[block]++;
        for (const mi of e.mods) {
          matrix[mi] ^= 1;
          flips.push(mi);
        }
      }
    }
    // remainder bits (v2-6 have 7) belong to no codeword — decoders never
    // read them, so they are free pixels.
    for (let bit = lay.totalCw * 8; bit < lay.totalCw * 8 + lay.remainderBits; bit++) {
      const mi = lay.bitToModule[bit];
      if (mi >= 0 && weight[mi] > 0 && matrix[mi] !== target[mi]) matrix[mi] ^= 1;
    }

    let score = 0, total = 0, misses = 0;
    for (let i = 0; i < size * size; i++) {
      if (weight[i] === 0) continue;
      total += weight[i];
      if (matrix[i] === target[i]) score += weight[i];
      else misses++;
    }
    return {
      matrix, size, version, level,
      mask: best.mask, bytes, flips,
      pinned: best.pinned,
      text: fullText,
      blockUsed, allowance,
      capacity: lay.blocks.map((b) => b.ecLen >> 1),
      score, total, misses,
      lay,
    };
  }

  // ---------------- Live-painter entry points ----------------
  // prepareArt: everything that depends only on (text, version, level) —
  // layout, payload, and the free-bit basis vectors (pad bits + scheme/host
  // case bits). Cache the result per config; it never changes while painting.
  function prepareArt(text, version, level, urlCase = "schemehost") {
    const built = buildData(text, version, level);
    const lay = built.lay;
    const cache = new Map();
    const basisFor = (byteIdx, bit) => {
      const key = byteIdx * 8 + bit;
      let v = cache.get(key);
      if (!v) {
        v = streamBitBasis(lay, byteIdx, bit);
        cache.set(key, v);
      }
      return v;
    };
    const bases = [];
    for (let byteIdx = 0; byteIdx < lay.totalData; byteIdx++) {
      if (!built.freedom[byteIdx]) continue;
      for (let bit = 0; bit < 8; bit++)
        bases.push({ byte: byteIdx, bit, modules: basisFor(byteIdx, bit) });
    }
    // scheme+host letters are case-insensitive (RFC 3986), so their 0x20
    // case bits are extra free variables — unless the caller wants the URL
    // reproduced with its exact typed capitalization.
    if (urlCase !== "none") {
      const payloadBytes = textToBytes(text);
      const s = text.indexOf("://");
      const slash = s >= 0 ? text.indexOf("/", s + 3) : -1;
      const caseEnd = slash >= 0 ? slash : payloadBytes.length;
      for (let i = 0; i < caseEnd; i++) {
        const ch = payloadBytes[i];
        if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122)) {
          const abs = built.headerBits + 8 * i + 2;
          bases.push({ byte: abs >> 3, bit: abs & 7, modules: basisFor(abs >> 3, abs & 7) });
        }
      }
    }
    return { text, version, level, urlCase, built, lay, bases };
  }

  // solveArt: one full solve for a fixed mask. `order` is the priority list
  // of painted module indices (earliest paint first — those pins win);
  // `target` holds the wanted value at those indices. Everything unpainted
  // is free noise. seq (paint stamp per module) breaks flip ties so leftover
  // misses land on the newest paint.
  function solveArt(prep, opts) {
    const { order, target, mask, seq = null, margin = 0.5, marginCap = 0.8, noiseRng = null, flipSeed = 0 } = opts;
    const lay = prep.lay;
    const size = lay.size;
    const bytes = prep.built.bytes.slice();
    const matrix = encodeFromData(lay, bytes, mask, prep.level);
    const W = (size * size + 31) >> 5;
    const nVars = prep.bases.length;
    const Vw = Math.max(1, (nVars + 31) >> 5);
    const vectors = prep.bases.map((bs, vi) => {
      const mod = new Uint32Array(W);
      for (let i = 0; i < bs.modules.length; i++) {
        const mi = bs.modules[i];
        mod[mi >> 5] ^= 1 << (mi & 31);
      }
      const vars = new Uint32Array(Vw);
      vars[vi >> 5] |= 1 << (vi & 31);
      return { mod, vars };
    });
    const solVars = new Uint32Array(Vw);
    const { pinned, pool } = solveExact(size, matrix, vectors, target, order, solVars);
    for (let vi = 0; vi < nVars; vi++) {
      if ((solVars[vi >> 5] >>> (vi & 31)) & 1)
        bytes[prep.bases[vi].byte] ^= 1 << (7 - prep.bases[vi].bit);
    }
    // randomize: XOR a random subset of the null-space basis into the matrix.
    // These touch only unpainted modules, so the art and every pin are
    // untouched — just a different valid noise field. freeDim = pool.length
    // is the exponent: 2^freeDim distinct fields honor this exact drawing.
    if (noiseRng) {
      for (const v of pool) {
        if (noiseRng() < 0.5) {
          for (let x = 0; x < W; x++) {
            let word = v.mod[x];
            while (word) {
              const t = word & -word;
              matrix[(x << 5) + (31 - Math.clz32(t))] ^= 1;
              word ^= t;
            }
          }
        }
      }
    }
    // flip pass over still-mismatched painted cells, per codeword
    const flips = [];
    const blockUsed = lay.blocks.map(() => 0);
    const allowance = lay.blocks.map((b) => Math.floor((b.ecLen >> 1) * margin));
    const hardCap = lay.blocks.map((b) => Math.floor((b.ecLen >> 1) * Math.min(1, marginCap)));
    const cwMis = new Map();
    for (const mi of order) {
      if (matrix[mi] === target[mi]) continue;
      const bit = lay.moduleToBit[mi];
      if (bit < 0 || bit >= lay.totalCw * 8) continue;
      const cwIdx = bit >> 3;
      let e = cwMis.get(cwIdx);
      if (!e) {
        e = { gain: 0, minSeq: Infinity, mods: [] };
        cwMis.set(cwIdx, e);
      }
      e.gain++;
      if (seq) e.minSeq = Math.min(e.minSeq, seq[mi]);
      e.mods.push(mi);
    }
    // Order codewords for the flip budget by gain (pixels rescued) desc.
    // Ties break by newest paint (default) or, when flipSeed>0, by a seeded
    // random key — reshuffling ONLY within equal-gain tiers, so the total
    // pixels rescued (and thus the unsatisfied COUNT) is unchanged while
    // *which* pixels end up unsatisfied rotates.
    let ranked;
    if (flipSeed > 0) {
      const rng = mulberry32(flipSeed);
      const key = new Map();
      for (const [cw] of cwMis) key.set(cw, rng());
      ranked = [...cwMis.entries()].sort((a, b) => b[1].gain - a[1].gain || key.get(a[0]) - key.get(b[0]));
    } else {
      ranked = [...cwMis.entries()].sort((a, b) => b[1].gain - a[1].gain || a[1].minSeq - b[1].minSeq);
    }
    const taken = new Set();
    for (const cap of [allowance, hardCap]) {
      for (const [cwIdx, e] of ranked) {
        if (taken.has(cwIdx)) continue;
        const block = lay.inter[cwIdx].block;
        if (blockUsed[block] >= cap[block]) continue;
        taken.add(cwIdx);
        blockUsed[block]++;
        for (const mi of e.mods) {
          matrix[mi] ^= 1;
          flips.push(mi);
        }
      }
    }
    // remainder bits are nobody's codeword — free pixels for painted cells
    {
      const remainder = new Set();
      for (let bit = lay.totalCw * 8; bit < lay.totalCw * 8 + lay.remainderBits; bit++) {
        const mi = lay.bitToModule[bit];
        if (mi >= 0) remainder.add(mi);
      }
      if (remainder.size > 0)
        for (const mi of order)
          if (remainder.has(mi) && matrix[mi] !== target[mi]) matrix[mi] ^= 1;
    }
    const unsatisfied = [];
    for (const mi of order) if (matrix[mi] !== target[mi]) unsatisfied.push(mi);
    const headroom = Math.min(
      ...lay.blocks.map((b, i) => (b.ecLen >> 1) - blockUsed[i])
    );
    return {
      matrix, bytes, flips, pinned, blockUsed, allowance,
      capacity: lay.blocks.map((b) => b.ecLen >> 1),
      unsatisfied, headroom, mask, level: prep.level, lay,
      freeDim: pool.length, // noise degrees of freedom (2^freeDim variations)
    };
  }

  // ---------------- Rendering ----------------
  function toSVG(matrix, version, opts = {}) {
    const { scale = 8, quiet = 4, dark = "#000", light = "#fff" } = opts;
    const size = sizeOf(version);
    const dim = (size + quiet * 2) * scale;
    let path = "";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r * size + c]) path += `M${(c + quiet) * scale} ${(r + quiet) * scale}h${scale}v${scale}h-${scale}z`;
      }
    }
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}">` +
      `<rect width="${dim}" height="${dim}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`
    );
  }

  function toRGBA(matrix, version, opts = {}) {
    const { scale = 8, quiet = 4, dark = [0, 0, 0], light = [255, 255, 255] } = opts;
    const size = sizeOf(version);
    const dim = (size + quiet * 2) * scale;
    const data = new Uint8ClampedArray(dim * dim * 4);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const r = ((y / scale) | 0) - quiet;
        const c = ((x / scale) | 0) - quiet;
        const isDark = r >= 0 && r < size && c >= 0 && c < size && matrix[r * size + c] === 1;
        const col = isDark ? dark : light;
        const o = (y * dim + x) * 4;
        data[o] = col[0];
        data[o + 1] = col[1];
        data[o + 2] = col[2];
        data[o + 3] = 255;
      }
    }
    return { data, width: dim, height: dim };
  }

  function ascii(matrix, version) {
    const size = sizeOf(version);
    let out = "";
    for (let r = 0; r < size; r++) {
      let line = "";
      for (let c = 0; c < size; c++) line += matrix[r * size + c] ? "██" : "  ";
      out += line + "\n";
    }
    return out;
  }

  return {
    EXP, LOG, gmul, rsEncode, rsCorrect,
    EC_BLOCKS, ALIGN, LEVELS, MASKS, sizeOf,
    functionPatterns, layout, buildData, encodeFromData, encodeStandard,
    minVersionFor, penalty, validate, readFormat,
    optimize, prepareArt, solveArt, FRAGMENT_ALPHABET,
    toSVG, toRGBA, ascii,
    mulberry32,
  };
})();

export default QRArt;
