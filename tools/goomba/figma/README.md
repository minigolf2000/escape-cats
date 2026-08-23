# Designing Goomba Glider levels in Figma

The Figma half of a bridge whose goal is: draw a level in Figma, get it playable
without hand-editing `levels.ts`. Two generated SVGs, a live component kit in
Figma, and the naming contract that makes them mean something.

```sh
node make-pack.mjs        # -> figma-pack.svg     (the kit you design with)
node levels-to-svg.mjs    # -> figma-levels.svg   (every shipped level)
node levels-to-svg.mjs 1 3   # just those two
```

## What already exists in Figma

Built via the Figma MCP server into `vRN6Q44ReIaESP5wv8M2dI`, on two pages of
its own so the existing sketch page is untouched. Both sit on the game's page
purple, `#150a2a` — the same value as `html, body` in the app.

- **Goomba Kit** — six components at true world scale carrying **the game's own
  art**: `start` (the goomba on her dashed pad), `goal` (the thirsty spider
  plant), `watering-can`, `bumper`, `party-popper`, `cushion`.
- **Goomba Levels** — one real **Frame** per shipped level, named
  `L: <title>`, filled with `drawBackground`'s vertical gradient
  (`#241245 → #170b30 → #12081f`), terrain as cream zero-height Lines, toys as
  instances of the kit, and each level's baked solution as a dashed `band` in
  that player's colour from `BAND_COLORS`.

Component names deliberately match the names **already in use in that file**
(`party-popper`, `watering-can`, `bumper`, `start`) rather than importing a new
vocabulary. The reader accepts both those and the short code-side forms.

### Where the art comes from

`apps/goomba-glider/art/export-svg.mjs` — the repo's existing "SVG exports for
design work" script, which mirrors the canvas painters by hand. It already
covered the can and both plant states; it now also exports `goomba.svg`,
`party-popper.svg`, `bumper.svg` and `cushion.svg`, each a **still frame** with
every animation term zeroed (no bob, no pulse, no drip phase, no dash march,
`hot = 0`, `crouch = 1`). Everything is emitted at 10 px per world unit, which
is exactly this kit's scale, so an export drops straight in.

That file's own warning still applies, and now applies to four more props:
**the game does not load these.** `main.js` draws every prop procedurally, so
retuning art there means re-running the export and re-importing here.

```sh
cd apps/goomba-glider/art && node export-svg.mjs
```

Two deliberate departures from a pixel-exact copy:

- **One Line per terrain segment.** The game paints each polyline three times —
  a wide translucent halo, the cream core, then a dashed pink centreline. In
  Figma that would be three stacked nodes per segment, and dragging one would
  leave the other two behind. Editing is the whole point, so the frames carry
  the cream core only.
- **The kit's glyph radii are the *collision* radii**, not the art's extents.
  A watering can's art is smaller than her 9.7 u reach for it; the popper's
  dashed ring is the real 6 u trigger. That mismatch is information, and it is
  the reason the rings are drawn at all.

## Why everything is a Line

**Draw terrain with the Line tool (L). Never the pen — and never an SVG import.**

The last of those is the one that costs a round trip, because it looks like it
worked. `make-pack.mjs` and `levels-to-svg.mjs` emit real `<line>` elements, and
the game's own SVG reader takes them — drop one of those FILES on the grid and
the terrain reads. Import the same file into **Figma**, though, and every
`<line>` becomes a **VECTOR** node. It keeps the id as its layer name, so the
layers panel fills up with a convincing row of `t-1`, `t-2`, `t-3`… and nothing
says otherwise until the paste banner reads *"t-1" is a VECTOR, not a Line —
skipped*. Both readers refuse it deliberately (`clipboard.js` on
`n.type !== "LINE"`, `svg.js` on `localName !== "line"`) and that refusal is
the right call: for anything but a Line, `(0,0)-(width,0)` is the top edge of a
bounding box, which arrives as a perfectly plausible straight segment that
silently changes whether the level is winnable. A layer that goes missing is a
bug you can see; a wrong one is not.

So the generated sheets are a kit to READ and TRACE OVER, not a kit to paste in
and keep. Terrain gets into a Figma frame two ways only: the Line tool, or the
Plugin API's `figma.createLine()` (which is how the level frames in this file
were built in the first place).

A Figma line is a zero-height node: its geometry is entirely position + width +
rotation, all sitting in the plain node record where any reader can get at it.
A pen-drawn path instead keeps its points in a compressed vector-network blob —
effectively unreadable from a clipboard payload. Verified on the generated
frames: all 43 terrain lines in *The Long Way Up* report `height: 0`.

