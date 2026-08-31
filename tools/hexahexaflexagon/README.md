# Hexahexaflexagon folding animation

An educational 3D animation of folding a hexahexaflexagon — the six-faced
hexagonal paper toy — from a flat strip of nineteen triangles to the finished
hexagon. One self-contained page, and a script that renders the same timeline
to an mp4.

Standalone: nothing here touches the games, the Worker, or the build.

## The page

Open `index.html` in a browser (double-click works; three.js loads from
cdnjs). Play/pause, step through the twelve folds, scrub, change speed. Drag
to orbit, scroll to zoom, double-click to reset the view. Below the canvas:
the printable numbering, how to flex, and the Tuckerman traverse.

## The video

```sh
npm i playwright ffmpeg-static   # once, anywhere; or have ffmpeg on PATH
node render-video.mjs --out hexahexaflexagon.mp4
```

Renders ~82s of 720p24 H.264 by stepping the page's timeline frame by frame
in headless Chromium — deterministic, no realtime capture. Useful flags:
`--fps`, `--w`/`--h`, `--dsf` (supersampling), `--three path/to/three.min.js`
(inline a local copy and render offline), `--chromium path` (use a
pre-installed browser), `--page path` (run the script from another directory).

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
