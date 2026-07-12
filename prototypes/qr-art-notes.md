# QR art notes 🐈‍⬛

Companion notes for [`qr-art-studio.html`](./qr-art-studio.html) — how the
Disney-poster style of QR art actually works, and what the studio does about
it. The committed [`cat-qr.png`](./cat-qr.png) / [`cat-qr.svg`](./cat-qr.svg)
were generated with the studio's cat preset (v6, EC level L, flip budget 50%,
hard cap 80%, scheme+host case play, 64 restarts) and encode
`https://github.com/minigolf2000/cat-games` (private repo — scanners who
aren't logged-in collaborators get GitHub's 404).

## Two schools of QR art

**QArt codes** (Russ Cox, research.swtch.com/qart) treat the picture as a
*math problem*: append free bits to the URL (his: a numeric fragment after
`#`), then use Gauss-Jordan elimination over GF(2) — Reed-Solomon codes are
linear, so XOR-ing valid codewords yields valid codewords — to choose data
bits such that chosen modules take chosen colors. The result is 100% valid:
zero error-correction budget spent.

**The Japanese design-QR posters** (the Disney Mobile あげちゃう。 series and
the wider design-QR scene: IT DeSign, Arara's logoQ, …) read as *drawn*, not
computed. The differences that matter:

1. **Three tones, not two.** Uncontrolled QR entropy is ~50% dark — at poster
   distance that's a *mid-gray texture*. The posters compose black shapes and
   white cutouts against that free gray, instead of fighting every pixel.
   Mickey's solid ears melt into the noisy ground; only the face cutout is
   clean white. Naive QArt output halftones a photo across everything, so it
   reads as static with a ghost in it.
2. **Chunky versions.** Small symbol versions (~v5-7, 37-45 modules) force
   iconic, flat shapes — pixel art. QArt cranks the version up for
   resolution, which reads as dithered fax.
3. **Composition against the fixed furniture.** Finder squares, timing
   strips, alignment patterns are immovable; a designer places the figure so
   they read as *frame*, not interruption (that's also why the studio's cat
   preset avoids v7: its extra alignment pattern lands on the cat's
   forehead).
4. **Spent error budget.** The posters almost certainly flip modules that are
   simply *wrong* and let Reed-Solomon absorb them — plus payload and mask
   search. Zero-error purism (QArt) caps how clean large fields can get.

## Where freedom comes from (most → least powerful)

| Source | Bits | Where they land |
| --- | --- | --- |
| Pad codewords after the terminator | 8/byte, fully free — decoders never read them | Everywhere the URL isn't |
| Their Reed-Solomon check bytes | steerable via the solver | EC region (placed last → top-left-ish) |
| URL letter case (scheme+host, RFC 3986) | 1 bit per letter | **Inside the frozen URL region** — precious |
| Mask choice | 3 bits | Global texture |
| `#fragment` chars | ~6 usable bits/char (alphabet-constrained) | Right after the URL |
| Remainder bits (v2-6: 7 of them) | free, no codeword owns them | Bottom-left corner |
| Deliberate wrong modules ("flips") | up to ⌊ec/2⌋ codewords per block | Anywhere — priced **per codeword** (a ~2×4 blob), not per pixel |

The structural catch: data codewords fill blocks *sequentially*, so a 41-byte
URL freezes block 1 solid (data + its EC), while later blocks are pure
padding. Interleaving then sprinkles those frozen codewords evenly across the
symbol — the zigzag placement starts at the bottom-right, so the URL owns the
right-hand columns. That's why the cat's right ear is the ragged one, why
case bits matter (they're the only steerable bits inside frozen codewords),
and why the flip budget redistributes toward dirty blocks.

## The studio pipeline

1. Build the payload; every pad bit / case bit becomes a basis vector (its
   own module + the EC modules it drags along, by RS linearity).
2. Walk target pixels in priority order, pinning each exactly via incremental
   Gauss-Jordan elimination while rank lasts (the QArt trick, on the padding
   instead of a fragment — keeps the URL clean).
3. Repeat per mask (art score decides the mask, not the ISO penalty).
4. Spend the flip budget on the worst remaining codewords, respecting a
   per-block soft allowance and hard cap.
5. Validate the honest way: read format info, unmask, de-interleave, run
   Berlekamp-Massey per block — the same pipeline a scanner runs. The meter
   shows errors-used vs capacity per block; the pill turns amber at ≤1
   codeword of headroom.

The engine was cross-validated in development: matrix-identical to
`qrcode-generator` for v1-10 × L/M/Q/H, Reed-Solomon round-trips under random
error injection, and every generated/flipped/hand-edited artifact re-decoded
with `jsQR` (including the exported PNGs).

## URL length is the biggest lever there is

Every payload byte you save is 8 fully-free solver bits *and* one less frozen
codeword sprinkled through the matrix. Measured on the cat target (same
settings, best of 24 restarts):

| URL | v6-L 41px | v5-L 37px | v4-L 33px |
| --- | --- | --- | --- |
| 41 chars (this repo) | 96.2%, 42 misses | 98.9%, 9 misses | 92.7%, 48 misses |
| 18 chars (`https://hexcat.dev`) | **100%, 0 misses** | **100%, 0 misses** | **100%, 0 misses** |
| 14 chars (`https://hex.gg`) | 100%, 0 misses | 100%, 0 flips needed | 100%, 0 misses |

A short domain moves you from "budget fight plus hand-polish" into "the whole
design solves exactly", including at the chunky poster-grade sizes the Disney
codes use. If you're buying a domain for this: every character counts, and
`https://` (8 chars) is part of the bill — keep it anyway, bare hostnames
don't reliably open as URLs on all scanners.

## Decorating outside the code

The posters' second trick is compositional: the character's ears/hat live
*outside* the symbol, so the code itself only has to carry the face.
[`hex-poster.svg`](./hex-poster.svg) / [`.png`](./hex-poster.png) do this for
Hex: green field, white rounded card (its padding doubles as the quiet zone),
black ear triangles tucked behind the card, white whisker strokes on the
field, and inside the code just eyes/nose/muzzle. Two color notes that keep
it scannable: "dark" modules don't have to be black — the iris modules render
as dark emerald (scanners only need contrast against white, so keep any
module color's luminance low) — and everything outside the quiet zone is
fair game for any color. The studio's **face (poster)** preset is this
target; the composed poster re-scans with jsQR at full and half resolution.

## Photo → pixel art, programmatically

The studio's upload path has a **poster-style cleanup** toggle that does the
mechanical 80%: threshold, keep the largest connected shape (speckle noise
gone), morphological close/open (pinholes filled, one-module arms shaved),
carve bright details like eyes back out of the figure, then derive the tier
map automatically — crisp edge band and white halo weighted high, deep
interior low, ground released to noise. What stays human (or LLM) judgment
is the remaining 20%: choosing the crop, simplifying a shape until it reads
at 41 pixels, deciding which features deserve the pin budget, and placing
the figure against the finder squares. That's taste, not math — it's also
exactly the part that makes these read as *drawn*.

## Answering the workflow question

Yes — codes like the posters are an *iterative, human process*, and the tool
the pros use is essentially what the studio implements: a module-level pixel
editor with a live decoder and an error-budget meter, on top of a solver that
gets ~95% of the way. "Likelihood it still scans" isn't vibes; it's exact
arithmetic — `capacity − errors` per block — plus real-phone tests before
print, because print adds its own damage (keep ≥2 codewords of headroom, more
for posters).
