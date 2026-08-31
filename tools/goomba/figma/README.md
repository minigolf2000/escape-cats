# Designing Goomba Glider levels in Figma

The Figma half of a bridge whose goal is: draw a level in Figma, get it playable
without hand-editing `levels.ts`. Two generated SVGs, a live component kit in
Figma, and the naming contract that makes them mean something.

```sh
node make-pack.mjs        # -> figma-pack.svg     (the kit you design with)
node levels-to-svg.mjs    # -> figma-levels.svg   (a pack, one artboard per level)
node levels-to-svg.mjs 1 3   # just those two
node read-frame.mjs --nodes frame.json      # a frame in the game's units
node read-frame.mjs --clipboard copy.html   # ...from a Ctrl+C instead
```

## What already exists in Figma

File key **`vRN6Q44ReIaESP5wv8M2dI`**, three pages. The two built via the Figma
MCP server sit on the game's page purple, `#150a2a` — the same value as
`html, body` in the app — and were given pages of their own so the existing
sketch page stayed untouched.

| Page | Node id | What it holds |
| --- | --- | --- |
| **Levels** | `47:2` | one Frame per level, named `L: <title>` |
| **Components** | `45:55` | the kit: six components at true world scale |
| **Scratchpad** | `0:1` | loose sketches and reference. Nothing here is a level |

**Ask for a page by its node id.** `get_metadata` with no `nodeId` is meant to
list the document's pages, and on this file it under-reports: it answers
`Components` and nothing else. A thread that trusts that answer concludes the
levels have been deleted — one did, and it cost an afternoon and a round trip
to ask where they had gone. `get_metadata(fileKey, "47:2")` returns every level
frame with all of its children in one call. That is the door; the page list is
not.

- **Components** — six components at true world scale carrying **the game's own
  art**: `start` (the goomba on her dashed pad), `goal` (the thirsty spider
  plant), `watering-can`, `bumper`, `party-popper`, `cushion`.
- **Levels** — one real **Frame** per shipped level, named
  `L: <title>` — **the title alone, never a number.** The frames used to read
  `L: 2 · The Long Way Up`, which stored a level's place in the pack inside a
  string in another application; `levelLabel` makes the number from the pack
  itself now, so one written here could only go stale the first time anyone
  reordered anything. Filled with `drawBackground`'s vertical gradient
  (`#241245 → #170b30 → #12081f`), terrain as cream zero-height Lines and toys
  as instances of the kit. **A frame carries no bands.** It used to carry the
  level's baked solution as dashed `band` Lines, which the readers turned back
  into a `solution` field and the selector's cards graded — an answer key drawn
  by hand, stale the moment the geometry moved beneath it. There is no such
  field any more (codec fmt 2). A frame is the GEOMETRY; what
  solves it is for the people playing it to find.

`L: Welcome to Goomba Glider` is the teaching level, and the frame to copy if
you want the smallest thing that is still a level: two `t` Lines with a gap
between them, a `start`, one `watering-can` and a `goal`. Nothing else.

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
**the game does not load these.** `render.js` draws every prop procedurally, so
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

## Lines, rectangles, ellipses — and never the pen

**Draw terrain with the Line tool (L), the Rectangle tool (R) or the Ellipse
tool (O). Never the pen.**

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
computed arcs (crest, quarter-pipe, hill, loop-the-loop) as worked examples. The
only rule is the one in the gauges: never let two segments come closer than
4.4 u (2 × her radius) or she wedges in the corner and the run stalls.

Which is also why the curves are GENERATED rather than drawn. Nobody places
twenty-seven Lines around a circle by hand, and the loop is the shape that makes
that obvious: `loop()` in `svgkit.mjs` returns its arms, its entry popper's
position and aim, and the slowest `spd` that still holds her at the top. Copy
the piece out of the pack and stretch it; the numbers under it in the sheet were
computed by the same call that drew it.

## The contract

Layer **names** carry all the meaning. Position comes from the node.

**A toy is identified by the COMPONENT it is an instance of, not by what its
layer is called.** Rename an instance to anything you like — Figma's own
duplicate numbering included — and it still reads as what it is. That numbering
is exactly why the rule changed: twelve poppers copy-pasted round a sketch
arrive named `party-popper 138` through `party-popper 149`, and the reader used
to take those digits as twelve different SPEEDS nobody chose.

