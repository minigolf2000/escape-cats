# Designing a Goomba Glider level (read this first)

**Fastest way in: open the level editor at `/editor/`** (`npm run dev`
serves it on :5179). Drag geometry, watch the bare run and the four-band
solution be re-scored on the shipped physics as you drag, and let a pool of
web workers hunt in the background for the one-band win that would break the
level. It saves by putting the whole level in its own URL, so a design travels
as a link — including to this bench: `node verify.mjs --hash <link>` runs the
full gate on a level that was never committed. The editor is the fast loop; the
gate below is still the authority.

This folder is the rest of the level-design bench. The game itself is the coop app in
`apps/goomba-glider/` on the shared sim in `packages/shared/src/goomba/`; the
single-player prototype it grew from is deleted (git history has it), so there
is exactly **one copy of the physics and one copy of the levels** —
`packages/shared/src/goomba/levels.ts`. Every tool here bundles that TypeScript
on the fly (`lib.mjs`) and drives the identical code the server scores runs
with — as does the editor, which imports the same package rather than carrying
a copy. Design happens in the editor or by editing `levels.ts`, graded by these
tools; playtests happen on the deployed game by assigning yourself to a team
from `/proctor`.

## The party rule (non-negotiable)

**This is a 4-player game, locked. Every level must genuinely REQUIRE 4 bands**
— not merely allow them — or a player gets benched.

The rule has two halves, and level design owns the first. The room enforces the
second: a player may hold at most **⌈4 / connected players⌉** bands at once
(`bandQuota` in `packages/shared/src/goomba/sim.ts`; `node quota.mjs` is its
gate), so a full team is one band each and a 3-player team is up to two each.
That cap stops one player laying all four — but it cannot make a level *need*
all four. **A level that wins on 1 band still wins on 1 band with four players
in the room**; the other three just place decoration. Only geometry can close
that gap, which is why this half is non-negotiable and why the two gates are
separate.

`minbands.mjs` is the judge: exhaustive at 0–1 bands, sampled at 2–3,
plus your 4-band solution as the upper bound. The structural trick that makes
"requires 4" possible is **state erasure between stages**: poppers and
wall-drops reset her speed, so stages become independent and no single band can
shortcut across them. Off-path watering cans then gate the spider plant so
every stage must actually be ridden.

## The loop

1. **Sketch in data, not in your head.** Either drag it in the **editor**
   (`/editor/`, and start from a level that already passes rather than
   from the skeleton — remixing structure that works beats inventing it), or
   add the candidate straight to `packages/shared/src/goomba/levels.ts` (its
   index = position in the array). Levels are plain data either way: `terrain`
   (polylines; walls are just steep segments), `start`, `goal`, and the toys —
   `cans` (watering cans: the collectibles that lock the goal spider plant),
   `pops` (poppers: forced re-launch, erases state), `cushions`, `bumpers`.
   World is portrait-leaning (~110 wide × 200 tall), y is DOWN. Leave
   `solution: []` until you find one. The editor's *copy levels.ts entry*
   button emits the array entry when the shape is settled — every shipped level
   round-trips through it byte-identical, so the paste is safe.
2. **Trace the bare run**: `node trace.mjs <idx>` — the level must NOT win with
   no bands, and the failure should be legible (a smirk, not a shrug).
3. **Find where bands work**: `node scan.mjs <idx> v|h <spanLo> <spanHi>
   '[fixed]'` sweeps one band across the level and prints outcome windows —
   how you discover the win window for each intended band and its width
   (forgiveness). Aim for windows ≥ ~8 units. `node solve.mjs <idx> [k]` (beam
   search) finds the solutions you did NOT intend — run it at k = 1–3 to hunt
   shortcuts before a player does.
4. **Bake the solution** into the level's `solution` field, then run THE GATE:
   `node verify.mjs <idx>` — one PASS/FAIL over the whole battery (bare fails,
   4-band solution wins, every band load-bearing, finger-slop, exhaustive
   0/1-band, sampled 2/3-band, beam-search shortcut hunt). `--quick` while
   iterating; the full gate before shipping. A level still living in an editor
   link takes `--hash <link>`, and a file of links (what the editor's tray
   downloads) takes `--file <path>` — same battery, same verdict, no diff
   required. The individual tools (`test.mjs`, `robust.mjs`, `minbands.mjs`)
   remain for richer diagnostics when a check fails.

   The editor runs checks 1–4 of that battery live and hunts checks 5–6 in the
   background, which catches most breakage in seconds. It is not a substitute:
   its samples are smaller and it never runs the beam search, which is the
   hunter that has caught every exploit random sampling missed. **PASS from
   `verify.mjs` is the only thing that ships a level.**
