# Escape Cats — working notes for Claude threads

Two coop 4-player party games (Hex Clicker, Goomba Glider) on one Cloudflare
Worker + one Vercel deploy. The [README](./README.md) is the full map; each app's
`src/README.md` is its module map. These are the invariants that bite, and the
things a thread gets wrong twice.

## Goomba Glider level design (most common task)

**Start at [`tools/goomba/DESIGNING.md`](./tools/goomba/DESIGNING.md).** Design in
Figma, paste it in, and PLAY it — alone with `?solo`, then with four people.

- **There is no simulator and no gate.** `verify.mjs` and twelve other commands,
  plus `gate.ts`, are deleted, along with the 4-band rule they enforced. **A level
  is evaluated by people playing it.** Don't rebuild any of it, don't add a
  verdict to a level card, and don't write "must pass" into a doc: this was
  tried, at length, and four people around a table found what mattered sooner and
  said WHY. Git history has every line if a question genuinely needs a simulator.
- **There is no copy of any level in this repo.** A level's source is its Figma
  frame; an event's levels are links in its lobby pack. `seed.mjs --pull` prints
  what an event is running. Parallel level threads share nothing but the EVENT —
  a paste is live on all four phones a second later, so point a second thread at
  its own event rather than editing over a party in progress.
- **The Figma file is `vRN6Q44ReIaESP5wv8M2dI`, and the Levels page is `47:2`**
  (`Components` is `45:55`, `Scratchpad` is `0:1`). Go straight to the node id:
  `get_metadata` with no `nodeId` is supposed to list the pages and on this file
  it answers `Components` alone, so a thread that trusts it concludes the levels
  are gone. One did. Then read the frame in the units the physics uses rather
  than converting px by hand — `figma/read-frame.mjs`, which is a READER and not
  the deleted gate. **Never take a POSITION out of `get_metadata`**: it prints a
  node's x/y as its ORIGIN but its width/height as its BOUNDING BOX, and carries
  no rotation, so `x + w/2` is the centre only when the node is unrotated and
  nothing says which are. A popper turned 90° reads 14 units off; ten of
  Fireworks' fifteen did, under a green test whose fixture shared the same
  assumption. The tool takes a read-only `use_figma` dump (`--nodes`, which
  carries the transform) or a saved Ctrl+C (`--clipboard`, the shipped reader).
- **The level SELECTOR is the editor, and `\` is the door.** Full behaviour in the
  README ("Goomba's level selector"). The parts that surprise people:
  - The grid **diverges by surface, and by NOTHING else** (`editorOn` in
    `state.js`, read live, not latched at boot). A phone gets a menu and no
    editing controls at all, because it has no Ctrl+V to follow them up with; a
    laptop always gets the ⌫ and the drag, however the grid was opened. `\` is
    only the door — it once carried an editing MODE too, which meant a laptop
    could sit on a grid with the controls missing and read as broken.
  - **Ctrl+V lands wherever you were looking** — the selection on the grid, the
    level on screen while playing. Only an EMPTY pack opens the grid, having
    nowhere else to land.
  - Two edits ask first on the browser's own `confirm()`: a delete, and a paste
    whose NAME differs from what it lands on. A MATCHING name is a redraw from
    the frame it came from — the tweak-copy-paste loop — so it goes straight
    through. Native rather than canvas-drawn precisely because a paste can land
    with the grid shut.
- **Both top corners are ONE idiom** (README, "Goomba's level selector"): a strip
  of state that, when its control is live, wears a plate and says what it does on
  a line underneath — dots + **select level**, band slots + **clear bands**.
  They differ in exactly one way, and reversing it is the bug: `#lab` grows its
  plate ONCE, on the clear; the band plate's condition is the EDIT PHASE, which
  comes and goes on every PLAY, so **its box is always reserved and only the ink
  changes** — chrome on `.laying`, words dimmed and the button `disabled` at zero
  bands. Key its chrome on the band COUNT and the slots jump forty times a
  session. It uses the real `disabled` (pointer, `:disabled` ink and the a11y
  tree in one); `#lab`'s `pointer-events` fake is the older, worse half.
  **The bunting hangs off `#top`'s MEASURED bottom edge** — `drawBackground`
  reads the box (a `ResizeObserver` for its size, `resize()` for the notch moving
  its position), because a constant is wrong twice: `env(safe-area-inset-top)`
  moves the bar, and the strings ride HIGHEST at the left and right edges, which
  is exactly where the plates are. Under the bar there are 24px before `#hint`'s
  win banner and the first string needs 22 of them, so that gap is a corridor,
  not slack. One tap still wipes the ROOM's bands with no confirm; if strays turn
  up the answer is UNDO, never a confirm step.