Only the two things that are not components answer to their names, because
there is nothing for them to be instances OF: `t` and `cut`. Both ignore
trailing digits and a `-42` suffix, so Figma duplicates land on the same word.

| Layer / component | Node type | Becomes |
| --- | --- | --- |
| `L: <title>` or `L--<title>` | Frame | one level; the frame's origin is world (0,0) **and its size is the world** (see "The frame is the world"). The title IS the level name — nothing else is folded into it, and **no number**: the game numbers a level by its place in the pack (`levelLabel`), so a typed-in "3 · " shows up twice |
| `t` *(name)* | **Line** | one `terrain` segment |
| `t` *(name)* | **Rectangle** | its outline as a closed polyline, corner radius honoured |
| `t` *(name)* | **Ellipse** | its outline as a closed polyline |
| `cut` *(name)* | Rectangle / Ellipse | **subtracts**: every terrain polyline is clipped against it, splitting where it enters and rejoining where it leaves |
| `start` | instance | `start` — bbox centre |
| `goal` | instance | `goal` — bbox centre |
| `watering-can` | instance | a `cans[]` entry — bbox centre |
| `bumper` | instance | a `bumpers[]` entry — bbox centre |
| `cushion` | instance of the **Rect** component | `{x: left, y: centre, w: width}` — horizontal only, rotation ignored |
| `party-popper` | instance | a popper at bbox centre; `deg` from rotation, `spd` from `FIGMA_POP_SPD` |
| `band` | Line | **ignored** — one warning per paste. A level has no field for a solution; delete these |
| `_…` or `//…` | anything | **ignored** (gauges, guides, notes) |
| any Text | text | **ignored**, always |

An instance whose component is not in the payload — a detached copy, or a
synthetic test fixture — falls back to its own layer name. A real Ctrl+C always
ships the component definitions, so that path is the rare one.

Rules that keep it forgiving:

- **1 unit = 10 px.** Levels are ~110 × 200 units, so 1:1 would be a postage
  stamp. Verified exact on the generated frames: a can at world (80, 57) lands
  at frame-local (923, 490) with the level's padded bounds offset.
- **y is DOWN** in this game, same as Figma. No flipping, no surprises.
- **Popper speed is one constant**, `FIGMA_POP_SPD` in `clipboard.js`. It used
  to ride in the layer name as trailing digits, which made a name carry meaning
  and handed Figma's duplicate numbering a way to retune a level by accident.
  A frame is GEOMETRY; per-popper tuning belongs beside the level, where the
  bench can sweep it.
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

## Reading a frame back

`read-frame.mjs` prints a frame in the units the physics uses: every toy's world
position, each popper's aim and speed, the frame box, and the `bounds` the game
will actually derive from it — which is the pair worth having side by side,
because they are not the same box and only one of them is the world.

It is a READER. There is no verdict in it, no simulation, no pass and no fail.
`verify.mjs` and the gate it served are deleted on purpose (see
[../DESIGNING.md](../DESIGNING.md)) and this is not them coming back — it is
Figma's Design panel, read in game units, which is the thing that section
already tells you to go and do by hand.

Two carriers. `--clipboard <file>` takes a Ctrl+C saved to a file and runs it
through the SHIPPED reader, so what comes out is what pasting into the game
would produce; it needs a person, because a Figma copy only reaches the
clipboard from a genuine user gesture. `--nodes <file>` takes the JSON from a
read-only `use_figma` script, which an agent can run on its own:

```js
const page = await figma.getNodeByIdAsync("47:2");   // the Levels page
await figma.setCurrentPageAsync(page);
const f = await figma.getNodeByIdAsync("<the L: frame's id>");
return { frame: { name: f.name, w: f.width, h: f.height },
  kids: f.children.map((c) => ({ name: c.name, type: c.type,
    x: c.x, y: c.y, w: c.width, h: c.height, rot: c.rotation ?? 0 })) };
```

### Do not read positions out of `get_metadata`

There is an obvious third carrier — the XML from the MCP's `get_metadata`, which
needs no script at all — and it is a trap worth naming, because it looks exactly
like the data you want. **It reports a node's `x`/`y` as the node's ORIGIN and
its `width`/`height` as the BOUNDING BOX.** Those are two different rectangles
the moment anything is rotated, and the XML does not carry rotation at all. So
`x + width/2` is the centre only for an unrotated node, and nothing in the XML
tells you which nodes those are: a popper turned 90° reports the same 140x140
box as one turned 0°, with its centre fourteen units from where that arithmetic
puts it.