And it costs nothing:

> `segsFor` in `packages/shared/src/goomba/physics.ts` flattens every terrain
> polyline into independent segments before collision. A bag of separate
> segments is *physically identical* to an authored polyline.

Which also answers "how do I make a smooth surface": you don't need one. A
curve is a fan of lines, and to her that fan **is** smooth. The pack ships
computed arcs (crest, quarter-pipe, hill, and the **momentum arc** that turns a
horizontal popper into height) as worked examples. `node ../pipe.mjs --svg
arc.svg` cuts a momentum arc to your own popper and writes a one-piece sheet to
import. The only rule is
the one in the gauges: never let two segments come closer than 4.4 u (2 × her
radius) or she wedges in the corner and the run stalls.

## The contract

Layer **names** carry all the meaning. Position comes from the node.

| Layer name | Node type | Becomes |
| --- | --- | --- |
| `L: <title>` or `L--<title>` | Frame | one level; the frame's origin is world (0,0) |
| `L: <title> @145` | Frame | …and raises the level's `maxSpeed` to 145 |
| `t` | Line | one `terrain` segment |
| `start` | anything | `start` — bbox centre |
| `goal` | anything | `goal` — bbox centre |
| `watering-can` / `can` | anything | a `cans[]` entry — bbox centre |
| `bumper` | anything | a `bumpers[]` entry — bbox centre |
| `cushion` | **Rect** | `{x: left, y: centre, w: width}` — horizontal only, rotation ignored |
| `party-popper` / `pop` | anything | a popper at bbox centre; `deg` from rotation |
| `band` | Line | an entry in `solution` — optional, documentation only |
| `_…` or `//…` | anything | **ignored** (gauges, guides, notes) |
| any Text | text | **ignored**, always |

Rules that keep it forgiving:

- **1 unit = 10 px.** Levels are ~110 × 200 units, so 1:1 would be a postage
  stamp. Verified exact on the generated frames: a can at world (80, 57) lands
  at frame-local (923, 490) with the level's padded bounds offset.
- **y is DOWN** in this game, same as Figma. No flipping, no surprises.
- **Popper speed** rides in the name as trailing digits: `party-popper 150`,
  `pop150`. A bare `party-popper` means 76.
- **Rotation:** `deg = -rotation`. Figma's `rotation` is counter-clockwise
  positive; the game's `deg` feeds `cos`/`sin` in a y-down world, so it is
  clockwise positive. Measured, not assumed — poppers placed at game deg
  `-6/-46/-59/-87` read back from Figma as rotation `+6/+46/+59/+87`.
- A trailing `-<digits>` is stripped from every name, so Figma duplicates and
  the generated `t-42` ids both land on `t`.
- Toy glyphs are **symmetric about their anchor**, including the popper, whose
  aim arrow is drawn inside its trigger ring so the bounding box stays square.
  That is why bbox-centre is exact rather than approximate.
- **Why individual components and not one variant set:** an instance inherits
  its component's name, which is exactly what carries the meaning here. A
  `toy` component set with a `kind=can` variant would name every instance
  `toy` and push the meaning into variant properties the clipboard path can't
  read. Six components keep the contract legible in the layers panel.

## The paste target

