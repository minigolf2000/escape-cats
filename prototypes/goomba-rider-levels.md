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
| `plant` (or `snake`) | small circle | snake plant — the cake stays locked until every one is collected |
| `bumper` | small circle | piñata bumper: pinball-style radial kick that *adds* energy |
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

## Design notes: what the sim taught us

Findings from brute-forcing the solution space (`tools/minbands.mjs`). These are physics
facts about this game, not opinions — each one came from a level that failed a check.

**The universal shortcut is "long fall + one catch band."** If the cake sits at the bottom
and the start at the top, gravity does all the work and a single band near the goal wins.
Grand Finale shipped as a 3-band level and had 380 one-band solutions. Anything that
descends toward its goal has this problem.

**The second shortcut is "extend the start ramp."** A band laid along the opening slope
just buys speed, and speed clears gaps that were supposed to need bridging. Any level
where *more speed helps* can be trivialized this way.

**Poppers are the antidote, because they erase state.** A popper sets velocity exactly,
so nothing upstream changes what happens downstream. That makes stages independent, which
is precisely what forces one band per stage. Poppers aren't decoration — they're the
structural tool for multiplayer levels.

**But a popper must fire *away* from the band that feeds it.** Launch back across the
band she just rode and she immediately re-collides with it. Give the popper ~12 units of
drop below the feeding band's end, or aim it to continue her direction.

**Which creates the open problem.** "Popper continues her direction" forces a one-way
staircase, and a 4-stage staircase drifts ~200 units sideways — too wide to stay portrait.
A zigzag needs her to reverse, and the only robust reverser is a wall (hit it, lose all
horizontal speed, drop). Combining wall-reversals with popper-lifts inside a portrait
column is the unsolved bit.

**Judge the ride in airborne seconds, not duration.** Across two review rounds,
`duration × %airborne` predicted the fun ranking almost perfectly; raw duration predicted
nothing. Lengthening the boring part is metric-gaming — the grind doesn't count.

**A collectible on the line she'd fly anyway is a chime, not a constraint.** Plants only
create routing pressure when they're *expensive* — off the greedy path, costing speed or
height or another plant. Put one low near a hazard and one high needing a bounce.

**Collectibles beat geometry for forcing multi-band.** Scattered snake plants make the cake
a *routing* problem instead of a reachability one: one band can drop her down a shaft, but
it can't make her pass three separate points. This is a far more natural way to require
four bands (and so four players) than any of the geometry tricks below.

**Anti-shortcut devices that do work:**
- **Roofed pocket** — put the cake in a pocket with a ceiling so falling arrivals are
  blocked and the only entry is horizontally through the mouth.
- **Ceiling over a run** — caps how high she can arc, so extra speed can't skip a gap.
- **Goal above the start** — falling can never reach it.
- **Speed governor** — she leaves a lip slowly if that lip is a short gentle shelf just
  below a wall-drop; at ~15 speed even a 20-unit gap is uncrossable.

**Useful numbers:** gaps wider than ~45 units aren't jumpable at typical speed, and a band
only spans 58 — so the "needs exactly one band" window is roughly 45–58 units, and it
widens a lot if you slow her down first. Two segments closer than ~4.4 units (2 × her
radius) wedge her in a corner and stall the run.

## Baking + multiplayer notes

`window.__gr` exposes `importSVG(text)`, `svgToLevel(text)`, and `simulate(levelIdx, bands)` —
the same deterministic sim the future PartyKit server would run. Team budget is 4 bands
(4 players × 1; a 3-player team has someone place two).

A level's `budget` field caps how many bands the player may place (default 4). Today it's
an *allowance* — every shipped level can be beaten with one band if you find the right one.
For the party version each level must genuinely **require** 4, or players get benched; run
`tools/minbands.mjs` on any candidate before trusting it.

Use the ⚙ → 🔬 **level lab** to see all levels at once with live sim verdicts, tap one to
play it, and ★ the ones worth keeping.