This was written the wrong way round first, with a fixture and a green test
agreeing with it, because the fixture was captured under the same assumption as
the code. Ten of Fireworks' fifteen poppers are turned 90°, and all ten read
fourteen units into the floor. Use the XML to find frames and read names — that
much it is good for, and it is still the fastest way to see what is on the
Levels page. Come here for numbers.

`test-read-frame.mjs` covers the `--nodes` path against a real `use_figma` dump;
the clipboard path rides on the shipped reader, which `test-real-copy.mjs`
covers against a real Ctrl+C.

## The frame is the world

**Resize the frame and you have changed the level.** Its box arrives as the
level's `frame` and `initLevel` unions it into `bounds`, which is three things
at once: the camera (there is no free pan — `fitScale`/`clampCam` frame
`bounds` and that is the whole screen), three of the four deaths (`fall` at
`y1+25`, `left` at `x0−12`, `flew` at `x1+30`, in `physics.ts`), and therefore
the whole of what a player can see and reach.

Which is why it had to stop being dropped. Padding drawn on purpose — the empty
run to the right of a wall that a band is *meant* to reach out into — left no
trace in the level, because `bounds` is derived from the ink and the frame
around it was read for its origin and nothing else. The level re-cropped itself
to its own geometry the moment it loaded, and the room the design called for
was simply not there.

Two rules keep it from biting back:

- **Union, never replace.** A frame drawn tighter than its contents can only
  ever add nothing. That is an accident — a frame resized after the fact, a
  guide dragged past the edge — and honouring it would push terrain outside the
  world, which is a level that kills her at the spawn.
- **Padding only ever makes a level easier.** More world is more room to
  overshoot into and more room to solve it in, and that cuts both ways:
  *closing* a world is what dropped The Long Way Down from three jobs to two
  (CLAUDE.md, "closing a world makes it more forgiving" — the same fact, read
  from the other end). **Play it again after resizing a frame**, even when the
  ink did not move.

The box rides in the level link (`codec.ts`, flags bit1, four coordinates at
the tail), so it survives the trip through the lobby like everything else. Old
links have no frame and derive their bounds exactly as they always did.

## The paste target