**The game itself**, behind `\`. There is no separate editor page any more —
the level SELECTOR is the paste target, so a frame goes from Figma into the
event's level pack without ever leaving the game.

```
copy a frame in Figma  →  \  →  Ctrl+V on the grid  →  src/figma/  →  the pack
```

The readers live in `apps/goomba-glider/src/figma/`: `clipboard.js`, `svg.js`,
`stitch.js`, and `paste.js` (which decides which of the three shapes arrived).

**Just copy in Figma and paste here.** A plain `Ctrl+C` puts a `fig-kiwi`
payload on the clipboard and `src/figma-clipboard.js` decodes it — that path
carries the real layer names and each node's *stored* geometry, so it needs
none of the SVG path's corrections, and the `anchor` dots are not even used.
The travelling Kiwi schema means `kiwi-schema` decodes the wire format
generically; the only Figma-specific knowledge is which fields to read
(`name`, `type`, `transform`, `size`, `parentIndex`).

Four things about that payload were only learnable from a real copy, and all
four are things a synthetic fixture happily got wrong:

- the buffer closes with **`(/figma)`**, not a second `(figma)`;
- the two blocks are compressed DIFFERENTLY — the schema is raw deflate, the
  message is **zstd** (`28 b5 2f fd`). Chrome has no
  `DecompressionStream("zstd")` as of 151, hence `fzstd`;
- a copy also ships the **Document, Page and component-definition** nodes, so
  scanning every node found four watering cans instead of two — one of them the
  component itself, sitting over on the kit page. Walk DOWN from the level frame
  instead, and stop descending at anything that matches, because a component's
  inner art repeats the component's own name;
- the frame's own transform must be dropped: its canvas position is not part of
  the level.

`node test-clipboard.mjs` covers the wrapper and field handling on synthetic
payloads. `node test-real-copy.mjs` runs the real thing —
`fixtures/real-figma-copy.b64`, an actual Ctrl+C of the level 1 frame — and
asserts it reproduces `levels.ts[0]` exactly, segment for segment, up to that
uniform translation. That fixture is the only test here made of real data, and
it is the one that caught all four.

Also accepted: drop an exported `.svg` file, paste that file's text, or paste
one of our own level links.
`fixtures/sample-figma-clipboard.html` is a synthetic-but-valid copy you can
feed the decoder without Figma open.

**Export, do not "Copy as SVG".** Figma only writes layer names into SVG when the
`id` attribute is switched on, and it is **off by default** — measured on the
same frame, the exporter emits 111 ids with the flag and 3 without (just the
gradient defs). "Copy as SVG" gives you no way to switch it on, so that route
arrives with every name stripped, including the `L:` frame wrapper. Since names
are the entire contract, the reader has nothing to read and says so.

Every level frame in the Figma file now carries an SVG export preset with the
flag baked in, so **select the frame → Export → drop the file** is enough. If
you are setting up a new frame by hand, the checkbox is under Export → the `…`
beside the format → `Include "id" attribute`.

The reader hands the SVG to the **browser's own SVG engine** rather than parsing
geometry by hand — it parks the document off-screen and asks `getBBox()` and
`getCTM()` for boxes and accumulated transforms — which is why nested groups,
clip paths and rotations all come out right without any matrix code of ours.

Two things it has to know about Figma's exporter, both measured against the file
rather than assumed:

- **Lines come out shifted by half their stroke.** Figma *stores* the first
  terrain segment of level 1 exactly (`x 180, y 220, width 356.93`) but exports
  it inset by half the stroke at each end and offset half a stroke
  perpendicular. `unshiftStroke` undoes that, deriving the amount from the
  `stroke-width` on the same element. Verified: the correction returns the two
  segments of the smoke test to `(100,100)→(400,160)` and `(400,160)→(700,140)`
  — and they still *share* the middle vertex, which is what proves it is exact
  and not merely close.
- **Export drops a component's transparent padding**, so a group's bounding-box
  centre is *not* the anchor — the goal would land 1.5 units low. Every kit
  component therefore carries a small `anchor` dot, and the reader takes its
  position and its rotation (`atan2(b, a)` off its CTM, which is the game `deg`
  directly). Miss the dot and the reader falls back to the bounding box **and
  says so** in the banner.

Because both of those lean on undocumented exporter behaviour, a pasted level is
only ever *proposed*: nothing throws if Figma changes, the geometry just drifts
half a stroke. That is exactly why the copy-link button stayed —
`node verify.mjs --hash <link>` is the thing that actually proves a level.

## One Line per segment, one polyline per surface

Figma holds terrain as one Line each, so a surface drawn as a run of connected
Lines arrives as N separate two-point polylines. That is already the right
SURFACE — `segsFor` flattens every polyline into independent segments before
collision, so she cannot tell the difference — but it is not the right PICTURE.
The game strokes each polyline as its own path with `lineCap: "round"`, three
times over (a 4.4 u collision halo, the 1.5 u cream core, the pink centreline),
and a round cap overhangs its endpoint by half the stroke. So every shared
vertex in a pasted level grew two stubs — 2.2 u of halo and 0.75 of core poking
past the joint — where a hand-authored polyline has one clean `lineJoin`. On a
shallow chevron that reads as a slightly swollen corner; on the ~90° elbow in
level 1 it reads as a blunt knee.

`stitchTerrain` (`apps/goomba-glider/src/figma/stitch.js`, used by BOTH readers)
chains segments back into polylines. It grows a chain from BOTH ends and accepts
a segment drawn in either direction, because neither is information about the
surface: which way a Line points is which way the designer dragged it.

**It welds, and the tolerance is measured rather than guessed.** The first
version required endpoints to be EXACTLY equal, which was measured against the
GENERATED frames — whose coordinates come out of `levels-to-svg.mjs` and agree
to the last decimal — and is useless on a hand-drawn one. On *2 · The Long Way
Up* as actually drawn in Figma: **seven joints, one exact, the rest 0.3 to 1.8
units apart**. A person dragging a line end lands near the last one, not on it,
and the 15 px stroke hides the difference. Exact matching chained almost
nothing, so its eight floor Lines stayed eight polylines and the round-cap stubs
came straight back.

`WELD` is 2.0 units. The ceiling comes from this game's own rule — no two
terrain segments may come closer than **4.4 u** (2 × her radius) or she wedges
in the corner and the run stalls — so a pair of endpoints closer than that is
never a deliberate separation, it is one joint drawn by hand. 2.0 sits above
every real joint measured (worst 1.84) and well below where deliberate geometry
starts; the band between is a no-man's-land it stays out of. A 45-58 u "one band
goes here" gap is never touched. Welding keeps the point already in the chain
and drops the incoming near-duplicate, so nothing moves by more than 2 units.

With it, that level's eight floor Lines become one nine-point polyline that
traces exactly what was drawn: floor, down into the notch, across, up the far
wall, along, then the ramp. Ten polylines became four; all 24 segments survive.

**Chaining takes the NEAREST endpoint, not the first one inside the weld.** On
hand-drawn geometry those are the same thing — the game's 4.4-unit floor means
only one candidate is ever within 2 units. They stop being the same thing on a
curve drawn FINER than the tolerance, which a momentum arc is: a 90° quarter of
radius 8 cut into 24 lines has 0.52-unit chords, so both ends of the next
segment, and the two segments after it, are all inside WELD. A first-match rule
then chained whichever the loop reached first — i.e. the direction a Line
happened to be dragged and where it sat in the layer panel, neither of which is
information about the surface — and the arc came back scrambled, with vertices
moved by up to a full 2 units (4.4 on a 3.2-unit arc). Nearest-wins reproduces
the drawing exactly at any tessellation, in any order: 0 of 40 perturbed orders
survived before, 40 of 40 after. `test-stitch.mjs` covers it at r 3.2, 8 and 26.

**T-junctions get snapped too.** Chaining is end-to-end, which is the wrong
shape for the commonest thing anyone draws: a platform butting into a wall ends
near the wall's MIDDLE, nowhere near either of the wall's own endpoints, so no
amount of end-to-end welding touches it. Read off the file, level 1 stores its
start platform at `x 124` and its wall at `x 133` — the platform ends 0.9 units
past the wall's centreline. In Figma that is a sliver hidden under a 15 px
stroke. In game the same 0.9 units hangs off a **4.4-unit collision halo**, and
reads as a stub sticking out of the wall. The geometry is faithful; the drawing
is just three times wider, and what was invisible at design time is not
invisible at play time. So a loose end within `WELD` of another polyline's body
is pulled onto it. This does NOT chain the two — a T is not a chain.

Terrain must still be a **Line**. A `t` that is a pen path or a rect is skipped
with a warning by both readers, because `(0,0)-(width,0)` on one of those is the
top edge of its bounding box — which can be nowhere near the shape drawn, and
would arrive as a plausible straight segment that silently changes whether the
level is winnable. A named layer that goes missing is a bug someone can see; a
wrong one is not.

`node test-stitch.mjs` covers the chain, the gap that must survive, the
backwards-drawn segment and the closed loop. The real-copy fixture now decodes
its seven Lines into five polylines.

## Testing this bridge (read this before debugging it)

Two rounds of "geometry looks slightly off" were closed by reasoning about the
code and shipping a fix that passed its own tests. Both were wrong, for the same
reason, and the fix that worked came from a different method. Do it this way:

**1. Ground truth is Figma's Design panel, not the fixture.**
`fixtures/real-figma-copy.b64` is a real Ctrl+C, but of a frame that
`levels-to-svg.mjs` GENERATED — so its coordinates agree to the last decimal.
Every conclusion drawn from it about "what a Figma frame looks like" is a
conclusion about machine output. Hand-drawn frames are the only kind that
matters now and they behave nothing like it: joints land 0.3-1.8 u apart, and
platforms meet walls in the middle rather than at an endpoint. Open the real
file, select the Line, and read `X / Y / W / Rotation` off the panel.

**2. Prove where the bug ISN'T, first.**
The decisive step both times was comparing ONE line's panel numbers against the
decoder's output for that same line. The platform reads `X 124, Y 215, W 377.04,
rot -4.26°` and decodes to `[12.4,21.5]-[50,24.3]` — exact. That one check moves
the question from "the reader is buggy" (it is not, it never was) to "the
drawing does that, and the game makes it visible", which is a different fix.

**3. The game's stroke is 3x Figma's.** Terrain draws a **4.4 u collision halo**
under a 1.5 u core; Figma draws the 1.5 u core alone. Sub-unit slop that is
invisible while drawing is glaring while playing. Most of "it looks off" lives
in that asymmetry rather than in the numbers.

**4. A/B with level LINKS, never by re-pasting.**
Encode both geometries and load each one — the camera, the crop and every other
variable are then identical and the diff is the two numbers you changed. Pasting
twice is not a controlled comparison: the clipboard needs focus, silently does
nothing when it does not have it, and you cannot tell a failed paste from a
no-op fix.

**5. `#hash` is read ONCE, at boot.** Navigating from `?solo#A` to `?solo#B`
changes only the fragment, so the page does not reload and the level does not
change — you get two identical screenshots of the same state and no error.
Change a query param too (`?solo&v=2#B`), and assert the geometry from the page
(`window.__goomba.LEVELS[0].terrain`) before believing any screenshot.