- **`src/figma/stitch.js` is the one non-obvious step.** Figma stores terrain as
  one Line per segment and the game strokes each polyline with round caps, so
  unstitched chains grow half-stroke stubs at every shared vertex. It chains from
  BOTH ends, in either direction, and **welds**: hand-drawn joints are never
  exact (measured on one real level: seven joints, ONE exact, the rest 0.3–1.8 u
  apart), so an exact-match rule chains nothing real. `WELD` is 2.0 u and the
  ceiling is the game's own wedge rule (4.4 u = 2 × her radius), so anything under
  it was never a deliberate separation; a 45–58 u "one band goes here" gap is
  never touched. It also snaps a loose END onto a surface it was drawn against (a
  **T-junction** — a platform butting into a wall lands near the wall's MIDDLE,
  nowhere near either endpoint, so end-to-end welding never sees it). Terrain must
  be a **Line**; a `t` that is a pen path or rect is skipped with a warning,
  because reading its bbox edge would be a plausible straight segment that
  silently changes whether the level is winnable.
- **The FRAME's size is the world, not just its origin.** `initLevel` UNIONS it
  into `bounds`, never replaces — a frame drawn tighter than its own ink can only
  add nothing. Bounds are the camera and three of the four deaths, so **resizing a
  frame is a design change even when the ink did not move; play it again.** More
  world is more forgiving, which is "fencing a world makes it more forgiving" read
  from the other end — The Long Way Down dropped from three jobs to two the moment
  both edges were fenced, because two of its jobs were only jobs because failing
  them threw her out of the world.
- **Before debugging "the geometry looks off", read "Testing this bridge" in
  [`tools/goomba/figma/README.md`](./tools/goomba/figma/README.md).** Two rounds
  of it were closed by reasoning about the code and shipping a fix that passed its
  own tests; both were wrong. The committed fixture is a GENERATED frame, so it
  proves nothing about hand-drawn geometry — read real numbers off Figma's Design
  panel, A/B with encoded level links rather than by re-pasting, and remember
  `#hash` is read only at boot (a fragment-only navigation silently shows you the
  OLD level).
- **The codec is shared and must never be forked** — the browser, the Worker and
  the node tools agree on it byte for byte. A new field rides at the TAIL behind a
  flag; `test-codec.mjs` is the proof. Removing `solution` cost a version bump
  (fmt 2) because it sat in the middle, and a fmt-2 link is unreadable by an older
  bundle — so that kind of change needs the Worker out first. **fmt 3 is the same
  kind of change and carries the same rule**: coordinates are STEPS from the last
  point now (zigzag varints), which moved every byte after the name to buy 20-30%
  off a long link. If links ever need to get shorter again, read that header
  first — compression, a denser alphabet and re-fitting terrain into arcs were
  all measured, all lost, and the reasons are written down.
- **Four bands for the ROOM, and no rule about whose.** The per-player quota is
  reverted on purpose (README, "The four bands"). `bands.mjs` tests that, and it
  is a test of SHIPPED code, not of a level.
- **A band wears the TEAM's colour**, one colour for every band on the board.
  `PARTY_COLORS` in `state.js` is confetti and bunting only.
