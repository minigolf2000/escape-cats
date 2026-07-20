# Piece 3 — animated code: build report

- URL: `https://github.com/minigolf2000/cat-games` (v6, level L, urlCase schemehost)
- 10 frames @ 100ms, looping APNG via upng-js.
  UPNG auto-picked a lossless 2-colour palette (round-trip is byte-exact,
  see below), acTL num_plays = 0 (loops forever).
- Mask **fixed at 3** across all frames; EC level fixed at L.
  Fixed mask chosen empirically: it keeps the figure byte-identical and
  the furniture rock-steady (see furniture check). Varying the mask would
  reseed the whole rendered field and risk visible boiling for no gain.
- **Flip budget 0** (margin 0). The pure Gauss-Jordan solve is already a
  valid codeword with zero RS errors, so every block keeps full headroom
  (9/9) AND no deliberate flip can disturb the figure between frames.
- Render: scale 8, quiet 4, black on white.
- Restarts/frame: 6 (noise-only; pins/headroom are seed-invariant here).
- **Tail relocated to the LEFT (high-rank) columns.** A measured rank map
  (pin every module, count what sticks) shows columns 0-14 are 100%
  pinnable, 15-31 fall to ~73-88%, and 32-40 (frozen by the 41-char URL
  per the interleave analysis) only ~40-56%. The tail therefore swishes in
  the left columns and the cat sits centre-right (centre column CX=16),
  a balance point that keeps the tail at 0% holes while the body's scratch
  count stays low (9, comparable to the pre-relocation 11).
- Tail: solid 3-module stroke, 3-module white swing lane, pose interpolated
  as s = sin(2π f/10) so the tip metronomes ~5 columns and rises above
  shoulder height at the extremes; base pinned constant.

## Constancy

- Figure (head/body/ears/eyes) pinned modules: 420
- Figure modules that differ across frames: **0** (byte-identical — figure does not boil)
- Function-pattern (finder/timing/alignment) modules differing across frames: **0** (furniture is rock-steady)
- Total modules that vary across frames (the animated tail + shimmer ground): 573
- Figure "ink scratch" holes (pins the medium-rank columns can't satisfy
  exactly): 9 of 420 figure modules, **identical every
  frame** (constant, so they read as scratchiness, not boiling).

## Tail legibility (hard gate: hole rate <= 8% per frame)

- Worst tail hole rate across all frames: **0.0%** (gate <= 8%). Tail lives in the high-rank left columns, so it pins near-exactly.

| frame | tail pins satisfied | tail holes | hole rate |
| --- | --- | --- | --- |
| 0 | 72/72 | 0 | 0.0% |
| 1 | 72/72 | 0 | 0.0% |
| 2 | 74/74 | 0 | 0.0% |
| 3 | 74/74 | 0 | 0.0% |
| 4 | 72/72 | 0 | 0.0% |
| 5 | 72/72 | 0 | 0.0% |
| 6 | 71/71 | 0 | 0.0% |
| 7 | 70/70 | 0 | 0.0% |
| 8 | 70/70 | 0 | 0.0% |
| 9 | 71/71 | 0 | 0.0% |

## Per-frame acceptance meter

| frame | pins | flips | per-block headroom | min head | jsQR@8 | jsQR@3 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 562/593 | 0 | 9 / 9 | 9 | ok | ok |
| 1 | 561/593 | 0 | 9 / 9 | 9 | ok | ok |
| 2 | 557/593 | 0 | 9 / 9 | 9 | ok | ok |
| 3 | 557/593 | 0 | 9 / 9 | 9 | ok | ok |
| 4 | 561/593 | 0 | 9 / 9 | 9 | ok | ok |
| 5 | 562/593 | 0 | 9 / 9 | 9 | ok | ok |
| 6 | 553/593 | 0 | 9 / 9 | 9 | ok | ok |
| 7 | 556/593 | 0 | 9 / 9 | 9 | ok | ok |
| 8 | 556/593 | 0 | 9 / 9 | 9 | ok | ok |
| 9 | 553/593 | 0 | 9 / 9 | 9 | ok | ok |

Per-block detail (used/cap):

- f0: 0/9  0/9
- f1: 0/9  0/9
- f2: 0/9  0/9
- f3: 0/9  0/9
- f4: 0/9  0/9
- f5: 0/9  0/9
- f6: 0/9  0/9
- f7: 0/9  0/9
- f8: 0/9  0/9
- f9: 0/9  0/9

## Round-trip (APNG decode -> compare to source render -> jsQR)

| frame | pixel diff vs source | jsQR decode |
| --- | --- | --- |
| 0 | 0 | ok |
| 1 | 0 | ok |
| 2 | 0 | ok |
| 3 | 0 | ok |
| 4 | 0 | ok |
| 5 | 0 | ok |
| 6 | 0 | ok |
| 7 | 0 | ok |
| 8 | 0 | ok |
| 9 | 0 | ok |

- All frames decode byte-identical to source render: **true**
- All extracted frames scan with jsQR: **true**

## Files

- `out/animated.png` — APNG (10 frames, looping)
- `out/animated-frames/f0..f9.png` — per-frame PNGs
- `out/animated-contact.png` — 5x2 contact sheet
