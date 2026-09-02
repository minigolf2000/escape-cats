# Designing a Goomba Glider level

**Draw it in Figma, paste it into the game, play it.** The kit, the naming
contract and the scale are in [`figma/README.md`](./figma/README.md). `\` in
Goomba Glider opens the levels grid; Ctrl+V lands a copied frame on whatever
you were looking at.

No level lives in this repo and **nothing here grades one**. A level's source is
its Figma frame; an event plays a pack of links in its lobby; whether it is good
is answered by four people playing it. The numbers below were measured on a
simulation bench that is deleted — treat them as findings about the physics,
not as claims about your board.

## The loop

1. **Draw it in Figma.** Start from a frame that already plays well. A level is
   `terrain` (polylines; walls are steep segments), `start`, `goal`, and the
   toys: `cans` (collectibles that lock the goal plant), `pops` (poppers: a
   forced re-launch that erases state), `cushions`, `bumpers`. The world is
   portrait-leaning (~110 × 200), y is DOWN, and **the frame's own size is the
   world** — padding you draw is room you gave the players.
2. **Play it yourself with `?solo`** (the grid on the in-page sim, no server).
   Ctrl+V your frame onto the level in front of you; a paste whose name matches
   redraws without a question. Scriptable via `window.__goomba`: `state()`,
   `send({type:'place',...})`, `send({type:'play'})`, `send({type:'goto',level:i})`.
3. **A level whose geometry is COMPUTED** (a ring, an arc, a lattice) is easier
   to keep in `draft/<name>.mjs` — a params object `P` and `buildLevel(P)` —
   driven by `draft.mjs`: `run [bands]` (the route, in polar terms when the
   draft names a centre), `from <x,y,vx,vy>` (drop her mid-level to judge one
   stage), `sweep <key> <lo> <hi>`, `audit` (the draft's own geometry
   invariants — facts a run cannot show, like two popper rings being separate
   rooms), `card` (an SVG ride card), `link` (a `?solo#hash` URL, which is the
   verdict). Figma still decides the shape; this is for the numbers under it.
4. **Then play it with four people.** `/proctor`, assign yourself, open with
   `?debug`; tapping a card jumps the whole room. Watch for the two failures one
   player never sees: nobody having anything to do, and everybody talking over
   one placement.
5. A level carries a `name` and no other prose. Make the title earn its place.

## Physics cheat sheet (world units)

- **A band stretches to 58 units** (`BAND_MAX`), minimum 6. Ends within **5 u**
  of terrain snap onto it (lips and corners win), landing FLUSH on the vertex.
- **Gravity 140 u/s², speed cap 145 u/s** (`MAX_SPEED`, one constant for the
  game). Max height anything can gain from speed: ~51 u (`v²/280`).
- **Poppers grab her to their centre and OVERWRITE her velocity**: direction
  from the aim, speed exactly `spd × 0.82`, whatever she arrived with. Trigger
  reach is `POP_R + R` = **8.2 u**, a plain distance test with no line of sight
  — a popper grabs through floors and walls, so keep terrain out of its ring.
  `POP_COOLDOWN` is 0.8 s.
- **Cans** are picked up within `CAN_R + R` = 9.7 u, the same way.
- **Restitution**: band 0.32, cushion 1.3, bumper `BUMP_E` 1.18 on the normal
  with a `BUMP_MIN` of 58 outbound. Terrain depends on steepness (`groundE`):
  0.02 for anything shallower than 45°, ramping to `E_WALL` 0.15 at vertical.
  A wall is a speed eraser, not a lift.
- **Friction** over a 100 u flat run entering at 120: terrain −15%, band −4%,
  cushion −2%. **A band is the fastest floor in the game.**
- **Fast lips throw flat**; a floor 25–45 u below a fast lip gets landed on
  bare. Steep catch bands go BELOW the flight path; a band starting at the lip
  needs slope ≲ 1 or she sails over.
- **V-basins catch everything.** The stuck detector fails a run that stops
  making progress (~4 s). Two segments closer than **4.4 u** (2 × her 2.2 u
  radius) wedge her and stall the run.
- **`START_VX` is 20**, unconditional: a bare 105 u drop drifts 24.6 u
  sideways, so a straight shaft never lands where it was drawn.
- Gaps wider than ~45 u are not jumpable at typical speed and a band spans 58,
  so the "needs exactly one band" window is ~45–58 u, wider if she is slowed
  first. A crossing band sags ~1 u per 20 u of span.
