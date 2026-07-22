# Wild QR — the gallery 🐈‍⬛

Seven pieces built to break the assumption that a QR code has to look like a
QR code. Every artifact here **honestly scans**: each one is verified by
running jsQR (the same decode pipeline a phone runs) against the rendered
pixels, plus the engine's own Berlekamp-Massey per-block error meter. All
pieces encode `https://github.com/minigolf2000/cat-games` (some as an
RFC 3986 case remix of scheme+host — that's solver freedom, not a typo).

The engine is the one from [`../qr-studio.html`](../qr-studio.html),
extracted verbatim into [`engine.mjs`](./engine.mjs) so it runs headless in
Node; see [`HARNESS.md`](./HARNESS.md) for the API and
[`../qr-art-notes.md`](../qr-art-notes.md) for how this style of QR art
works at all. Each piece regenerates deterministically with
`node build-0N-<name>.mjs`.

## 1. The nearly-blank code — `out/nearly-blank.png`

A thin line-drawn cat on white. The bend: everyone expects dense static, and
this is mostly paper. Physics caps how blank a 41-char URL can get (the
solver rank runs out around 76–84% white), so the design puts every drop of
control where the eye goes: 100% of the drawing's strokes satisfied, and a
radius-11 disc around the face with **zero** unwanted dark modules —
achieved by spending block-0 flips only on the disc while pinning the outer
field only on block-1/EC codewords, so the two budgets never compete. The
leftover grain frames the face like risograph texture.

## 2. The diamond cat — `out/diamond-cat.svg` / `.png`

Hang a QR at 45° and the decoder doesn't care — orientation comes from the
finder patterns. So the two side finders become the cat's **eyes** (emerald
irises), the v5 alignment pattern at (30,30) lands at the bottom vertex and
becomes the **nose**, black ears flank the top vertex outside the card, and
white whiskers continue onto the green field. The scanner furniture *is* the
anatomy. Decodes in both orientations at full and half resolution.

## 3. The animated code — `out/animated.png` (APNG)

A black cat whose tail sweeps like a metronome while the noise ground
shimmers — and **every frame is an independently valid QR** of the same URL.
Works because the surrendered noise tone re-solves to a
different-but-equivalent matrix per frame. The figure is byte-identical
across all ten frames (no boiling); the solve uses zero deliberate flips, so
every block keeps its full 9/9 error budget. The tail lives in the left
columns because an empirical rank map showed the URL freezes the right ones.

## 4. The code that names its destination — `out/pixel-type.png`

The artwork is the words **CAT GAMES** in pixel type; scanning it opens
cat-games. Human layer and machine layer agree. Rendered three-tone (pure
black letters, dark-gray noise ground — scanners only need low luminance),
with the v6 alignment pattern reading as a full stop after the S. The
letters survive at 97.25% stroke satisfaction with the T and S paying the
frozen-column tax the notes predict.

## 5. The picross code — `out/picross-sheet.svg` / `.png`

A printable 29×29 nonogram whose unique solution **is** the QR code. Solve
it with a pencil, then scan your own drawing. The clue set is 100%
line-solvable with zero given cells (the finder/timing furniture seeds the
propagation), the line solver was cross-validated against brute-force
enumeration on all 58 lines, and a simulated sloppy hand-solve
(half-module jitter, ~91% ink coverage) still scans — 40/40 random trials.
Answer key: `out/picross-solution.png`.

## 6. The fractal code — `out/fractal.png`

One code from across the room; up close, **each of the 865 dark modules is
itself a scannable QR** — an inverted v1 micro-code carrying one fragment of
a 40-part Hex & Goomba micro-story (`out/fractal-story.txt`; tile #000 says
START HERE. MEOW.). Inversion keeps each cell dark-dominant, and the tiles'
light modules render mid-gray so the parent's module centers stay below the
sampling threshold: the parent decodes from 410px and 205px downsamples
while sampled tiles all decode at full resolution.

## 7. The smuggler — `out/smuggler.png` + `hidden.mjs`

Phones show only the URL. But the pad codewords — bytes a decoder never
surfaces — spell `PSST. YOU READ THE PADDING. GOOD CAT. -HEX & GOOMBA`
starting at stream offset 43. Standard padding is the alternating
`EC 11 EC 11…` filler, so ASCII there is a detectable easter egg for anyone
who dumps the raw bitstream: `node hidden.mjs out/smuggler.png` does the
honest read path (unmask → de-interleave → RS-correct) and prints it. The
visible art is a paw print solved with the ~40% of pad freedom the message
left behind.

## 8–11. The wallpaper & evolution wing

Later additions push into repeating pattern and machine search:

- **Geometric nearly-blank series** (`out/geometric-*.png`) — rings, waves,
  spiral, starburst, target-cat, plus solid-blob honeycomb and tangram.
- **v10 wallpaper** (`out/wallpaper-*.png`) — 57×57 codes tiled with smiley
  polka dots, the '90s Cool S, and a school-binder doodle page.
- **Smiley & Cool S icons** (`out/icon-*.png`) — the schoolyard classics as
  nearly-blank line art.
- **Evolved cat/paw wallpaper** (`out/evolve-champion-*.png`) — the champions
  of an *aesthetic genetic algorithm* that evolved icon placements over
  generations, scored for "wow" by a vision judge each round. A dense grid of
  tiny cat faces (and a cats-and-paws sibling) on a v10 code. See
  `out/evolve-report.md` and `out/evolve-montage.png` for the story, and
  `specs/` for how each piece was directed.

## Verifying everything yourself

```sh
npm install
npm test                                  # harness smoke tests
node verify.mjs out/<piece>.png <url>     # any single artifact
node hidden.mjs out/smuggler.png          # the smuggled message
```

Print advice from the notes still applies: these ship with ≥2 codewords of
RS headroom per block, but paper adds its own damage — test on a real phone
before putting one on a wall, and keep the quiet zone.