**6. Run the counterfactual.** "Did my change cause this?" is one edit away:
set `WELD` to 0 and re-decode. That killed a whole false lead — the ratchet
teeth READ as separate bars in Figma, and turned out to have been one chain all
along, so the weld was not what joined them.

## The loop, end to end

Nothing here touches `levels.ts` until a level has earned it:

```
Figma frame  →  Ctrl+C  →  Ctrl+V at /editor/  →  ▶ play
                                      ↓
                                 copy link  →  node verify.mjs --hash <link>
```

Every step of that is exercised. Reading the smoke-test frame back gave the
level below, matching the coordinates it was built from **exactly** — terrain,
band, start, goal, can, bumper, popper (`deg -37`, `spd 137` off the layer
name) and the cushion's 20-unit span:

```
terrain [[10,10],[40,16]] [[40,16],[70,14]]   band [[15,30],[50,32]]
start [12,8]  goal [65,50]  cans [[30,25]]  bumpers [{50,40}]
pops [{20,45,deg:-37,spd:137}]  cushions [{35,52,w:20}]
```

and the link it copied went straight into the bench:

```
link Smoke Test  (--quick: smaller samples)
  ok    bare run fails — fall@2.93s
  FAIL  solution is 4 bands (party rule) — 1 band(s)
  → FAIL ✗ (solution is 4 bands (party rule))
```

