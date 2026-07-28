# Designing Goomba Rider levels in Figma (or any vector tool)

The fastest level-design loop we have:

1. Draw the level in Figma on a **390 × 844 frame** (portrait phone). One frame = one level.
2. `Export → SVG` (defaults are fine — just make sure "Include 'id' attribute" is on so layer names survive).
3. **Drag the .svg file onto the running game** (or ⚙ → *import SVG*). It loads instantly as the ✦ Custom level.
4. Playtest, tweak in Figma, re-export, drop again. The last import survives page reloads.
5. When a level feels good, hand the SVG over and it gets baked into `LEVELS` and run through the
   verification harness (must fail with no bands, win with the solution, and tolerate sloppy fingers).

## Layer-name conventions

Names are case-insensitive prefixes; everything else that has a **stroke** becomes terrain.

| Layer name starts with | Draw it as | Becomes |
| --- | --- | --- |
| *(anything with a stroke)* | pen/line strokes | terrain — slopes, walls, cliffs (curves get flattened) |
| `start` | small circle | where Goomba begins (put it ~just above a slope) |
| `goal` or `cake` | small circle | the cake |
| `cushion` | rect or horizontal line | bouncy pillow (its top edge; restitution > 1) |
| `pop` | a **line** | party popper: line start = position, direction = aim, **length = power** |
| `sol` or `band` | lines | intended solution bands (optional — powers the 🧪 *verify level* button) |
| `guide`, `note`, `frame`, `bg` | anything | ignored |

Coordinates are normalized on import so the level is 200 world-units tall — a 390 × 844 frame
lands exactly in the tuning sweet spot.

## Physics cheat sheet (world units, level = 200 tall)

- **One silly band stretches to 58 units max** (~a quarter of the level height). Ends within
  5 units of terrain snap onto it (ledge lips/corners win), slightly buried so no tip-bonk.
- **Gravity pulls at 140 u/s²; speed caps at 120 u/s.** Max height anything can gain: ~51 units
  — that bounds cushions bounces and popper launches alike.
- **Popper power** = line length × 2.5, clamped 60–120. A ~48-unit line (≈¼ frame height in
  Figma) = full power. Poppers grab her to their center before firing, so launches are exact —
  use them to reset sloppy trajectories mid-level.
- **Fast lips throw flat.** Off a lip at speed she travels far horizontally; don't put a floor
  25–45 units below a fast lip unless you want her to land on it bare.
- **Make bands load-bearing** with ledges *higher than the lip* facing them (ballistically
  unreachable — needs a lip-to-lip bridge) or gaps wider than ~58.
- **Steep catch bands** work when placed *below* the flight path; bands *starting at the lip*
  need slope ≲ 1 or she sails over.
- **Walls are bumpers**: hitting one kills horizontal speed dead (good for switchbacks — drop
  her onto a slope going back the other way).
- **V-basins catch everything** that falls into them — great for goals, fatal for "she must not
  land here" zones. The stuck detector fails a run that stops making progress (~4 s).
- The 🧪 *verify level* button runs the real sim: **bare should NOT win** (else the level is
  too easy) and your `sol` bands should win.

## Baking + multiplayer notes

`window.__gr` exposes `importSVG(text)`, `svgToLevel(text)`, and `simulate(levelIdx, bands)` —
the same deterministic sim the future PartyKit server would run. Team budget is 4 bands
(4 players × 1; a 3-player team has someone place two).