- **Goomba's world radius `R` = 2.2, `POP_R` = 6, `CAN_R` = 7.5.** A sketch
  handed over as a picture is already dimensioned: measure one ring in pixels
  and every gap converts.

## Patterns

Each of these came from a level that broke. The mechanism is what to design
against; the level names are where to look in Figma.

**Shortcuts to design against.**
- *Long fall + one catch band*: anything that descends toward its goal is won
  by one band near the plant.
- *Extend the start ramp*: a band along the opening slope buys speed, and speed
  clears gaps. Any level where more speed helps is trivialised this way.
- *One band, two jobs*: a band slung above two popper apexes as a ceiling, or a
  band laid steeper than a concave-up slope that bridges one notch and launches
  over the next. The fix is always spacing — apexes further apart than 58, and
  notches long (chords of 28–40) — never cleverness. For each pair of jobs ask:
  could one band stand in both places at once?
- *A 58 u band is half this world.* On a flat full-width floor she slides to the
  plant from anywhere, so the last stage is free whatever happens above. Break,
  tilt or fence the floor, and interrupt the descent with something that erases
  state. Collectible placement alone never fixes it.

**Poppers are the structural tool.** They erase state — a stage entered hot and
one entered cold run identically — which is what makes stages independent and
forces one band per stage. Rules:
- A popper must fire AWAY from the band that feeds it, or she re-collides with
  it: ~12 u of drop below the feeding band's end, or aim it to continue her
  direction.
- **A popper's aim needs room DOWNRANGE.** What decides a throw is whether the
  world extends far enough along its angle to land in. When a thrown leg fails,
  measure where the arc exits before re-aiming; the fix may be moving the
  LANDING popper, not the thrower (There and Back Again).
- **A can on a popper's throw arc is a toll booth**: the only way to collect it
  is to be thrown by that popper, which stops winning lines threading past it.
  Compute the arc; expect to pay finger slop for it.
- **A popper is only a brake if you tune it like one.** `spd × 0.82` is an
  assignment, so a popper set near `arrival ÷ 0.82` reads as a redirect. The
  erasure of direction and variance survives either way.