which is the gate doing its job: a scatter of props is not a level, and it says
so about geometry that never entered the repo. No new protocol, no server
change, no `GOOMBA_LEVELS` mutation.

## Three ways to read a Figma design back out

1. **Figma MCP** — confirmed working in this repo's workflow; it wrote the kit
   and the level frames, and it can read node trees, names, transforms and
   variant properties back. Needs the Dev Mode MCP toggle on in the desktop app.
2. **A local Figma plugin** — the only path that works with no MCP server
   running, and the one that also exposes `vectorNetwork` if pen paths ever
   become necessary.
3. **Clipboard paste** — Figma's `data-buffer` is an inflated `fig-kiwi`
   payload whose Kiwi schema ships inside it, so `fig-kiwi` on npm decodes it
   with no private schema. Undocumented, and it can drift when Figma ships.

## What the pack contains

- **Terrain** — slopes 0 / 0.12 / 0.25 / 0.4 / 0.6 / 1.0 and a wall, labelled
  with what each does to her.
- **Curves** — crest (launch), quarter-pipe (catch and flatten), smooth hill.
- **Composites** — V-basin, the gap module (steep run → uphill shelf → 45–58 u
  gap → far shelf with the can on it), closed slab with 12 u of belly,
  switchback wall, popper lane at 16 u.
- **Toys** — collision-radius markers. The Figma components carry the real art;
  these are the reach rings that art does not show.
- **Gauges** — 58 u band stretch, the 45–58 u "needs exactly one band" window,
  6 u minimum band, 4.4 u wedge distance, 16 u popper spacing, 34 u maximum
  launch rise, her 2.2 u radius and the 5 u snap ring.

Every number comes from [`../DESIGNING.md`](../DESIGNING.md), which stays the
source of truth for *why* a level works. Note two facts that moved recently and
are already reflected here: collectibles are **watering cans** (`cans`, not
`plants`), and terrain restitution is now normal-dependent — floors stay dead at
0.02 while a vertical wall hands back 0.15.
