# Artist brief: artwork for QR-code posters 🎨

We turn artwork into working QR codes where **the code's own pixels are the
drawing** (see `qr-art-notes.md` for how). This brief is what to hand an
illustrator. Evidence for every rule here: `style-demos.png` (three icons in
this grammar → codes), `ink-cat-qr.png` (a scratchy ink style surviving
beautifully), and the tabby experiments (an engraving style failing).

## The medium, honestly stated

- Your canvas is a **41×41 pixel grid** (about **30×30 usable** once the
  scanner's corner squares take their share). Draw big. One "pixel" of your
  art = one QR module.
- You get **three inks**, not two:
  - **Black** — will be exactly black.
  - **White** — will be exactly white.
  - **Mid-gray** — will be filled with QR static (a lively ~50% dither).
    Treat it as a *texture tone*, like the gray in a two-block linocut.
    **It costs us nothing — use it generously** for backgrounds and areas
    that just need to read "busy/dark-ish".
- A small share of pixels (~2-5%) will come out wrong no matter what.
  Styles with a hand-made, rough character absorb this invisibly; styles
  that depend on precision (fine symmetry, hairlines, gradients) expose it.

## Styles that transfer (with references)

1. **Japanese family crests (kamon)** — the ideal reference class: bold,
   round, iconic, black/white by design.
   [Wikipedia: Mon (emblem)](https://en.wikipedia.org/wiki/Mon_(emblem)) ·
   [kamon gallery by clan](https://www.patternz.jp/japanese-family-crest-list-symbol/)
2. **Flat pictograms** — Otl Aicher's Munich 1972 Olympic pictograms; airport
   signage; classic flat logos.
   [theolympicdesign.com](https://www.theolympicdesign.com/olympic-games/pictograms/munich-1972/) ·
   [Smithsonian on Aicher](https://www.smithsonianmag.com/innovation/this-graphic-artists-olympic-pictograms-changed-urban-design-forever-180978256/)
3. **Linocut / woodcut** — chunky Expressionist-print shapes; our ink cat is
   effectively this and it's the best-performing piece we have.
4. **1-bit pixel art** — 8/16-bit game sprites; if the artist will draw
   *directly on the 41×41 grid*, this is the highest-control option.
5. **Stencil / papercut silhouettes** — two-layer street-art stencils,
   Scherenschnitte — great as long as bridges/strokes stay thick.

**Avoid:** engraving, etching, crosshatching, halftone, pencil shading,
photorealism, thin calligraphy. Tone gradients cannot exist at this
resolution — our tabby engraving test reduced to an unreadable mass.

## Rules of thumb while drawing

- Smallest feature that survives: **2×2 cells**. Smallest stroke: **1 full
  cell wide**, drawn on the grid (whiskers at exactly 1 cell read great).
- One subject, cropped like an icon — **head, not body**; object, not scene.
- Big connected masses beat scattered detail. Put identity into 2-3 bold
  features (eyes, ears, one prop).
- Compose around the three reserved corner squares (template below) — they
  can read as "frame". The bottom-right region is our tightest area
  technically; keep must-have details center / upper-left when possible.
- Parts of the drawing may extend *outside* the code as normal vector art
  (our Hex poster's ears and whiskers) — free detail, no constraints.
- Slight asymmetry and wobble are assets: they hide our error pixels.

## Deliverable

- Use `qr-art-template.svg` (the 41×41 grid with reserved cells marked).
- Exactly three flat colors: `#000000`, `#FFFFFF`, `#808080` (gray = the
  free static tone). No anti-aliasing, no gradients, no other colors.
- PNG at 410px+ (10× the grid) or the SVG itself. Nothing drawn on
  reserved cells.
- We'll run it through `qr-art-studio.html` and send back the scanning
  code within minutes; expect one round of "nudge this feature a cell"
  notes. With a short URL (see notes doc) the transfer is essentially
  lossless — our three grammar demos hit 98.5-99.9% pixel match.
