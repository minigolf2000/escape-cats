# Designing a Goomba Glider level (read this first)

**Draw it in Figma, paste it into the game, play it.** That is the whole loop.
The design kit, the naming contract and the scale live in
[`figma/README.md`](./figma/README.md); pressing `\` in Goomba Glider opens the
levels grid, and Ctrl+V lands a copied frame on whatever you were looking at.

There is no copy of any level in this repo, and **nothing here grades one**. A
level's source is the Figma frame it was drawn in; what an event plays is a pack
of links in its lobby; whether it is any good is answered by four people playing
it. This document is what was learned from doing that — the physics, and the
shapes that turned out to work.

> There used to be a bench here that simulated levels in node: `verify.mjs` (THE
> GATE — a PASS/FAIL battery), plus `route`, `trace`, `slack`, `scan`, `solve`,
> `minbands`, `reach`, `search`, `searchall`, `robust`, `diag`, `ridecards`. It
> and the 4-band rule it enforced are deleted. It was not earning its keep:
> playtesting caught what mattered, sooner, and in a form you could act on. Git
> history has all of it if a question ever genuinely needs a simulator. The
> numbers quoted throughout these notes were measured with it, on levels that
> are now Figma frames — treat them as findings, not as claims about your board.

What is left in this folder is not about levels: `seed.mjs` moves a pack between
events, `test-codec.mjs` tests the save format, `bands.mjs` tests the room's band
rule, and `figma/` is the bridge in from Figma. `lib.mjs` bundles
`packages/shared/src/goomba/` for those three so nothing carries a second copy of
the codec.

The game itself is the coop app in `apps/goomba-glider/` on the shared sim in
`packages/shared/src/goomba/` — one copy of the physics, `physics.ts`, which the
server scores runs with and every phone animates.

## The loop

1. **Draw it in Figma.** Start from a frame that already plays well rather than
   from an empty one — remixing structure that works beats inventing it. A level
   is plain data underneath: `terrain` (polylines; walls are just steep
   segments), `start`, `goal`, and the toys — `cans` (watering cans: the
   collectibles that lock the goal spider plant), `pops` (poppers: forced
   re-launch, erases state), `cushions`, `bumpers`. World is portrait-leaning
   (~110 wide × 200 tall), y is DOWN, and **the frame's own size is the world**,
   so padding you draw on purpose is part of the design — room to lay a band out
   past an edge is room you drew.

2. **Play it yourself first.** Open the game with **`?solo`** — the levels grid
   on the in-page sim, no server — and Ctrl+V your frame straight onto the level
   in front of you. Tweak in Figma, copy, paste, watch it redraw under you; a
   paste whose name matches goes through without a question, which is what makes
   this loop tight. Scriptable via `window.__goomba`: `state() /
   send({type:'place',...}) / send({type:'play'}) / send({type:'goto',level:i})`.

3. **Then play it with four people**, which is the only thing that has ever
   really told us whether a level works. `/proctor`, assign yourself to a team,
   open the game with `?debug`; tapping a level card jumps the whole room there,
   so a table can walk a pack. Watch for the two failures a single player never
   sees: nobody having anything to do, and everybody talking over one placement.

4. **Update what the level makes stale.** A level carries a `name` and nothing
   else prose-wise — there are no hint or description fields, so the title is the
   only text players read. Make it earn its place.

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
- **Gravity pulls at 140 u/s²; speed caps at 145 u/s** — `MAX_SPEED`, one
  constant for the whole game (a level could once override it; exactly one did,
  and the override is gone). Max height anything can gain: ~51 units.
- **Poppers grab her to their center and OVERWRITE her velocity**: direction
  from the popper's aim, speed exactly `spd × 0.82`, whatever she arrived with.
  So a launch is exact, and identical every time — the same popper hit slow and
  hit fast produces the same arc, which is what makes it safe to reset a sloppy
  trajectory mid-level. Trigger radius ~8. (It used to carry arrival speed
  through when that beat the fire speed. It didn't buy anything measurable —
  across every shipped solution the floor bound 15 of 25 pops and all 10
  carries were popper-to-popper gravity — and it punched a hole in the state
  erasure the next section is about.)
- **Fast lips throw flat.** Off a lip at speed she travels far horizontally;
  don't put a floor 25–45 units below a fast lip unless you want her to land
  on it bare.
- **Steep catch bands** work when placed *below* the flight path; bands
  *starting at the lip* need slope ≲ 1 or she sails over.
- **Walls are ALMOST bumpers**: terrain restitution depends on how steep the
  surface is (`groundE` in `levels.ts`). A floor, and anything shallower than
  45°, is 0.02 — near-dead, so she settles and slides instead of bouncing down
  a run-out. From 45° it ramps to `E_WALL` = 0.15 at vertical, so a wall hands
  back about 15%: head-on at 60 u/s she leaves at 9, not 1.2. That is still a
  speed ERASER — switchbacks work exactly as before, and 15% of a slow arrival
  is nothing — but she no longer stops like wet cement, which read as a bug.
  Two consequences worth holding: a wall is not a way to gain anything (a band
  is 0.32, a cushion 1.3), and a corner where a wall meets a floor is still a
  stall trap, because the speed she arrives with there is already small.
- **V-basins catch everything** that falls into them — great for goals, fatal
  for "she must not land here" zones. The stuck detector fails a run that
  stops making progress (~4 s).

## Design notes: what building these taught us

These are physics facts about this game, not opinions — each came from a level
that broke, and most were first found by brute-forcing the solution space with
tools that no longer exist. The numbers are what was measured then; the
mechanisms are what to design against now.

**The universal shortcut is "long fall + one catch band."** If the plant sits at
the bottom and the start at the top, gravity does all the work and a single
band near the goal wins. Grand Finale shipped as a 3-band level and had 380
one-band solutions. Anything that descends toward its goal has this problem.

**The second shortcut is "extend the start ramp."** A band laid along the
opening slope just buys speed, and speed clears gaps that were supposed to
need bridging. Any level where *more speed helps* can be trivialized this way.

**Poppers are the antidote, because they erase state.** A popper fires at a
fixed speed along a fixed aim, so nothing upstream changes what happens
downstream. That makes stages independent, which is precisely what forces one
band per stage. Poppers aren't decoration — they're the structural tool for
multiplayer levels. The erasure is *total* and that is the point: it is what
stops "extend the start ramp" (shortcut #2 above) buying anything past the
first popper, because a stage entered hot and a stage entered cold run
identically.

**But a popper must fire *away* from the band that feeds it.** Launch back
across the band she just rode and she immediately re-collides with it. Give the
popper ~12 units of drop below the feeding band's end, or aim it to continue
her direction.

**The zigzag problem, solved by making the players build the walls (Cat's
Cradle, level 4).** A one-way popper staircase drifts too wide to stay
portrait; a zigzag needs a reverser, and the only robust reverser is a wall. So
lay four horizontal lanes of forced poppers aimed in alternation, like a 2D line
maze. Bands can't help her travel — the players' only verb is to *wall* a lane:
she rebounds off the band (band restitution ≈ .32 kills most of her speed),
drifts backwards while she falls, and lands in the lane below, which runs the
other way. Each lane needs its own wall — nothing smaller than one wall per
lane was ever found to win it, exhaustively at one band and by sampling at two
and three. This is the structure that most reliably gives four people four
separate jobs, and it has now been built twice.

The Popper Grid built it DENSE — six poppers a lane, 16 units apart against the
~8-unit trigger reach, so crossing a lane anywhere got her grabbed — plus a
terrain entry chute (whose wall was needed to kill her ramp speed, or she flew
over the first lane) and a V-basin holding the plant. Cat's Cradle replaced it
with the sparse form: three poppers a lane, 24 apart so the reaches never touch,
lanes interlocked half a step, and **no terrain at all** — twelve poppers, three
cans and the plant hang in the void, and the players' four bands are the only
surfaces in the world. Sparse changes the puzzle twice over. The lattice is
porous, so the bare run *falls through* it (past lanes 1 and 2, into lane 3, out
the side) instead of being carried, which makes the entry a real job; and the
stagger is what aims a wall-drop, because each lane's gaps sit directly above
the next lane's poppers. Both forms keep the tuning fact that makes this a maze
rather than four free choices: a wall placed *before* a lane's can strands the
run.

**A sparse popper lane lives or dies on its fire speed.** Trigger circles that
do not touch are a feature — they make the lattice porous, which is what lets a
bare run fall through it — but they also mean a lane can only grab her while she
is flying ALONG it, and that is a ballistics condition, not a layout one. She
leaves a popper at `spd × 0.82` and drops `70 × (gap/speed)²` on the way to the
next one, which has to come out under the ~8-unit reach: **fire speed ≳ 3 × the
column gap**. Cat's Cradle's 24-unit columns need ≳ 72 and fire at 114 → 93,
dropping ~4.6. Slow that lane down and the chain breaks in the middle of the
level, which reads as a mystery rather than a miss. Re-check this number before
moving a column or retuning `spd`.

Budget the WHOLE lane at the fire speed, not the entry hop. While poppers
carried arrival speed through, a lane accelerated as she crossed it (86 → 90 →
93.5 on gravity alone) and only the first hop ran at the number you tuned, so
`spd` 105 was really "105 at the door, 114 by the far wall". Constant fire
speed makes every hop the entry hop — the honest reading of `≳ 3 × gap`, and
worth 9 units of `spd` on this level when the rule was made literal.

**Wall the END of a lane, never the middle — and let the stagger aim it.** A
wall does not drop her straight down: she rebounds at ≈ .32 of her speed and
keeps that backwards drift for the whole fall, which at Cat's Cradle's speeds is
10–20 units by the time she reaches the lane below. That is what the half-step
stagger is FOR — with the wall PAST a lane's last popper, a drift of anything in
that range still lands on one of the interlocked columns rather than in a gap.
Which one varies (its three walls land half a step back, level, and half a step
on), so sweep the position instead of computing it. Park the wall BEFORE the
lane's last popper and the same drift drops her through a gap and out of the
level. (Measured on Cat's Cradle: wall face at x 81, and she was caught by the
popper 19 units back from it.)

**A long wall survives fingers; a short one does not.** The biggest robustness
lever found while tuning Cat's Cradle, and it is pure geometry: ±3u of slop on
each end of a **26**-unit wall tilts it up to 13°, and a tilt turns the rebound
by *twice* that — 26° off, easily enough to throw the landing clear of the
popper below. The same slop on a **50**-unit wall tilts it 7°. Measured, same
walls, same positions: at 26 units they survived ±3u slop 68–90% of the time,
stretched to 40–54 they survived 96–99%. So when the job is "wall this
lane", ship the wall LONG — a band stretches to 58 and nothing charges you for
using it. Corollary for a level with no terrain: endpoints snap only to terrain,
so a terrain-free level gets no snap assistance at all, and band length is the
only forgiveness you get. Spend it. (A terrain-free level is legal everywhere
else too: the renderer and the editor already iterate an empty `terrain`, and
the codec used to reject a level without a polyline — it now asks for furniture
of any kind, so a level like this still travels as a link.)

**Don't ship on a lucky 30 trials.** The gate's finger-slop check is 30 jittered
runs on one fixed seed — a stable verdict, and a noisy measurement. A solution
whose true rate was 48% passed a 19-out-of-30 threshold during one level's
tuning, and only a re-run on unrelated seeds showed it up. The general lesson
outlives the tool: **thirty trials cannot tell 60% from 85%**, and only one of
those is a level people can actually place. If you are counting anything, count
enough of it.

**Transcribing a sketch: the toys carry the scale.** A level handed over as a
picture is already dimensioned, because the furniture has fixed sizes — a
popper's dashed trigger ring is `POP_R` = 6 units, a can's ring is `CAN_R` =
7.5, Goomba herself is `R` = 2.2. Measure one ring in pixels and every gap in
the drawing converts. Doing that first is what turns "lanes roughly this far
apart" into numbers the physics can vote on — and in Cat's Cradle's case the
rings in the sketch clearly did NOT touch, which turned out to be the whole
design.

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
geometry).** The other way to get four separate jobs out of one board is four
stages that fail *differently*: bridge, wall, bridge, choose-the-hole. Nothing has to reset her
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

**A 58-unit band is half this world — spreading the work out takes structure,
not better collectible placement (The Long Way Down).** Rebuilding level 1 from a
hand sketch — four ledges descending to a plant on a flat, full-width ground —
the obvious lever was "move the second can somewhere a 3-band solution cannot
reach". It does not exist. Painting every winning 3-band trajectory and every
winning 4-band one onto a grid and asking which cells only the 4-band set
reaches returned an EMPTY list — the 3-band reachable set covers the other
completely, so there is no cell to put the can in. Two reasons, both
structural. A band stretches 58 units across a world only ~110 wide, so one
band spans half of anywhere; and a flat full-width floor is nearly frictionless
here (she slid 24 units in 0.47 s losing almost nothing), so it delivers her to
the plant from anywhere on it — the last stage is free no matter what happens
above. To stop one band from carrying the whole board, the floor has to be
broken, tilted away from the plant, or fenced, and the descent has to be
interrupted by something that erases state. No amount of collectible placement
substitutes.

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
at 1.18×. Pick which you want. (`BUMP_MIN` is a floor, where a popper is now a
flat assignment — a bumper normalises only the arrivals slow enough to hit it,
a popper normalises all of them.)

**Snap IS the forgiveness — anchor every band end on a terrain vertex (The
Long Way Up).** The ±3u jitter check is
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

**A popper erases error; a bumper multiplies it.**
The two toys look interchangeable — both hurl her somewhere — but they sit on
opposite sides of the finger-slop check. A popper *grabs her to its centre*
before firing, so every trajectory that triggers it leaves identically: it is a
position, direction AND speed reset, and slop upstream of one costs nothing.
(This paragraph was written when the speed half was only mostly true — a fast
arrival carried its speed through — which is a good part of why it is a flat
assignment now: "leaves identically" is what the toy is FOR.) A bumper
reflects off wherever she happened to touch it, at `BUMP_E` 1.18, so a 3-unit
error in where she strikes becomes a larger error in where she goes next.
Popper Pinball — a testbed since removed, findings stand; git history has the
geometry — measured the gap on one solution: the band whose job ended in a
popper jittered 30/30, the band whose job ended in a bumper jittered 10/30, and
the whole solution scored the bumper band's number. There and Back Again (4) is the
constructive version of the same fact: its fragile band hands off to a POPPER
on the leg that follows, and it scores 29/30 with a bumper wall in the loop.
Consequence for design: a bumper is fine as an obstacle or a curtain (Piñata
Alley — level cut, the pattern stands: bumpers packed tighter than she is wide
make a curtain she MUST bounce through) and fine as a *free* stage nothing is
aimed at, but a band that must aim her at one is a precision tax a real finger
pays. Aim bands at poppers; let bumpers be scenery.

**An up-column of poppers is a trap, and that is the good part** (Up the
Middle, level 5). Poppers firing straight up in a line make an elevator she
cannot leave: the top one throws her ~35 units, she falls back into it 1.31 s
later, and `POP_COOLDOWN` is 0.8 — so she re-fires forever and the run is
called `loop`. That reads
perfectly as a failure ("you missed the exit") and it makes the exit band
honestly load-bearing. Just note the cost: the exit is at an apex, where she is
slowest and most sensitive, so pair it with something that re-centres her.

**A popper's aim needs ROOM DOWNRANGE, and that is invisible in the picture
(There and Back Again, level 7).** A popper is a throw, so what decides whether it is
a return or a run-killer is not its angle but whether the world extends far
enough along that angle to land in. The same popper at 135° was: a working
return at (55,30) — every one of 1030 sampled runs that fired it reached the
far popper; a run-killer 20 units left at (35,30) — 0 of 5045 did, because an
exactly-diagonal throw travels left as fast as it falls and crossed the world's
left edge about 41 units into a 90-unit drop; and a working return again, still
at (35,30) and still 135°, once the LANDING popper moved 8 units left to meet
the throw. Nothing about the popper changed in that last step. When a thrown
leg fails, measure where the arc actually exits before re-aiming: the fix may
belong at the other end.

**A can ON a popper's throw arc is a toll booth — the cheapest way to make a
popper compulsory (There and Back Again, level 5).** A popper that merely *can* be hit
will be skipped: the winning lines that thread past it are usually the ones
with the most slack, so the solver finds them and the popper becomes scenery.
Putting a collectible where the popper's own arc passes fixes that with no
geometry at all — the popper delivers her to it and nothing else does. Compute
the arc, don't eyeball it: here the throw leaves (35,30) at 135° and ~90 u/s,
so she crosses x=13 at y≈60, and a can at (13,54) is inside the 9.7 pickup
radius. Expect to pay slop for it (29/30 → 22/30 on this board): the can turns
a leg the solution could route around into one it must hit exactly.

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
facing it. Slalom's floor — level since cut, the finding stands — was 0.061
and stranded 741 of 3312
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

Ship the level by pasting it into the event — there is no file to commit it to
and no deploy in the loop, which is the whole point: a level is live for
everyone a second after somebody pastes it.

A pack can change under a live room, and that is safe by design:
`GoombaSim.reconcile` re-fits `completed`, clamps the level index back inside
the pack and abandons a run in flight. It does NOT remap flags by identity, so
deleting a level shifts every flag after it — the accepted cost of editing live.

If someone asked for an *idea* rather than a level, still build it. A board
people can actually play for thirty seconds settles arguments that prose
cannot.
