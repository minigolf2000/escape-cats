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

**Draw terrain with the Line tool (L). Never the pen.**

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
computed arcs (crest, quarter-pipe, hill) as worked examples. The only rule is
the one in the gauges: never let two segments come closer than 4.4 u (2 × her
radius) or she wedges in the corner and the run stalls.

## The contract

Layer **names** carry all the meaning. Position comes from the node.

| Layer name | Node type | Becomes |
| --- | --- | --- |
| `L: <title>` or `L--<title>` | Frame | one level; the frame's origin is world (0,0) |
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

`apps/goomba-editor` (`/editor/`, :5179 in dev) is the other half. It used to be
a level editor; it authors nothing now — Figma does. What is left is a canvas, a
play button and a copy-link button.

```
copy a frame in Figma  →  ⌘V on the page  →  src/figma-svg.js  →  the shipped sim
```

It takes a level three ways: paste the SVG text (Figma's **Copy/Paste as → Copy
as SVG**), drop an exported `.svg` file, or paste one of our own level links.
`public/sample-figma-export.svg` is a real export you can drop to see it work.

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

## The loop, end to end

Nothing here touches `levels.ts` until a level has earned it:

```
Figma frame  →  Copy as SVG  →  ⌘V at /editor/  →  ▶ play
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