- **A sparse popper lane needs fire speed ≳ 3 × the column gap** (she drops
  `70 × (gap/speed)²` between poppers, which must stay under the 8.2 reach).
  Trigger rings that do not touch make the lattice porous, which is what lets a
  bare run fall through it (Cat's Cradle: 24 u columns, `spd` 114).
- **An up-column of poppers is a trap** she cannot leave (`POP_COOLDOWN` 0.8 s
  against a 1.3 s fall), which reads as "you missed the exit" and makes the exit
  band honestly load-bearing. The exit is at an apex, so pair it with something
  that re-centres her.

**Cat's Cradle: the players build the walls.** Four horizontal popper lanes
aimed in alternation, three poppers a lane 24 u apart, lanes interlocked half a
step, no terrain at all. Bands cannot help her travel; the only verb is to WALL
a lane so she rebounds at 0.32, drifts back while falling, and lands in the lane
below. Each lane needs its own wall, which reliably gives four people four jobs.
Wall the END of a lane, past its last popper, and let the half-step stagger aim
the drop; a wall before the lane's last popper drops her through a gap. Ship the
wall LONG: ±3 u of slop on a 26 u wall tilts it 13° and the rebound by 26°; on a
50 u wall, 7°. A terrain-free level gets no snap, so band length is the only
forgiveness.

**Shelf-gating switchbacks.** Floors alternating direction with a band-sized gap
in each and walls between erasing speed. Put the cans ON the far shelves between
gap and wall, never hanging in the gaps: an in-gap can is grazed by anything
flying through. A shelf 40+ u above the next corridor (past the ~34 u a capped
launch can rise) is reachable only across its gap. Floors shallower than ~0.12
strand her; a short uphill shelf before each lip pins bare lip speed to ~24.

**Four different gates, no erasure needed.** Bridge, wall, bridge,
choose-the-hole: no band can substitute for one doing a different job. Give
every gap a far lip **1 u above** its near lip (arcs only fall, so no speed
crosses it and width becomes purely a band-length question), and **floor every
dead column with a bowl** so a drop down the empty space stalls.

**Cut obstacles PERPENDICULAR to the surface she rides (The Long Way Up).**
Height only comes from speed, but at 140 u/s her arc is nearly straight and a
stepped floor reads as a runway; flat-floored obstacles bite only below ~45 u/s.
A notch cut perpendicular into a rising slope presents its far wall square to
her travel at any speed. On a concave-up slope she can NEVER reach the next rim
from a tangent launch, so notch width is a band-length question at any speed. A
notch with VERTICAL walls on a steep slope is a rail that carries her up past
the rim; the walls must lean back over the notch like a ratchet tooth. Bands are
a poor way to buy height (0.32 → 15 u of rise from a 100 u/s run); poppers and
bumpers are the only real lifts.

**Snap IS the forgiveness — anchor every band end on a terrain vertex.** An end
within 5 u snaps exactly, so ±3 u of slop is absorbed. Keep rival vertices ~9 u
apart so a jittered end cannot prefer the wrong one. Devices: a notch rim, or a
**post** (a 7 u stub hanging DOWNWARD from the height you want the band at, one
either side of where she comes down — downward so her rise passes it).

**A popper erases error; a bumper multiplies it.** A bumper is a MIRROR at 1.18
on the normal: she must arrive moving the way you don't want her to go, so the
feeding launch overshoots and comes back down onto it. `BUMP_MIN` 58 normalises
slow arrivals; a bumper below the apex passes variance through. A band that must
aim her at a bumper is a precision tax a real finger pays. Aim bands at
poppers; let bumpers be scenery or a curtain (bumpers packed tighter than she is
wide).

**Loops.** Terrain is two-sided, so the inside of a circle holds her while
`v² ≥ G·(r − R)`; `loop()` in `figma/svgkit.mjs` solves the entry `spd` over the
arc she rides (72 at r 18; she holds at 95% and falls off at 85%, peeling into a
chord, which reads as "not fast enough"). Rules:
- A ring is a solid wall from outside, so a loop is always a `Ɔ`: in at the
  mouth's top lip, 270° round, out the bottom going the other way. A 270° loop
  is a −90° turn, so chain loops in alternating hands. A loop whose mouth sits
  ON her incoming track is an infinite orbit.
- Put the entry popper ON her riding circle (r − 2.2 from the centre) with ~20°
  of material behind it.
- The chord fan is a brake: budget ~30% over the minimum (out at 87 on 40
  chords, 48 on 10, from 95 in at r 18).
- She comes out FASTER than she went in (22 u of net drop on an r-18 loop).
- **A gap in the ROOF is a band's job, and its lips must be COARSE**: one long
  chord (30° at r 18, ~9 u) either side of the gap so snap has one candidate.
  Fine lips score 272/300 at ±3 u, coarse 300/300, a 10° tip chord 239; posts
  beside a loop wedge her (4/300).
- Reversing curvature (bowl to loop) needs AIR: end one piece, let her fly, hang
  the next on where she got to (`bank()` in `svgkit.mjs`). At the speed cap she
  flies nearly straight; don't plan on a fast arc bending.

**Anti-shortcut devices that work**: a roofed pocket around the plant (entry
only through the mouth); a ceiling over a run; the goal above the start; a speed
governor (a short gentle shelf just below a wall-drop); a perpendicular notch
in a rising slope; a **start chute** (two 10 u vertical bars either side of the
start dot, above everything — turns "she must not touch the sides" into a 9 u
doorway; In and Out is unbuildable without it); posts with nothing between them.

**A run-out floor has to outvote the pump.** The snowboard pump (`sp < 12` while
grounded) pushes her the way she FACES, so a floor that only just clears the
~0.12 stranding pitch still traps anything landing the wrong way. If a floor's
job is "wherever she lands she reaches the plant", pitch it ~0.2 and test with
arrivals moving AWAY from the goal.

**Judging.** A collectible on the line she would fly anyway is a chime, not a
constraint — cans create routing pressure only when they are expensive.
Collectibles beat geometry for forcing multi-band. `duration × %airborne` tracks
fun; raw duration does not. Thirty trials cannot tell 60% from 85%. Don't copy
the structure of the teaching level.

## Sharing the result

Paste it into the event; there is no file and no deploy. A pack can change under
a live room: `GoombaSim.reconcile` re-fits progress by index and abandons a run
in flight. If someone asked for an *idea*, still build it — a board people can
play for thirty seconds settles what prose cannot.
