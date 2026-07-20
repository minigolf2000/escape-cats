# Piece 4 — the code that names its destination

**The bend:** the artwork *is* legible text: the code says CAT GAMES in pixel
type, and scanning it takes you to cat-games. Human-readable and
machine-readable layers agree.

## Payload & symbol

- URL: `https://github.com/minigolf2000/cat-games`, version 6, level L.

## Art direction

Two lines of pixel type, dark letters with a 1-module white halo, everything
else surrendered noise:

- Line 1: `CAT` — larger (≈4×7 base glyphs at 2× → letters ~8 wide, 14 tall),
  centered horizontally, roughly rows 9–22.
- Line 2: `GAMES` — smaller (3×5 base glyphs at 2× → letters 6 wide, 10 tall,
  1–2 module gaps), roughly rows 25–34. Must clear the (34,34) alignment
  pattern — end the S before column 32 or accept the pattern as a full stop.
- A 3–4 module paw-print or tiny cat-ear glyph tucked wherever budget allows
  (optional garnish, drop it first if rank runs short).

Known headwind (from qr-art-notes.md): the 41-char URL freezes the right-hand
columns, so the rightmost letters (T, S) will be the expensive ones. You may
shift both words 1–3 modules left of true center, nudge letterforms ±1
module, and spend flips on letter interiors (a hole in a letter is worse than
a speck in the noise). Case-play on scheme+host is on — those bits live
exactly in the frozen region, use them.

Legibility gate: render the target (pre-solve ideal) and the solved result
side by side; every letter must be unambiguous in the solved version at 8×
scale viewed at 50%. A broken letter fails the piece even if it scans.

## Acceptance

- verifyMatrix passes (scale 8 + 3); ≥2 codewords headroom per block.
- ≥97% of letter-stroke pins satisfied; report halo satisfaction too.
- Deliver: `out/pixel-type.png`, `out/pixel-type.svg`,
  `out/pixel-type-target-vs-solved.png` (side-by-side),
  `out/pixel-type-report.md`. Expect one round of art notes.
