# Designing Goomba Glider levels in Figma

Draw a level in Figma, Ctrl+C it, Ctrl+V it into the game. This folder is the
kit you design with, the naming contract the reader follows, and the tests.

```sh
node make-pack.mjs                          # -> figma-pack.svg   (the kit)
node levels-to-svg.mjs [--pack pack.json]   # -> figma-levels.svg (a pack, one artboard per level)
node read-frame.mjs --nodes frame.json      # a frame in the game's units
node read-frame.mjs --clipboard copy.html   # ...from a saved Ctrl+C
node test-*.mjs                             # the readers
```

## The Figma file

File key **`vRN6Q44ReIaESP5wv8M2dI`**, three pages:

| Page | Node id | What it holds |
| --- | --- | --- |
| **Levels** | `47:2` | one Frame per level, named `L: <title>` |
| **Components** | `45:55` | the kit: six components at true world scale |
| **Scratchpad** | `0:1` | loose sketches and reference. Nothing here is a level |

**Ask for a page by node id.** `get_metadata` with no `nodeId` under-reports on
this file (it answers `Components` alone); `get_metadata(fileKey, "47:2")`
returns every level frame with its children.

- **Components**: `start` (the goomba on her dashed pad), `goal` (the thirsty
  plant), `watering-can`, `bumper`, `party-popper`, `cushion` — the game's own
  art, exported by `apps/goomba-glider/art/export-svg.mjs` at 10 px per unit.
  The game does not load these; retune art in `render.js`, re-run the export.
  The glyph radii are the COLLISION radii (a popper's dashed ring is the real
  6 u trigger), which is why the rings are drawn at all. Individual components
  rather than one variant set, because an instance inherits its component's
  name and that name is the contract.
- **Levels**: one Frame per level named `L: <title>` — **the title alone, never
  a number** (`levelLabel` numbers a level by its pack position). Background is
  `drawBackground`'s gradient (`#241245 → #170b30 → #12081f`), terrain is cream
  zero-height Lines, toys are kit instances. **A frame carries no bands.**
- `L: Welcome to Goomba Glider` is the teaching level and the smallest thing that
  is still a level: two `t` Lines with a gap, a `start`, one `watering-can`, a
  `goal`.

## Draw terrain with Line, Rectangle or Ellipse — never the pen

A Line's geometry is position + width + rotation in the plain node record. A pen
path keeps its points in a vector-network blob the clipboard reader cannot
read, so a pen `t` is skipped with a warning (its bbox edge would arrive as a
plausible straight segment that silently changes whether the level is
winnable). `segsFor` flattens every polyline into independent segments before
collision, so a bag of Lines is physically identical to an authored polyline —
a curve is a fan of Lines and to her that fan IS smooth. The only rule: never
let two segments come closer than 4.4 u (2 × her radius) or she wedges.

Curves are GENERATED, not drawn: `loop()` in `svgkit.mjs` returns a loop's arms,
its entry popper and the slowest `spd` that holds her at the top; copy the piece
out of the pack and stretch it.

## The contract

Layer **names** carry the meaning; position comes from the node. **A toy is
identified by the COMPONENT it is an instance of**, not by its layer name, so
Figma's duplicate numbering (`party-popper 138`) is harmless. Only `t` and
`cut`, which are not components, answer to their names; both ignore trailing
digits and a `-42` suffix.

| Layer / component | Node type | Becomes |
| --- | --- | --- |
| `L: <title>` or `L--<title>` | Frame | one level; origin is world (0,0) **and its size is the world**. The title IS the name, no number |
| `t` | **Line** | one `terrain` segment |
| `t` | **Rectangle** | its outline as a closed polyline, corner radius honoured |
| `t` | **Ellipse** | its outline as a closed polyline |
| `cut` | Rectangle / Ellipse | **subtracts**: every terrain polyline is clipped against it, splitting where it enters and rejoining where it leaves |
| `start`, `goal` | instance | bbox centre |
| `watering-can`, `bumper` | instance | a `cans[]` / `bumpers[]` entry, bbox centre |
| `cushion` | instance | `{x: left, y: centre, w: width}` — horizontal only, rotation ignored |
| `party-popper` | instance | popper at bbox centre; `deg` from rotation. **No speed**: there is one (`POP_SPD` in shared), stamped by `initLevel` |
| `band` | Line | **ignored** with a warning; delete these |
| `_…` or `//…` | anything | **ignored** (gauges, guides, notes) |
| any Text | text | **ignored** |