5. **Look at the ride**: `node ridecards.mjs <outDir> <idx>` renders the level
   with her traced path — Read the PNG. Judge fun by `duration × %airborne`,
   not duration. For live play, open the game with **`?solo`** — the LEVELS
   grid on the in-page sim (no server) — or with **`?debug`** in a real room,
   where tapping a level card jumps the whole room to that level (multiplayer
   playtesting). `?debug` no longer OWNS that grid: it overrides the gate a
   team otherwise earns by clearing every level, so the selector you design
   against is the one players get. Scriptable via `window.__goomba`:
   `state() / send({type:'place',...}) / send({type:'play'}) /
   send({type:'goto',level:i})`.
6. **Update what the level makes stale**: the level-count claims in the root
   `README.md` and this folder's docs. A level carries a `name` and nothing
   else prose-wise — there are no hint/description fields, so the title is
   the only text players read; make it earn its place.

## Physics cheat sheet (world units)

- **One silly band stretches to 58 units max.** Ends within 5 units of terrain
  snap onto it (ledge lips/corners win), landing FLUSH — on the vertex, offset
  neither down nor up. They used to land 0.8 buried, and that is what made a
  snapped band end in a kerb: a vertex sitting d above the band's riding surface
  is inside Goomba's collision circle sqrt(R²−(R−d)²) short of the lip (1.70u at
  d=0.8), on a normal that takes sqrt(1−((R−d)/R)²) of her along-band speed — 77%
  — straight into the ground's dead restitution (level 1's bridge: in at 39 u/s,
  off the lip at 10.6 horizontal). Flush is free at both ends; lifting the
  endpoint instead only moves the kerb to the departure end.
- **Gravity pulls at 140 u/s²; speed caps at 120 u/s** (some levels raise it
  via `maxSpeed`). Max height anything can gain: ~51 units.
- **Poppers grab her to their center before firing**, set DIRECTION and carry
  arrival speed through (floor: `spd × 0.82`), so launches are exact — use
  them to reset sloppy trajectories mid-level. Trigger radius ~8.
- **Fast lips throw flat.** Off a lip at speed she travels far horizontally;
  don't put a floor 25–45 units below a fast lip unless you want her to land
  on it bare.
- **Steep catch bands** work when placed *below* the flight path; bands
  *starting at the lip* need slope ≲ 1 or she sails over.
- **Walls are bumpers**: hitting one kills horizontal speed dead (good for
  switchbacks — drop her onto a slope going back the other way).
- **V-basins catch everything** that falls into them — great for goals, fatal
  for "she must not land here" zones. The stuck detector fails a run that
  stops making progress (~4 s).

## Design notes: what the sim taught us

Findings from brute-forcing the solution space (`minbands.mjs`). These are
physics facts about this game, not opinions — each came from a level that
failed a check.

**The universal shortcut is "long fall + one catch band."** If the plant sits at
the bottom and the start at the top, gravity does all the work and a single
band near the goal wins. Grand Finale shipped as a 3-band level and had 380
one-band solutions. Anything that descends toward its goal has this problem.

**The second shortcut is "extend the start ramp."** A band laid along the
opening slope just buys speed, and speed clears gaps that were supposed to
need bridging. Any level where *more speed helps* can be trivialized this way.

**Poppers are the antidote, because they erase state.** A popper redirects at a
known speed, so nothing upstream changes what happens downstream. That makes
stages independent, which is precisely what forces one band per stage. Poppers
aren't decoration — they're the structural tool for multiplayer levels.

**But a popper must fire *away* from the band that feeds it.** Launch back
across the band she just rode and she immediately re-collides with it. Give the
popper ~12 units of drop below the feeding band's end, or aim it to continue
her direction.

