# Hexahexaflexagon animations

Educational 3D animations of the hexagonal paper toy, and a script that
renders either page to an mp4 or a looping GIF.

- **`index.html`** — folding a hexahexaflexagon (six faces) from a flat strip
  of nineteen triangles to the finished hexagon.
- **`flex.html`** — the pinch flex: how you interact with a flexagon once it's
  made. Pinch to a three-bladed star, bloom open, a hidden face appears; three
  flexes loop through faces 1 · 2 · 3 seamlessly.

Standalone: nothing here touches the games, the Worker, or the build.

## The pages

Open either file in a browser (double-click works; three.js loads from
cdnjs). Play/pause, scrub, change speed; drag to orbit, scroll to zoom,
double-click to reset the view. Below the folding page's canvas: the
printable numbering, how to flex, and the Tuckerman traverse.

## The video / GIF

```sh
npm i playwright ffmpeg-static   # once, anywhere; or have ffmpeg on PATH
node render-video.mjs --out hexahexaflexagon.mp4
node render-video.mjs --page flex.html --out flex.gif --w 640 --h 400 --fps 18
```

Renders the page's timeline frame by frame in headless Chromium —
deterministic, no realtime capture. An `--out` ending in `.gif` produces a
palette-optimized infinite-loop GIF (the flex page is written so its last
frame hands off to its first). Useful flags: `--fps`, `--w`/`--h`, `--dsf`
(supersampling), `--three path/to/three.min.js` (inline a local copy and
render offline), `--chromium path` (use a pre-installed browser), `--page
path` (choose the page; relative to the script).

## What the animation asserts, and why it's true

The template is the canonical one (Wikipedia "Flexagon"; Aunt Annie's;
thinkzone.wlonk.com): front `1,2,3` ×6 then a blank tab; back blank then
`4,4,5,5,6,6` ×3. The fold plan in `CONFIG`:

- **Roll, 9 folds** — each fold at an even hinge brings a pair of equal back
  numbers face to face, tail end first. The result is a straight ten-position
  strip that shows only 1s, 2s, 3s and the two blanks.
- **Wrap, 3 folds** — at hinges 13, 7 and 1 (counting from the strip head):
  two folds wrap the roll around a hexagon, the third folds the head triangle
  back. The hinge between the tab pair and the rest stays *unfolded* — that
  flat continuation is the tuck. The tab is split along a soft bend line
  (`TUCK_F`) so it can flex like real paper: after the head fold it lies
  across the top face, lifts, then slides into the pocket under the top
  face — flexing slightly on the way in — until blank meets blank. Rigid
  plates can't thread a pocket; the flex is what real paper does there.
- **Press** — the plates settle from the hinged approximation (small gap
  angles keep layers apart) into an idealized flat stack, using the true
  per-slot layer order in `IDEAL_ORDER`.

The fold plan is not folklore: `window.__anim.analyze(t)` reports, at any
time, where every triangle sits, its facing, the stacking per hexagon slot,
and whether the two glue faces are adjacent. The finished state must come out
all-2s up, all-1s down, slots stacked 5/2/4/2/4/2 (4/2 after gluing), glue
faces touching — matching the printed instructions ("one face all 1s, the
other all 2s"). `window.__anim.sweepStates()` goes further and enumerates all
3⁹ flat-folded states of the nine leaf boundaries; exactly two families
survive the constraints, and the one matching the canonical outcome is the
one animated. If you change the fold data, run both before believing it.

The Tuckerman traverse shown (1→3→6→1→3→2→4→3→2→1→5→2) is the article's;
faces 1–3 recur three times per cycle, 4–6 once.

## What the flex page asserts, and why it's true

`flex.html` is a real kinematic simulation, not a canned morph. The band is a
trihexaflexagon's (nine rigid triangles in a closed loop — the minimum that
flexes; a hexahexaflexagon runs its main 1·2·3 cycle the same way with
thicker pats). Every frame solves the loop-closure equations, so the band
stays a genuine closed loop to machine precision (`__anim.pathInfo()` reports
the residuals, ~1e-17).

The flex path is two solved halves. Closing: the three pinch creases are
driven together into the three-bladed star, the shared valley angle solved
for closure. Opening: solved *backward* from the landed state a paper flex is
known to reach — the pinch creases finish fully folded (they become the new
pairs' folds), the old pairs' rim folds finish opened flat — then reversed.
That landing puts the old top face face-down on the bottom and brings the
hidden face up, the physical signature of a pinch flex. Marching forward from
the star instead finds a different branch: a valid plate-linkage eversion
that keeps the old *bottom* face — which paper doesn't do; `__anim.pathTable()`
lists every branch and its landed faces, and the landing check rejects it.
`__anim.allFlatStates()` enumerates all 512 flat-folded states of the band
(the landed state is one of exactly two flat uniform-face hexagons reachable
by subsets of full folds). `__anim.debugMaps()` shows the per-flex face maps
and the seam: after three flexes the landing permutation composes to the
band's own 3-fold symmetry (`leaf k → k+3`, no flips), so the loop closes
seamlessly — which is why the GIF can loop forever.