An instance whose component is not in the payload (a detached copy, a synthetic
fixture) falls back to its layer name.

- **1 unit = 10 px.** **y is DOWN**, same as Figma.
- **Rotation: `deg = -rotation`.** Figma is counter-clockwise positive; the game's
  `deg` feeds cos/sin in a y-down world.
- Toy glyphs are symmetric about their anchor (the popper's arrow is inside its
  ring), so bbox-centre is exact.
- **Popper speed is one constant, everywhere** — `POP_SPD` in
  `packages/shared/src/goomba/levels.ts`, not a layer name, not a draft, not a
  link. A frame can only ever have carried a popper's PLACE and AIM, so those
  are the only two things a popper has; `scripts/check-popper-speed.mjs` fails
  the build if anything tries to add a third. This is why a frame and the link
  of the same board play identically.

## Reading a frame back

`read-frame.mjs` prints a frame in world units: every toy, each popper's aim and
speed, the frame box, and the `bounds` the game derives from it (the two are
not the same box). It is a READER — no verdict, no simulation.

- `--clipboard <file>`: a Ctrl+C saved to a file, through the SHIPPED reader.
  Needs a person; a Figma copy only reaches the clipboard from a user gesture.
- `--nodes <file>`: JSON from a read-only `use_figma` script, which an agent can
  run alone:

```js
const page = await figma.getNodeByIdAsync("47:2");
await figma.setCurrentPageAsync(page);
const f = await figma.getNodeByIdAsync("<the L: frame's id>");
return { frame: { name: f.name, w: f.width, h: f.height },
  kids: f.children.map((c) => ({ name: c.name, type: c.type,
    x: c.x, y: c.y, w: c.width, h: c.height, rot: c.rotation ?? 0 })) };
```

**Do not read positions out of `get_metadata`.** Its XML reports `x`/`y` as the
node's ORIGIN and `width`/`height` as its BOUNDING BOX, with no rotation, so
`x + width/2` is the centre only for an unrotated node and nothing says which
those are (a popper turned 90° reads 14 u off). Use it to find frames and read
names; come here for numbers. `test-read-frame.mjs` covers `--nodes` against a
real dump; `test-real-copy.mjs` covers the clipboard path against a real Ctrl+C.

## The frame is the world

The frame's box arrives as the level's `frame` and `initLevel` UNIONS it into
`bounds`: the camera (`fitScale`/`clampCam`, no free pan) and three of the four
deaths (`fall` at `y1+25`, `left` at `x0−12`, `flew` at `x1+30`). Union, never
replace — a frame drawn tighter than its ink can only add nothing. More world is
more forgiving, so **play it again after resizing a frame**, even if the ink did
not move. The box rides in the link (codec flags bit1, at the tail); old links
derive bounds from the ink alone.

## The paste target