- **A level's display number is its array index + 1** (`levelLabel`), computed
  where it is shown and stored nowhere — so dragging a card renumbers the pack for
  free, and typing a number into a `name` double-numbers it.
- **The pack can change under a live room.** `GoombaSim.reconcile` is the whole of
  "apply immediately, keep progress"; it deliberately does NOT remap flags by
  identity, so deleting a level shifts every flag after it. Accepted cost of
  editing live.

### Design patterns that survived the levels they came from

Five levels were designed here and are Figma frames now, not code. The patterns
are written up in DESIGNING.md; the numbers below were measured with a bench that
no longer exists. **Level numbers in these notes are historical** — a number is a
position in a pack.

- **The Long Way Up** is the one to read first if you are building from a sketch:
  one concave-up slope she RIDES, poppers shooting her along it, three long rough
  steps notched perpendicular into it for bands to chord across, a bumper at the
  top that mirrors her into a flat run home. Two lessons generalise — cut
  obstacles PERPENDICULAR to the surface she rides (a vertical wall becomes a rail
  that carries her up past the rim), and put every band end on a terrain vertex
  ~9 units clear of its neighbours so snap absorbs finger slop (29/30 at ±3u).
- **Cat's Cradle** — four one-way popper lanes, sparse and staggered, where the
  players' bands are the only walls. It replaced a dense version of the same idea
  and is more robust.
- **There and Back Again** was the best-measured board here: the bare run failed,
  all three bands were load-bearing with three different deaths, and it survived
  ±3u of finger slop 22 times in 30. Its fourth can is a TOLL BOOTH — it sits on a
  popper's 135° throw arc, so the only way to collect it is to actually be thrown
  by that popper, which is what stops winning lines threading past it. Its return
  popper was wrong twice, and the lesson is: what matters is whether a popper's aim
  has ROOM downrange. The fix for a 135° throw that overshot the world's left edge
  was moving the LANDING popper left, not re-aiming the thrower.
- **A sketch is a spec, and the toys in it carry the scale**: a popper's dashed
  ring is 6 units, a can's 7.5, so one ring measured in pixels converts the whole
  drawing. Cat's Cradle came in as a picture; the rings not touching was the
  design.
- Don't copy the structure of the teaching level.

## Repo invariants (violating these has burned us before)

- **Deploy order**: the Worker goes out BEFORE a Vercel deploy that depends on new
  protocol/DO classes. CI deploys it on push to main, but that RACES Vercel rather
  than ordering it — for a breaking change, run the workflow manually on the
  branch first, confirm it's live, then merge. `wrangler.jsonc` migrations are
  APPEND-ONLY. Renaming a Worker or DO class orphans its storage.
- **One origin**: vanity domains REDIRECT to escape-cats.vercel.app — never turn
  them into rewrites; the localStorage pid (team identity) only follows players on
  one origin, and `check:routing` would not catch the regression. No `?room=`
  params, ever. **Changing the origin costs every player their pid** —
  localStorage is per-origin, so the whole room comes back as new teams. Do it
  between events. The previous origin, cat-games-tau.vercel.app, is GONE, not
  redirected: renaming the Vercel project releases the old `.vercel.app` name,
  and an unattached host 404s at Vercel's edge before `vercel.json` is consulted
  — so a `has: host` rule for it would pass `check:routing`, which models the
  config against `dist/`, while 404ing in production. Anything printed carrying
  that host is dead; reprint it.
- **`?r=<slug>` is the one room a URL may name, and it is never a team.** Three
  things keep it clear and all three are load-bearing: the `r-` prefix is a
  namespace a team id can never enter, `roomFor` answers the TEAM first, and
  `adhocRoomId` normalises the slug in shared. BOTH games take the slug — it names
  a room, not a game. An ad-hoc room PLAYS the pack and cannot edit it
  (`isAdhocRoom`): the grid is open to any phone on the premise that the party's
  own phones are the tool, and a link handed outside the party is past that
  premise.