**The game itself**, behind `\`. There is no separate editor page any more —
the level SELECTOR is the paste target, so a frame goes from Figma into the
event's level pack without ever leaving the game.

```
copy a frame in Figma  →  \  →  Ctrl+V on the grid  →  src/figma/  →  the pack
copy a frame in Figma  →  Ctrl+V while playing  →  …over the level on screen
```

The second line is the tight loop: with the grid shut, a paste lands on the
level in front of you and stays there — no bounce out to the grid, and no
question asked as long as the frame's NAME still matches the level it is
redrawing.

The reader lives in `apps/goomba-glider/src/figma/`: `clipboard.js`, with
`stitch.js` beside it and `paste.js` deciding which of the two shapes arrived
(a Figma copy, or one of our own level links).

**Just copy in Figma and paste here.** A plain `Ctrl+C` puts a `fig-kiwi`
payload on the clipboard and `clipboard.js` decodes it — that path carries the
real layer names and each node's *stored* geometry, so it needs no corrections
of any kind, and the `anchor` dots are not used.
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
`fixtures/real-figma-copy.b64`, an actual Ctrl+C of a real level frame — and
asserts it decodes to a FROZEN expectation, segment for segment (frozen rather
than read from anywhere live, so a level redesign cannot fail a decoder test).
That fixture is the only test here made of real data, and it is the one that
caught all four.

Also accepted: paste one of our own level links.
`fixtures/sample-figma-clipboard.html` is a synthetic-but-valid copy you can
feed the decoder without Figma open.

**Copy, do not "Copy as SVG".** They sit next to each other in the same menu and
only one of them works. Figma writes layer names into SVG only when the `id`
attribute is switched on, and it is **off by default** — measured on the same
frame, the exporter emits 111 ids with the flag and 3 without (just the gradient
defs). "Copy as SVG" gives you no way to switch it on, so that route arrives
with every name stripped, including the `L:` frame wrapper, and since names are
the entire contract there is nothing left to read. `paste.js` recognises that
shape and says so by name rather than listing MIME types at you.

**Don't add a second reader for exported `.svg`.** One existed and is gone: it
needed two corrections for undocumented exporter behaviour that could drift
without ever throwing — every Line came out inset half a stroke at each end and
offset half a stroke perpendicular, and export dropped a component's transparent
padding, so a bounding-box centre was not the anchor and the goal landed 1.5
units low. (That second one is the entire reason the kit components carry
`anchor` dots.) Ctrl+C reproduces the file's own numbers and needs neither. One
reader, one contract.

A pasted level is *live*, for everyone, a second later — which is the whole point
and also the only thing that judges it. `node seed.mjs --pull` prints what an
event is currently running.

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

`stitchTerrain` (`apps/goomba-glider/src/figma/stitch.js`) chains segments back
into polylines. It grows a chain from BOTH ends and accepts
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

A `t` that is a **pen path** is still skipped with a warning, and the reason is
the original one: `(0,0)-(width,0)` on a pen path is the top edge of its
bounding box, which can be nowhere near the shape drawn, and would arrive as a
plausible straight segment that silently changes whether the level is winnable.
A named layer that goes missing is a bug someone can see; a wrong one is not.

That argument never applied to a **Rectangle** or an **Ellipse**, whose outlines
ARE their box, so those two are read exactly (`shapes.js`) and arrive as closed
polylines that skip stitching. A rounded rectangle keeps its radius, because a
rounded corner is a physically different object from a square one — nothing
closer than 4.4 u may meet, or she wedges in it and the run stalls.

## `cut`: the shape that takes terrain away

A doorway in a wall is not two shapes. It is one shape with a hole punched
through it, and that is what a layer named **`cut`** is: a Rectangle or an
Ellipse that SUBTRACTS from every terrain polyline, splitting a surface where it
enters and rejoining it where it leaves. Rotation and flips come free, because
the test runs in the cut's own local box through its inverse transform.

It is what makes a *ring* level drawable at all. Two concentric Ellipses named
`t`, two crossed Rectangles named `cut`, and what arrives is eight arcs with
four doorways in each ring — geometry with no expression as Lines whatsoever.
`node test-shapes.mjs` asserts exactly that, on the sketch's own radii.

Cuts are applied AFTER stitching, because a cut through the middle of a chain
has to split the chain. Only the two crossing points are added; every authored
vertex survives untouched, so a cut never re-facets an arc.

`node test-stitch.mjs` covers the chain, the gap that must survive, the
backwards-drawn segment and the closed loop. `node test-shapes.mjs` covers the
rect/ellipse outlines and every way a `cut` can meet a surface. The real-copy fixture now decodes
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

Nothing here writes to the repo at all — a level goes from a frame to a room:

```
Figma frame  →  Ctrl+C  →  Ctrl+V in the game (`\`)  →  ▶ play
                                      ↓
                        it is in the event's pack, on four phones
```

Every step of that is exercised. Reading the smoke-test frame back gave the
level below, matching the coordinates it was built from **exactly** — terrain,
start, goal, can, bumper, popper (`deg -37`, `spd 137` off the layer name) and
the cushion's 20-unit span. The frame also carries one leftover `band` Line, and
what comes back is a warning rather than geometry:

```
terrain [[10,10],[40,16]] [[40,16],[70,14]]
start [12,8]  goal [65,50]  cans [[30,25]]  bumpers [{50,40}]
pops [{20,45,deg:-37,spd:137}]  cushions [{35,52,w:20}]
warning: ignored 1 `band` layer(s)
```

A frame that is NOT a level is refused by name, rather than turning a scatter of props into a
plausible level:

```
no layer named `start` — the level has no spawn
```

Everything in the contract fails that way. A named layer that goes missing is a
bug someone can SEE; a wrong one that decodes cleanly is not, which is why a `t`
that is not a Line is skipped loudly and a frame with no `start` is refused
outright.

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
source of truth for *why* a level works. Two facts worth restating here:
collectibles are **watering cans** (`cans`, not `plants`), and terrain
restitution is normal-dependent — floors stay dead at 0.02 while a vertical
wall hands back 0.15.