**The zigzag problem, solved by making the players build the walls.** A one-way
popper staircase drifts too wide to stay portrait; a zigzag needs a reverser,
and the only robust reverser is a wall. The Popper Grid (the finale) lays four
horizontal lanes of forced poppers, aimed in alternation like a 2D line maze,
dense enough (16 units apart vs the ~8-unit trigger radius) that crossing a
lane always gets her grabbed and re-flung. Bands can't help her travel — the
players' only verb is to *wall* a lane: she rebounds off the band (band
restitution ≈ .32 kills most of her speed), drops one popper back, falls
through the gap into the lane below, which runs the other way. Each lane needs
its own wall — `minbands.mjs` confirms no 1/2/3-band set wins. Two tuning
facts that made it work: the entry chute needs a wall to kill her ramp speed or
she flies over the first lane, and a wall placed *before* a lane's can
strands the run — that's what makes it a maze instead of four free choices.

**Judge the ride in airborne seconds, not duration.** Across two review rounds,
`duration × %airborne` predicted the fun ranking almost perfectly; raw duration
predicted nothing. Lengthening the boring part is metric-gaming.

**A collectible on the line she'd fly anyway is a chime, not a constraint.**
Cans only create routing pressure when they're *expensive* — off the greedy
path, costing speed or height or another can. (An early draft hung cans a
few units under each bridge line — the beam search disproved it; see
shelf-gating below for why in-gap collectibles never survive scrutiny.)

**Collectibles beat geometry for forcing multi-band.** Scattered watering cans
make the plant a *routing* problem instead of a reachability one: one band can
drop her down a shaft, but it can't make her pass three separate points.

**Shelf-gating — the switchback pattern (Mind the Gap — level removed,
findings stand; git history has the geometry).** Floors alternating
direction, a band-sized gap in each, walls between floors erasing her speed.
What makes it honestly need one band per floor is WHERE the collectibles sit:
**on the far shelves between gap and wall, never hanging in the gaps**. A
watering can in a gap can be grazed by anything flying through it — the beam search
found both a diagonal launcher band that overflew a whole floor through its
gap, and an under-floor band that dropped her down a column past a lower
can. A shelf, by contrast, has solid floor directly above (no fall reaches
it) and sits 40+ units above the next corridor (beyond the ~34 units of rise
a speed-capped launch can buy — check this number when changing the pitch),
so the only way onto it is across its gap. Two supporting facts: floors
shallower than ~0.12 strand her (the idle pump fights the slope and she creeps
into a stall), and a short uphill shelf before each lip pins bare lip speed to
~24, which no 42-unit gap forgives.

**One deterministic launch is a spine (Pachinko Drop — level removed, findings
stand; git history has the geometry).** A popper's fire is
exact, so a whole level can hang off a single parabola: rows placed so the
BARE arc misses them by a few units, with a catch band whose only job is that
nudge. Hard-won mechanics from building it: an entry ledge even **+1 above**
the lip facing it is unjumpable (arcs only fall — check the fastest
band-ramp arrival still lands short), but the crossing band SAGS ~1 per 20
units, so the rider needs lip speed ≳ √(280·(rise+sag)) or she oscillates
trapped in the sag valley; a floor ending nearer than ~5 units to a wall
makes a wedge notch she stalls in (end floors ≥6 short of walls so she falls
through); and a feed band that delivers her straight under a vertical fire
gets smashed by it — angle the fire or end the feed outside the barrel line.

**A chain of different gates needs one band each, without any state erasure
(Four Ways to Help — level replaced, findings stand; git history has the
geometry).** The other route to "requires 4" is four stages that fail
*differently*: bridge, wall, bridge, choose-the-hole. Nothing has to reset her
speed, because no band can substitute for a band doing a different job. Two
rules make it hold. Give every gap a far lip **1 unit above** its near lip —
arcs only fall, so no speed ever crosses it and gap width becomes purely a
question of band length. And **floor every dead column with a bowl**: the
level's tall empty space is where shortcuts live, and the beam search found a
2-band win that simply dropped her down the column under the start pad onto a
much later ledge, collecting its can en route. A wide V-basin under that
column turns the whole family into a stall. Bonus for a tutorial: four gates
with four distinct deaths means every partial solution reads as a specific
lesson rather than a generic "she died".