- **Vite `base` is absolute** per app and must match its `dist/` subdirectory
  (`/hexxygon/`, `/g00mBa/` — casing is load-bearing). `npm run build:vercel` runs
  `check-routing.mjs`; keep its expectations current.
- **Goomba never says `visibility: visible`**: hide with `hidden`, re-show with
  `inherit`. Visibility inherits, so an explicit `visible` on a descendant
  re-opens it under EVERY hidden ancestor — it is a veto over every screen owner
  (`.lab`, `.splash`, the rotate rule), held by a leaf, and it was collected on
  twice in one day. `check-visibility.mjs` enforces it; its header has both
  bugs. Goomba only — hex's pose-frame sprite legitimately works the other way.
- **Two cursors in the games, ever**: `pointer` if a tap does something, `default`
  if it does not. Almost nobody playing has a cursor, so a third value cannot be
  telling players anything. `check-cursors.mjs` enforces it over
  apps/{hex-clicker,goomba-glider,lobby,chat}; `apps/proctor` and `tools/` are
  deliberately exempt.
- **Proctor box heights are fixed**: every stat line renders in every state
  (placeholders, never fewer lines) so boxes don't shift under a drag.
- **Each client's CSS is `src/styles.css`**, imported from its `main.js` — not
  inline `<style>` in `index.html`.
