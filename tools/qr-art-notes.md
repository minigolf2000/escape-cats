# QR art notes 🐈‍⬛

Companion notes for [`qr-studio.html`](./qr-studio.html) — how the
Disney-poster style of QR art actually works, and what the studio does about
it. The committed [`cat-qr.png`](qr-art/cat-qr.png) / [`cat-qr.svg`](qr-art/cat-qr.svg)
were generated with the studio's cat preset (v6, EC level L, flip budget 50%,
hard cap 80%, scheme+host case play, 64 restarts) and encode
`https://github.com/minigolf2000/escape-cats` (private repo — scanners who
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
[`hex-poster.svg`](qr-art/hex-poster.svg) / [`.png`](qr-art/hex-poster.png) do this for
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

## Which art styles survive module resolution

Two more source artworks are baked in as presets ([`ink-cat.png`](qr-art/ink-cat.png),
[`tabby-cat.png`](qr-art/tabby-cat.png), head-cropped; loaded through the studio's
**line art** mode — tri-tone with despeckling and whisker-stroke rescue).
What they taught us:

- **Bold ink/flat art translates beautifully.** The scratchy ink cat reads
  at v6/41px ([`ink-cat-qr.png`](qr-art/ink-cat-qr.png)) — big black masses, white
  eye shapes, and a style whose own chaos absorbs solver misses as
  "scratchiness".
- **Engraving/hatching art doesn't.** The tabby's identity lives in fine
  tonal gradients; at 41-49px the hatching correctly becomes the free noise
  tone, but the face reduces to a suggested dark mass (full-body is pure
  mud — crop to the head, always). A silhouette treatment loses the stripes
  AND the face. The real fix is a redraw into bold three-tone shapes —
  that's the human-taste layer again, not a threshold to tune.
- **Full body vs head:** at poster-code sizes you get roughly 30×30 usable
  modules of art; a face needs most of them. Crop first.

## v2: the live painter

The workbench became a single live canvas: black/white pixels are promises,
noise is surrendered, and the code re-solves under the brush (~6ms per
solve; paint-order priority, so earlier strokes pin first and any failures
surface at the cursor). Over-budget paint is annotated red, never blocked —
which also means **the rendered code always scans**; illegal paint just
isn\'t honored. On idle (350ms) a background pass tries all 4 EC levels x 8
masks (~110ms total) and adopts a config per `ADOPT_POLICY` in the app
source: adopt when it satisfies more paint, or pre-emptively when headroom
is nearly gone and the alternative buys meaningfully more. Because
feasibility depends only on the current pixels (never the path taken),
lazier policies lose nothing permanently — the policy only tunes meter
rhythm versus noise-field stability.

## Shift: the straight runs the art is made of

Everything above is one long argument that what survives 41 modules is flat,
bold, iconic shapes — so the painter borrows the constraint every pixel editor
has. **Hold Shift and the run snaps to the nearest of eight compass directions**
— H, V and both 45° diagonals. Two gestures reach it: **drag** one out from
where Shift went down, or **click** to run there from the last cell painted.

It buys more here than tidiness. Paint order is pin priority, so a module
wobbled off an edge doesn't merely read wrong: it spends a pin on a cell that
reads as nothing, and the budget meter is what pays for it.

**The click snaps too, and that is the point of it.** A gesture naming BOTH of
its endpoints looks like it has nothing to infer — but that confuses inference
with intent. What an artist wants from it is an *aligned* run: the click
chooses a direction and a length, not an arbitrary landing cell. Snapped, eight
sloppy clicks close a clean octagon; free-angle, the same eight give eight
subtly wrong edges. The cost is that two arbitrary points can no longer be
joined with Shift — draw that freehand.

### One rule, two ways to name the far end

The gestures differ in exactly one thing: how the far end arrives. That is the
seam the code is cut on — `axisFrom` picks the ray, `alongAxis` projects onto
it and clips to the board, and both gestures are those two calls.

A **click** names its far end outright, in one event, so it snaps once and runs:
no aiming phase to sit through, nothing to latch against a second guess.

A **drag** names its far end only by where the wrist happens to be, and re-asks
on every move, so it adds the two things only a continuous gesture needs:

- **It aims before it commits.** Nothing is painted, and no direction is
  chosen, until the pen is `LOCK_MIN` (5) modules from the anchor. Two modules
  out, (2,1) and (2,2) are a few degrees of wrist apart yet land in different
  sectors, so a direction picked there is a coin flip. At 5 modules a
  two-module wobble is 21.8°, inside the 22.5° sector boundary.
- **Then it latches.** The direction holds for the rest of the drag, so no
  wobble can flip it, and it must not be re-read per move: the run between two
  successive answers gets STROKED, and that spur is the thing the lock exists
  to prevent. Re-aim by bringing the pen back inside `LOCK_MIN`, where nothing
  was laid down, so changing your mind is free.

Shift is read live off each event instead of being latched at pointerdown, so
it can be taken up and dropped WITHIN one drag: pressing it re-anchors the
constraint at the pen's current cell, which is how you lay a staircase of
locked segments without ever lifting. A press that becomes a drag anchors where
the POINTER went down, not where its join happened to land — the join is a
finished action, and the drag's direction shouldn't depend on whether one ran.
The brush preview follows the PAINT rather than the pointer, because under a
lock the two part company and the cell about to change colour is the honest one
to outline.

## The canvas is a viewport, not a scale

Changing the canvas (v2-v10) used to nearest-neighbour resample the drawing
into the new size. For pixel art that is the wrong operation at every ratio:
41 → 45 modules turns some 2-module strokes into 3 and leaves others at 2, so
every diagonal grows a kink and every outline a bulge, and there is no way to
draw the art back to what it was short of repainting it. A module is a promise
about one cell; the canvas is how many cells there are.

So a canvas change now **moves** the art and never scales it: every painted
module keeps its offset from the centre (sizes step by 4, so that offset is a
whole number and the middle module stays the middle module). A bigger canvas
grows noise around the same pixels; a smaller one crops at the edge, which is
lossy and says so in the pin count. Cells that land under the new size's
function patterns are kept, not dropped, the same way the arrow keys keep them:
the solver ignores them, and moving the art or growing the canvas again brings
them back out. The change is one undo step, as before.

This is also how you carry a finished drawing between canvases: pick the size
where the URL fits with headroom and the corner furniture frames the shape,
then nudge with the arrow keys. Nothing about the art itself changes.

## Select: box it, move it

The select tool (S) is the Paint marquee, and only that: drag out a box, then
drag the box (or press the arrows) to move what is inside it. Enter or a click
outside sets it down, Escape puts it back, Delete clears it, Ctrl+C / X / V
copy, cut and paste it, Ctrl+A boxes the whole canvas. Whole modules only,
never a rotate or a scale — the same rule as the canvas change above.

The model is *lift, place, set down*. Lifting copies the boxed cells (tone and
paint order) into a float and keeps two whole-grid snapshots: the grid as it
was, and the grid with the box cleared to noise. Every placement recomposes
the live grid as the cleared one plus the float stamped at its offset, and
three choices in that stamp are the ones that matter:

- **Only painted float cells stamp.** The noise in a box is nothing, not an
  eraser, so a ragged shape can be dragged across the drawing without wiping
  a rectangle of it.
- **Cells hanging off the board are simply not drawn**, and reappear if the
  float is dragged back on — nothing is lost until it is set down.
- **Cells that land under function patterns are kept** and ignored by the
  solver, exactly as the arrow keys have always kept them.

Because the live grid is always the composed grid, the solver, the meter, the
renderer and the autosave never hear about floats — the code keeps re-solving
under the drag at the usual ~6ms. Setting down turns the difference between
the "as it was" snapshot and the grid into ONE undo record; cancel is that
snapshot again. Paste lands *in place*, floating over the spot it was copied
from (clamped onto the board if the canvas shrank), with fresh paint order so
a copy pins after everything already down: paste + arrows is "duplicate and
nudge". Everything that replaces the grid wholesale — undo, redo, a canvas
change, a preset, an import, switching to a brush — sets any float down first
and takes the box away, so a float can never be orphaned over a grid it was
not lifted from.

## The URL is the save file

The studio has no server, so a shareable drawing was always going to be the
whole state in a hash. What changed is *when* it gets written: the hash now
tracks the canvas continuously (debounced) instead of being minted by a
button, which makes the address bar itself the share affordance.

Three things about that were decided rather than defaulted:

- **`replaceState`, never `pushState`.** A history entry per edit turns Back
  into a stroke-level undo and traps you in the page — you press Back to
  leave and get your own drawing again, forty times.
- **Debounced, not per-pixel.** Two independent reasons, either sufficient:
  browsers rate-limit the history API (Safari throws past ~100 writes/30s,
  Firefox past its own), and an address bar re-rendering under the brush is
  motion in the corner of your eye while you're trying to draw. The natural
  unit isn't a time slice anyway — it's the *action*, the same one the undo
  stack records. Reusing the existing 250ms autosave timer gets that for
  free: it only fires once the pointer stops, so a drag of 200 paint events
  is one write. `HASH_MIN_MS` is the floor under anything that could still
  oscillate.
- **A blank canvas keeps a bare address.** Growing a 300-character hash on
  a page you just opened is startling and buys nothing. Once the URL carries
  the drawing it keeps tracking it, so *clearing* the canvas updates the
  link — the one case where laziness would leave stale art in something
  copyable.

The copy button stays. The URL bar holds the same string, but the button is
one click instead of ⌘L ⌘C Esc, and it is the only thing on screen that says
the drawing is a link at all — a silently mutating address bar teaches
nobody what it's for. The `saveNote` under it now says so out loud.

Real wins beyond convenience: two studio tabs stop fighting over one
localStorage key (each restores its own hash), and the drawing survives in
browser history, a bookmark, and Reopen Closed Tab. Real cost: those
monster URLs land in omnibox autocomplete, and they're in any screen share.

Undo/redo is the classical two-stack pair, and the trick that keeps it small
is that an undo record is symmetric — a record is the cell values that were
there *before* an action, so capturing what you're about to overwrite gives
you the record that puts it back. `applyRec` returns its own inverse, undo
and redo are that one function pointed at opposite stacks, and neither has
to know which action it's walking over (a canvas resize is a whole-grid
snapshot and rides the same path). Redo is unbound from any button on
purpose but answers both platform conventions, ⇧⌃Z and ⌃Y. ⌃Z with the caret
in the link field is the *field's* undo — the browser owns that keystroke —
while sliders and checkboxes, which have no native undo to defer to, keep
the drawing's.

The **binding** is platform-blind on purpose: `ctrlKey || metaKey` covers
both without asking which OS it is on, so there is no `navigator.platform`
branch anywhere in the handler. The **label** is the one thing that can't
dodge the question — printing ⌃Z on a Mac names a chord that doesn't work —
so that single glyph, and only that, is swapped at boot. (The tempting
alternative, letting the browser deliver the intent as a `beforeinput` with
`inputType: "historyUndo"`/`"historyRedo"`, does exist and does normalise ⌃Y
for you. It's a dead end here: those events only fire on an *editable* host
whose native undo stack is non-empty, so a canvas needs a hidden
contenteditable decoy kept permanently primed — and `preventDefault`-ing the
undo means the browser never advances its own cursor, so the redo event never
arrives at all. More platform-specific machinery than the three keys it
would replace.)

## Answering the workflow question

Yes — codes like the posters are an *iterative, human process*, and the tool
the pros use is essentially what the studio implements: a module-level pixel
editor with a live decoder and an error-budget meter, on top of a solver that
gets ~95% of the way. "Likelihood it still scans" isn't vibes; it's exact
arithmetic — `capacity − errors` per block — plus real-phone tests before
print, because print adds its own damage (keep ≥2 codewords of headroom, more
for posters).