**The game itself**, behind `\`:

```
copy a frame in Figma  →  \  →  Ctrl+V on the grid      →  the pack, on four phones
copy a frame in Figma  →  Ctrl+V while playing          →  over the level on screen
```

The second line is the tight loop: no question asked while the frame's NAME
matches the level it redraws. The reader is `apps/goomba-glider/src/figma/`:
`paste.js` decides what arrived (a Figma copy or one of our own level links),
`clipboard.js` decodes the `fig-kiwi` payload, `shapes.js` reads rects,
ellipses and cuts, `stitch.js` chains the terrain.

**Copy, do not "Copy as SVG".** Figma writes layer names into SVG only with the
`id` attribute switched on, which "Copy as SVG" cannot do, so that route arrives
with every name stripped. `paste.js` recognises the shape and says so. **Don't
add an SVG reader**: one existed and needed two corrections for undocumented
exporter behaviour; Ctrl+C reproduces the file's own numbers. One reader, one
contract.

About the payload (`kiwi.mjs`; `kiwi-probe.mjs` dumps a real copy when a paste
stops working): the buffer closes with `(/figma)`; the schema block is raw
deflate and the message block is **zstd** (Chrome has no
`DecompressionStream("zstd")`, hence `fzstd`); a copy also ships the Document,
Page and component-definition nodes, so walk DOWN from the level frame and stop
descending at anything that matches; the frame's own transform is dropped.
`test-clipboard.mjs` covers synthetic payloads; `test-real-copy.mjs` asserts
`fixtures/real-figma-copy.b64` decodes to a FROZEN expectation.

## Stitching and cutting

Figma holds terrain as one Line each. The game strokes each polyline with round
caps three times (a 4.4 u collision halo, the core, the centreline), so every
shared vertex left unstitched grows stubs. `stitchTerrain` (`stitch.js`) chains
segments back into polylines from BOTH ends, in either direction, and **welds**
within `WELD` = 2.0 u: hand-drawn joints land 0.3–1.8 u apart, and the 4.4 u
wedge rule means nothing under 2.0 was a deliberate separation. A 45–58 u "one
band goes here" gap is never touched. **T-junctions**: a loose end within `WELD`
of another polyline's body is pulled onto it (a platform butting into a wall
lands near the wall's middle, where end-to-end welding never looks). Rectangles
and ellipses arrive as closed polylines and skip stitching.

A layer named **`cut`** (Rectangle or Ellipse) SUBTRACTS from every terrain
polyline, in the cut's own local box so rotation and flips come free. Cuts run
AFTER stitching so a cut through a chain splits it; only the crossing points are
added, so a cut never re-facets an arc. Two concentric `t` Ellipses and two
crossed `cut` Rectangles make a ring level with four doorways per ring.
`test-stitch.mjs` and `test-shapes.mjs` cover both.

## Testing this bridge (read before debugging it)

1. **Ground truth is Figma's Design panel, not the fixture.** The real-copy
   fixture is a GENERATED frame; hand-drawn ones behave differently. Select the
   Line in Figma and read `X / Y / W / Rotation` off the panel.
2. **Prove where the bug ISN'T first**: compare ONE line's panel numbers against
   the decoder's output for it. Usually the reader is exact and the drawing
   does that.
3. **The game's stroke is 3× Figma's** (4.4 u halo under a 1.5 u core), so
   sub-unit slop invisible while drawing is glaring while playing.
4. **A/B with level LINKS, never by re-pasting.** Encode both geometries and
   load each; a paste needs focus and silently does nothing without it.
5. **`#hash` is read ONCE, at boot.** `?solo#A` → `?solo#B` does not reload.
   Change a query param too (`?solo&v=2#B`) and assert
   `window.__goomba.LEVELS[0].terrain` before believing a screenshot.
6. **Run the counterfactual**: set `WELD` to 0 and re-decode.

## SVG paste is one-way

`levels-to-svg.mjs` renders a pack you can paste into Figma, but Figma's SVG
import keeps the NAME and throws the node type away — every `<line>`, `<rect>`
and `<ellipse>` lands as a VECTOR, which the reader refuses. What comes back is
a tracing template: redraw terrain with the Line/Rectangle/Ellipse tools and
swap toys for kit instances. A true round trip needs node types, which only the
plugin API or a hand-encoded fig-kiwi payload can set (`draft.mjs figma --kiwi`
does the latter for a draft).

## What the pack (`figma-pack.svg`) contains

Terrain slopes 0 / 0.12 / 0.25 / 0.4 / 0.6 / 1.0 and a wall; curves (crest,
quarter-pipe, hill, loop-the-loop); composites (V-basin, the 45–58 u gap module,
closed slab, switchback wall, popper lane); toys as collision-radius markers;
gauges (58 u stretch, the 45–58 u window, 6 u minimum band, 4.4 u wedge, 16 u
popper spacing, 34 u max launch rise, 2.2 u radius, 5 u snap ring). Every number
is from [`../DESIGNING.md`](../DESIGNING.md).
