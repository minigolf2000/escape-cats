# Piece 3 — animated code: build report

- URL: `https://github.com/minigolf2000/cat-games` (v6, level L, urlCase schemehost)
- 10 frames @ 100ms, looping APNG (upng-js, lossless truecolor)
- Mask **fixed at 3** across all frames; EC level fixed at L.
- Render: scale 8, quiet 4, black on white.
- Restarts/frame: 24, best-of by (pins satisfied, min headroom).

## Constancy

- Figure (head/body/ears/eyes) pinned modules: 462
- Figure modules that differ across frames: **5** (BOILING in frames 1)
- Total modules that vary across frames (the animated area): 629

## Per-frame acceptance meter

| frame | pins | flips | per-block headroom | min head | jsQR@8 | jsQR@3 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 623/645 | 34 | 2 / 9 | 2 | ok | ok |
| 1 | 625/645 | 35 | 2 / 9 | 2 | ok | ok |
| 2 | 623/645 | 34 | 2 / 9 | 2 | ok | ok |
| 3 | 623/645 | 34 | 2 / 9 | 2 | ok | ok |
| 4 | 625/645 | 35 | 2 / 9 | 2 | ok | ok |
| 5 | 623/645 | 34 | 2 / 9 | 2 | ok | ok |
| 6 | 624/645 | 33 | 2 / 9 | 2 | ok | ok |
| 7 | 624/645 | 30 | 2 / 9 | 2 | ok | ok |
| 8 | 624/645 | 30 | 2 / 9 | 2 | ok | ok |
| 9 | 624/645 | 33 | 2 / 9 | 2 | ok | ok |

Per-block detail (used/cap):

- f0: 7/9  0/9
- f1: 7/9  0/9
- f2: 7/9  0/9
- f3: 7/9  0/9
- f4: 7/9  0/9
- f5: 7/9  0/9
- f6: 7/9  0/9
- f7: 7/9  0/9
- f8: 7/9  0/9
- f9: 7/9  0/9

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
