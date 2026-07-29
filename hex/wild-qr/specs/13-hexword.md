# Piece 13 — the hexagon and the word HEX, drawn as one line

Follow-up to piece 12 (the snake). Same medium — a single 1-module line
through the code — but now the line *means* something: a hexagon spanning
the symbol, and the word HEX. URL `https://hexxygon.com` (short-URL freedom
is what makes line art affordable), urlCase schemehost.

## Topology note (read first — it sets the gates)

A **closed hexagon** is a perfect unicursal figure: 0 endpoints, 0 branch
points, every cell degree 2. Gate it strictly.

**Letterforms cannot be branch-free.** H has two T-junctions, E has one, X
has a degree-4 crossing. So for lettering the gate relaxes to: ONE connected
component, branch points counted and reported, exactly 2 free endpoints
where achievable. This is still "drawn without lifting the pen" (with
retracing) — which is what a viewer perceives.

## Designs

### A. `hexagon` (primary, strict gates)

One regular **flat-top** hexagon outline, 1 module wide, centered on the
symbol center, spanning as much of the code as solves cleanly.

- Geometry: vertices at angles 0°,60°,120°,180°,240°,300° about center
  (cr,cc); flat top and bottom edges (perfect horizontal runs), four 60°
  edges as clean Bresenham staircases. Edges must be uniform — a lumpy
  hexagon fails the piece.
- Search `R` (circumradius) and small center offsets for the best solve.
  **Span gate: the hexagon must span ≥70% of the symbol width.** At v10
  (57×57, center 28,28) R≈21 keeps the left vertex clear of the col-6
  timing strip; larger R needs timing bridges (allowed — piece 12 proved
  they work). Report the R chosen and any bridge used.
- The v10 center alignment pattern at (28,28) lands *inside* the hexagon as
  a centered jewel. Good — leave it as furniture, do not route around it.
- Alignment patterns the outline would clip: detour minimally and
  **symmetrically where possible** (a detour mirrored on both sides reads as
  design; a one-sided bulge reads as damage). Report every detour.
- Gates: connected, **0 endpoints, 0 branch points**, 100% line
  satisfaction, ≥2 codewords headroom, jsQR at scale 8 + 3 (toned and BW).

### B. `hexword` — the word HEX (relaxed branch gate)

Three chunky letters, 1-module strokes, spanning the code's width, joined
by travel segments so the whole thing is ONE connected drawing.

- Layout at v10: letters ~11 wide × 20 tall, on rows ~18–38, cols ~9–47
  (H at 9–20, E at 24–33, X at 37–47); nudge to fit furniture. At v6 use
  ~8 wide × 14 tall and expect a tighter fit (attempt it, report if it
  can't hold legibility).
- Join letters **at their natural stroke ends** so travel segments do not
  add branch points: e.g. H's right-vertical bottom → travel → E's
  bottom-arm tip; E's top-arm tip → travel → X's upper-left tip. Travel
  segments should read as deliberate connectors (straight/right-angled,
  not wandering).
- Legibility is the hero gate: **every letter unambiguous at 8× viewed at
  50%**. A broken or ambiguous letter fails the piece regardless of numbers.
- Gates: ONE connected component, 100% line satisfaction, branch points
  reported (expect ~4), endpoints reported (target 2), ≥2 headroom, jsQR
  scale 8 + 3.

### C. `hexword-in-hexagon` (stretch — attempt, ship only if it reads)

The hexagon from A with HEX inside it (letters scaled down to ~13 rows).
Either connect the word to the hexagon with one travel segment (adds one
branch — fine) or leave two components and report honestly. Ship only if
both the hexagon reads as a hexagon and the word stays legible; if the
budget forces mushy letters, say so and drop it.

## Deliverables

`out/hexagon-v10.png/.svg` (+`-bw.png`), `out/hexword-v10.png/.svg`
(+`-bw`), v6 versions where they pass, `out/hexword-in-hexagon.png` if it
survives, `out/hexword-contact.png` (all designs + pre-solve targets beside
solved results), and `out/hexword-report.md` (per design: gate results,
R/geometry chosen, detours, branch/endpoint counts, legibility call,
per-block meter, scans). One round of art notes expected.