- **Goomba's waiting screen IS its how-to-play sheet, and it is PICTURES.** The
  title with Goomba gliding over it, where she is going (downhill past the cans
  and across a HOLE in the floor on a band, home to the plant), and the two
  gestures that put the band there — **drag** to place, **tap** to take back.
  `GOAL_SCENE` / `GESTURE_SCENE` in `sheet.js` are level-shaped literals drawn by
  the RENDERER, so a can in the picture cannot drift from a can in the game.
  Five things here are load-bearing:
  - **The gap is what a band is FOR.** A band drawn over solid ground is
    decoration. It is at the END of the run, one platform short of the plant,
    because a gap in the middle has to be crossed ON the band, which drags her
    line — and every can strung along it — down onto the floor.
  - **No X over the band being taken back**, ever: `drawBand` already paints an
    illegal placement red and dashed, so an X would teach "you cannot put one
    there" in the one place teaching how to take one away.
  - **The plant's `goal` sits 3.6 ABOVE the floor**, unlike a real level's, because
    `drawGoalPlant` anchors on the CROWN — on the surface it buries the pot in
    the terrain's stroke.
  - **The FINGERTIP is the one mark with no counterpart in the game**, on the same
    licence the dashed ride-line takes: a gesture cannot be drawn out of the
    things it acts on.
  - **The cat on the TITLE is sized by the GOAL PICTURE, not by the title**
    (`goalScale` → `titleFrame`), so the two drawings of her on one screen are
    the same animal at the same size. The dependency runs scale-in,
    `ground`-out: the goal canvas's scale is given and the cap line is whatever
    the measured air comes to in those units. Reverse it — a constant of world
    units over the cap line, which is how it worked for a long time — and her
    size becomes a fraction of the LOGO, so she grew 14-18% the day the mark
    did and had drifted 18-40% over the picture's cat before anyone measured.

  The sheet **never dismisses itself** (the first snapshot only ARMS it), and it
  is OPAQUE. The game showing faintly through it at 86% was noise across the one
  screen whose job is to be looked at — but that ghost was also the only thing
  saying this was a layer over something, so `#gateTap` ("tap to continue")
  replaces it in words. It rides `.ready`, the same class that arms the tap:
  before that a tap does nothing and the line would be a lie. This is the one
  piece of chrome on the sheet, and it is small because the pictures are the
  screen. The connection lines stay invisible
  until the phone has been unreachable for `STALL_MS` (1.5s) unbroken — an
  unsorted phone is connected and waiting indefinitely, so time since boot is the
  wrong clock — and they keep their box (opacity, never display) so the pictures
  are never shunted up the screen. Dismissing ZOOPS the sheet into `?`; `zoopMs`
  reads `--zoop-ms` off the CSS and must stay UNIT-AWARE, because Vite's minifier
  rewrites `460ms` to `.46s`. The tap is bound to **pointerdown, not click** — the
  kiosk lockdown kills the synthesised click, so an `onclick` here works on a
  laptop and does nothing on a phone (it shipped that way once). Space, Enter and
  Escape dismiss it too, and that list is short ON PURPOSE: it used to be ANY
  key, which skipped the modifier keys themselves but not modifier COMBOS, so
  Cmd+R arrived as `r` with metaKey set and preventDefault ate the reload — Ctrl+V
  went the same way, stopping the paste listener from ever seeing a paste on a
  screen that closes itself so a paste can land. **A catch-all on a keyboard is a
  promise you cannot keep**: the whole keydown listener exists for the laptop
  that EDITS (`\` opens the selector, Escape leaves it, Space plays), a modifier
  combo is never ours, and everything else belongs to the browser. Don't add a
  second copy of these instructions anywhere; edit the sheet.
- **Hex's win is the PROCTOR's press** (`wonAt`, a proctor-only intent) — hex
  cannot score its own win, because the code word leaves the game on a phone and
  comes back as four people reading it out. It's a toggle, not a latch, and taking
  a win BACK confirms while granting it does not. `#wonPill` ping-pongs between
  the splash and the game, because the night wall they just read is what they
  EARNED. Which of the two a phone shows is LOCAL; Goomba's card taps are wire
  intents, because those move what the room PLAYS.
- **Goomba's finale is a BLACK congratulations screen**, not a victory lap. This
  app loads no image asset at all. Hex's splash picture is a drop-in file that
  brings its own sky (sampled from its own edges) — replace it and nothing in code
  changes; don't hardcode a sky and don't crop either axis.

## Commands

```sh
npm run dev            # everything: server :1999, hex :5173, proctor :5175,
                       # lobby :5176, chat :5177, goomba :5178
npm run typecheck      # all workspaces
npm run build:vercel   # full build + assemble + routing & cursor checks
cd tools/goomba && node bands.mjs        # the room's band budget
cd tools/goomba && node test-codec.mjs   # the save format
cd tools/goomba && node seed.mjs --pull  # what is this event running?
cd tools/goomba/figma && node read-frame.mjs --xml m.xml   # a frame in world units
cd tools/goomba && node draft.mjs link   # a level still being tuned (below)
```

**There is no command that evaluates a level.** `?solo` for the in-page sim,
`/proctor` + `?debug` for a real room.

**A level being TUNED lives in `tools/goomba/draft/<name>.mjs`, not in
`levels.ts`** — a params object `P` plus a `buildLevel(P)`, because a question
like "where does this popper go" is answered by SWEEPING and a hand-typed array
cannot be swept. `draft.mjs` drives it: `run [bands]` prints the route (in POLAR
terms when the draft names a centre, which is the only readable form on a ring),
`from <x,y,vx,vy>` drops her mid-level so one stage can be judged without a
broken earlier stage hiding it, `sweep <key> <lo> <hi>` walks one param, `card`
writes an SVG ride card, `link` prints a `?solo#hash` URL, and `install` / `off`
splice the draft into `SEED_LEVELS` between `// >>> DRAFT` markers so
`seed.mjs --push` can put it in front of real players. Take it back OUT before
committing anything that is not the finished level.

None of that grades anything, and `audit` is the one to understand why it
cannot: a draft may export `audit(p)` for the geometry facts a RUN can never
demonstrate, because they are about what must be impossible. A popper's 8.2
reach ignores terrain, so "these two rings are separate rooms" is arithmetic —
and a run that never happens to be in the wrong place looks exactly like a level
where it could not be.