**A 58-unit band is half this world — "requires 4" needs structure, not a
better collectible placement (The Long Way Down).** Rebuilding level 1 from a
hand sketch — four ledges descending to a plant on a flat, full-width ground —
the obvious lever was "move the second can somewhere a 3-band solution cannot
reach". It does not exist, and `reach.mjs` is the tool that says so: it paints
every winning trajectory the beam search can find at k bands and at k+1 onto a
grid and reports the cells only k+1 reaches. Here (`node reach.mjs 0 3
--drop-can 1`) that list is EMPTY — the 3-band reachable set covers the 4-band
one, so there is no cell to put the can in. Two reasons, both
structural. A band stretches 58 units across a world only ~110 wide, so one
band spans half of anywhere; and a flat full-width floor is nearly frictionless
here (she slid 24 units in 0.47 s losing almost nothing), so it delivers her to
the plant from anywhere on it — the last stage is free no matter what happens
above. If a level must REQUIRE 4, the floor has to be broken, tilted away from
the plant, or fenced, and the descent has to be interrupted by something that
erases state. No amount of collectible placement substitutes.

**Terrain detail and height pull in opposite directions — and the way out is
to make the terrain PERPENDICULAR (The Long Way Up).** Height only comes from
speed (`v²/280` of rise), so a level with 100 units of vertical action needs
~150 u/s somewhere. But at 140 u/s her arc is nearly a straight line: she
crosses a 16-unit notch in 0.11 s and drops one unit, so a stepped ground reads
as one flat runway. Flat-floored obstacles therefore only bite below ~45 u/s,
and a band laid over one is nearly the same path as her bare arc (a 30-unit
band sags 1.5; her arc over the same span at 100 u/s droops about the same), so
the band does nothing. Both problems have the same fix: **cut the obstacle
perpendicular to the surface she is riding, not vertically.** A notch cut
perpendicular into a rising slope presents its far wall square to her travel —
she meets it head-on and the ground's dead 0.02 restitution takes everything,
at 40 u/s or at 140. Combined with a slope that steepens (see below) that makes
a speed-independent gate out of pure terrain. A corollary worth remembering:
bands are a poor way to buy height. A band's restitution is 0.32, so a 45° band
ramp turns 100 u/s of flat run into 15 units of rise — poppers (exact,
magnitude-preserving) and bumpers (1.18× on the normal) are the only real
lifts in the game.

**A concave-up slope is a gate generator; a vertical wall is a rail (The Long
Way Up).** Two facts do all the work on that level's run-up. First, on a slope
that steepens, a Goomba who leaves a rim along the tangent can NEVER reach the
next rim: the surface curves up away from her tangent while her arc curves
down, so she is always below the far lip and lands on the wall under it. Notch
width becomes a pure question of band length, exactly like the raised far lip
does on flat ground, and it holds at any speed. Second — the draft that shipped
nothing — a notch with VERTICAL walls does not gate anything on a steep slope.
She arrives moving up-slope; a vertical wall kills only her horizontal
component and preserves the vertical one, so it becomes a rail that carries her
UP past the rim on her own speed and drops her neatly at the next popper. The
walls have to face her: perpendicular to the surface, which on a 60° slope
means they lean back over the notch like a ratchet tooth. Same reason her
ratchet teeth work going up and let her slide out going down.

**The bumper is a MIRROR, so she must arrive moving the way you don't want her
to go (The Long Way Up).** `BUMP_E` reverses and amplifies the normal
component, so a leftward exit needs a rightward arrival onto the bumper's left
face — there is no placement that turns a leftward glide further left. Two
consequences worth designing around. The launch that feeds it must therefore
overshoot the bumper and come back down onto it: "one arrival speed lands on
the bouncy" is a real, tunable knob, and the fence past it is what an overshoot
dies on. And `BUMP_MIN` (58) is a state-eraser as useful as a popper's floor —
a slow arrival leaves at exactly 58 along the contact normal, so a bumper
positioned near the top of an arc *normalises* whatever reached it, while one
positioned well below the apex passes the arrival's variance straight through
at 1.18×. Pick which you want.

**Snap IS the forgiveness — anchor every band end on a terrain vertex (The
Long Way Up, and the fix Space Cadet was missing).** The ±3u jitter check is
what kills chained-ballistics levels, because each hand-off tolerates only a
few units and nothing re-centres her. But jitter perturbs the *bands*, not the
physics: an endpoint within 5 units of a vertex lands exactly ON it, and ±3 per
coordinate is at most 4.24 units of displacement, so an end placed on a vertex
snaps back to the same vertex and the run is bit-identical. Two devices give you those
vertices. A **notch rim** — the last smooth point before a perpendicular notch —
is the natural one on a ridden slope, and a **post** (a 7-unit stub hanging
DOWNWARD from the height you want the band at, one either side of where she
comes down) is the one for open air; downward matters, so her near-vertical rise
passes the post rather than clipping it. Either way the rule is the same: keep
rival vertices ~9 units apart so a jittered end cannot prefer the wrong one
(two vertices of the *same* stub are harmless — the band just gets a few units
longer). The Long Way Up is a chain of exact ballistics and scores 29/30 on
jitter this way; check the spacing whenever a jitter score comes back at 17.

**One band will always try to do two jobs; the beam search finds how (The Long
Way Up, three drafts running).** Every draft of that level died the same way and
the fix was always spacing, never cleverness. On popper hops it was a single
band slung above two apexes as a CEILING — hitting a sloped band from below near
the apex is cheap, and it converts her spent climb into exactly the sideways
skid that feeds the next popper; the fix was pushing the apexes further apart
than one band's whole stretch (58). On the ridden slope it was a band laid
STEEPER than the surface: because the slope is concave up, any chord sits above
it, so one band bridges its notch and then launches her off its high end clean
over the next one. The fix there was making the notches LONG (chords of 28-40)
and letting them cover most of the slope, so every arc lands in a notch rather
than on a pad. Before trusting a beam-search pass, ask it yourself for each pair
of jobs: could one band stand in both of these places at once?

**Anti-shortcut devices that do work:**
- **Roofed pocket** — the goal plant in a pocket with a ceiling, so falling
  arrivals are blocked and the only entry is horizontally through the mouth.
- **Ceiling over a run** — caps how high she can arc, so extra speed can't
  skip a gap.
- **Goal above the start** — falling can never reach it.
- **Speed governor** — a short gentle shelf just below a wall-drop; at ~15
  speed even a 20-unit gap is uncrossable.
- **A notch cut perpendicular into a rising slope** — its far wall and its
  ratchet teeth face square back down-slope, so she meets them head-on at any
  speed, and the slope's own concavity means no launch angle clears it. The
  rims are snap points, which makes the chord across it forgiving (see the
  jitter note above). Keep the notch long: a short one gets flown over from a
  band laid steeper than the surface.
- **Posts with nothing between them** — a pair of downward stubs where a floor
  ought to be. There is no surface until the players make one, so the stage
  cannot be skipped by arriving faster, and the stub tops are snap points that
  make the band's placement forgiving.

**A run-out floor has to outvote the pump, not just the stall threshold.** The
snowboard pump (`sp < 12` while grounded) pushes her the way she FACES, so a
floor that only just clears the ~0.12 stranding pitch still traps anything that
lands on it moving the WRONG way: she pumps into the far corner and stalls
facing it. Watering Can Slalom's floor was 0.061 and stranded 741 of 3312
sampled left-side arrivals; at 0.204 all 3312 slide to the goal. If a floor's
job is "wherever she lands, she ends up at the plant", pitch it ~0.2, and test
it with arrivals that carry velocity AWAY from the goal — a straight drop keeps
her facing the way she already was and will tell you the floor is fine.

**Useful numbers:** gaps wider than ~45 units aren't jumpable at typical speed,
and a band only spans 58 — so the "needs exactly one band" window is roughly
45–58 units, and it widens a lot if you slow her down first. Two segments
closer than ~4.4 units (2 × her radius) wedge her in a corner and stall the
run.

## Sharing the result

Ship the level in `levels.ts`, verified, and note that live rooms restore
saved state — `GoombaSim.restore` clamps a stale level index and re-sizes the
`completed` array, so a deploy that adds or removes levels is safe for rooms
mid-run. If the user asked for an *idea* rather than code, still build it — a
traced ride card is worth more than prose — and show the PNG.
