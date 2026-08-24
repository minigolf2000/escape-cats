# Escape Cats — working notes for Claude threads

Two coop 4-player party games (Hex Clicker, Goomba Glider) on one Cloudflare
Worker + one Vercel deploy. The [README](./README.md) is the full map; these
are the invariants that bite.

## Goomba Glider level design (most common task)

**Start at [`tools/goomba/DESIGNING.md`](./tools/goomba/DESIGNING.md).** It is
the loop, the physics cheat sheet, and the accumulated findings. Design in
Figma, paste it in, and PLAY it — alone with `?solo`, then with four people.
There is no simulator here any more and no verdict to clear; the findings in
that file are what a deleted one left behind.

- **The level SELECTOR is the editor, and `\` is the door.** There is no
  `/editor/` page any more (`apps/goomba-editor` is deleted); its two useful
  halves — reading a Figma clipboard, and handing a level to the real game —
  moved into `apps/goomba-glider` (`src/figma/`). Pressing `\` in the game opens
  the levels grid with editing on and forces the selector's gate (that IS what
  "\ turns on debug" means — `?debug` only ever overrode that one gate); `\`
  again goes straight back to playing. **The grid diverges by surface**, because
  a phone and a laptop want opposite things from a tap (`DESKTOP` in `main.js` —
  `(hover: hover) and (pointer: fine)`, read live, not latched at boot). A
  PHONE taps a card and the whole room jumps there, and that is the whole
  screen: no editing controls at all, the EMPTY pack included, since a phone
  has no Ctrl+V to follow them up with — the dead-end argument for showing
  them on an empty pack was only ever about the machine that can paste. A
  LAPTOP gets a file browser: a click SELECTS a card, a double-click plays it
  (hand-rolled off two presses, because touchstart is preventDefault'd here and
  a touchscreen laptop never gets a synthesised `dblclick`), **drag** reorders
  with a bar in the gap the drop lands in, and each card carries `⌫` delete —
  the only per-card button left. `◀ ▶` went with the drag, and `⧉` copy went
  too: it put the level on the clipboard as a link, which covered duplicating,
  sending and grading, and Figma now owns the first two (the frame is the
  source) while grading is nobody's — the gate is deleted and a level is judged
  by being played. `seed.mjs --pull` prints what an event is running.
  **Ctrl+V lands wherever you were looking.** On the grid that is the
  SELECTION: a card replaces that level, the trailing dashed slot appends, and
  there is no separate "aim the paste" button any more because a selection
  already says it. PLAYING, it is the level on the screen — a paste no longer
  bounces you out to the grid, because the level in front of you is what the
  paste meant (tweak the frame in Figma, Ctrl+C, Ctrl+V, watch it redraw under
  you). The only paste that still opens the grid is the one with nowhere else
  to land: an EMPTY pack, which has no level in front of you and no card to
  select. Two edits ask first, on the browser's own `confirm()` — a delete, and
  a paste whose level NAME differs from the level it lands on, card or played.
  A MATCHING name is a redraw of that level from the frame it came from, which
  is the tweak-copy-paste-verdict loop the editor exists for, so it goes
  straight through. The dialog is native rather than the canvas one it used to
  be precisely because a paste can now land with the grid shut, and a
  canvas-drawn question needs a grid to be drawn on.
  `src/figma/stitch.js` is the one non-obvious step: Figma stores terrain as one
  Line per segment, and the game strokes each polyline with round caps, so
  unstitched chains grow half-stroke stubs at every shared vertex (2.2 u of
  collision halo, 0.75 of core) instead of one clean `lineJoin`. It chains from
  BOTH ends, in either direction, and **welds**: hand-drawn joints are never
  exact — measured on *The Long Way Up* as drawn, seven joints, ONE exact, the
  rest 0.3-1.8 u apart, so an exact-match rule chains nothing real. `WELD` is
  2.0 u, and the ceiling is the game's own wedge rule (no two segments closer
  than 4.4 u = 2 × her radius), so anything under it was never a deliberate
  separation. A 45-58 u "one band goes here" gap is never touched. It also snaps a loose
  END onto a surface it was drawn against (a **T-junction** — a platform butting
  into a wall lands near the wall's MIDDLE, nowhere near either of its endpoints,
  so end-to-end welding never sees it). Level 1 stores its platform at x 124 and
  its wall at x 133: 0.9 u of overhang, a sliver under Figma's 15 px stroke and a
  visible stub on the game's 4.4 u halo. Terrain must
  be a **Line**; a `t` that is a pen path or rect is skipped with a warning,
  because reading its bbox edge would be a plausible straight segment that
  silently changes whether the level is winnable.
  **The FRAME's size is the world, not just its origin.** It arrives as the
  level's `frame` and `initLevel` UNIONS it into `bounds` — never replaces, so
  a frame drawn tighter than its own ink can only add nothing. Padding is a
  design decision (the empty run past a wall that a band is meant to reach out
  into), and before this it left no trace: `bounds` is derived from the ink, so
  every level re-cropped itself the moment it loaded. Bounds are the camera
  (there is no free pan) and three of the four deaths — so **resizing a frame
  is a design change even when the ink did not move; play it again.** More
  world is more forgiving, which is
  "closing a world makes it more forgiving" read from the other end. The box
  rides in the link (`codec.ts`, flags bit1, four coordinates at the TAIL —
  every offset before it is untouched, so live packs decode unchanged and an
  older bundle reads a new link right up to the frame and stops).
  **Before debugging "the geometry looks off", read "Testing this bridge" in
  `tools/goomba/figma/README.md`.** Two rounds of it were closed by reasoning
  about the code and shipping a fix that passed its own tests; both were wrong.
  The committed fixture is a GENERATED frame, so it proves nothing about
  hand-drawn geometry — read the real numbers off Figma's Design panel, A/B with
  encoded level links rather than by re-pasting, and remember `#hash` is read
  only at boot (a fragment-only navigation silently shows you the OLD level).
  A level still **saves by being a URL** — `encodeLevel` in
  `packages/shared/src/goomba/codec.ts` packs one into ~100–450 base64url chars,
  which is how a level travels before it is anywhere, and what a PACK is a list
  of. The codec lives in shared/ because the browser, the Worker and the node
  tools must agree on it byte for byte; never fork it. `tools/goomba/test-codec.mjs`
  is the proof, and the reason a new field rides at the tail behind a flag.
- **Levels live in the LOBBY Durable Object, as a pack of links.** That is the
  only copy: `GOOMBA_LEVELS` ships EMPTY and is filled by `setGoombaLevels` from
  whatever arrives. `packages/shared/src/goomba/pack.ts` is the shape (an
  ordered `string[]` of `encodeLevel` output); the lobby owns it, the goomba
  room reads it object-to-object (it scores runs, so it cannot take a phone's
  word for the geometry) and re-broadcasts it to phones as a separate `pack`
  message — separate because snapshots go out at 10Hz during a band drag and
  the pack has nothing new to say on any of them. Edits ride the ROOM socket
  (the lobby's is closed the moment a phone learns its team) and are forwarded
  to the lobby, which validates by DECODING, writes, and pokes all four
  `TEAM_IDS` rooms so a change lands mid-session.
  **There is no copy of any level in this repo.** `SEED_LEVELS` — five levels
  written out as TypeScript literals in `levels.ts`, which nothing read at play
  time — is DELETED. It was a transcription of drawings that live in Figma,
  maintained by hand in a third language, and its only jobs were seeding an
  event on day one and giving the bench something to index. A level's source is
  its Figma frame; a pack is what an event is running. `node seed.mjs --pull`
  prints that pack, `--push --file <pack.json>` moves one between events, and
  **a new event starts with no levels** — you fill it by pasting frames.
- **The pack can change under a live room**, and `GoombaSim.reconcile` is the
  whole of "apply immediately, keep progress": `completed` is re-fitted to the
  new length, `level` is clamped back inside the pack, a run in flight is
  abandoned (it was scored against geometry that may be gone), and the finish
  line is recomputed in both directions. It deliberately does NOT remap flags by
  identity — deleting a level shifts every flag after it. That is the accepted
  cost of editing live.
- **Four bands for the ROOM, and no rule about whose**: any player may lay any
  of the four and lift any of them, their own or a teammate's (`canPlaceBand` in
  `goomba/sim.ts` is the whole check — `bands.length < MAX_BANDS`). The
  per-player quota of ⌈4 / connected players⌉ that used to force one band each
  is **reverted, on purpose** — the game is multiplayer because four people
  share four bands, not because the room rations them (README, "The four
  bands"). `node bands.mjs` is the test on that, and it is a test of SHIPPED
  code, not of a level; solo play needs no special case, since one phone was
  never capped.
  **There is no rule about what a LEVEL must require.** There was: "every level
  must genuinely REQUIRE all 4 bands", enforced by a simulation bench, and both
  are deleted — see the next bullet.
- **A band wears the TEAM's colour** — `earsFor(team).ink` from `shared/ears.ts`,
  the same ink the proctor's board and the cat-ear headbands use. One colour for
  every band on the board, because no band belongs to a player; the four-colour
  palette left in `main.js` (`PARTY_COLORS`) is confetti and bunting only. The
  testing room (t0) and `?solo` have no team, and fall back to the old pink.
- **THE GATE IS DELETED, and so is the bench under it.** `verify.mjs` (the
  PASS/FAIL battery a level had to clear before shipping), `route`, `trace`,
  `slack`, `scan`, `solve`, `minbands`, `reach`, `search`, `searchall`,
  `robust`, `diag`, `ridecards`, and `packages/shared/src/goomba/gate.ts` — all
  gone, with the 4-band rule they existed to enforce. **A level is evaluated by
  people playing it.** Don't rebuild any of it, don't add a verdict to a level
  card, and don't write "must pass" into a doc: this was tried, at length, and
  four people around a table found what mattered sooner and said WHY. Git
  history has every line if a question ever genuinely needs a simulator.
  The level's `solution` field went with it — the baked answer key the gate
  graded against — and that cost a **codec version bump to fmt 2**, because
  `nSolution` sat unconditionally in the middle of the layout where no flag
  could excuse it. `decodeLevel` still reads fmt 1 (and discards the solution),
  so every link in every lobby survives; `encodeLevel` only writes 2. **A fmt-2
  link is unreadable by an older bundle** — it refuses it rather than
  misreading it, which is the property the bump was bought for — so this one
  needs the Worker out first (see "Deploy order").
- **Five levels were designed here** — Welcome to Goomba Glider, The Long Way
  Down, The Long Way Up, Cat's Cradle, There and Back Again. They are frames in
  Figma now, not code; the numbers below were measured on those boards with a
  bench that no longer exists, and the PATTERNS are what survives them, written
  up in DESIGNING.md. The Skim, The Puzzle Box, Pillow Fort, Mind the Gap, The
  Popper Grid, Pop Goes Goomba, Popper Pinball, Piñata Alley, Space Cadet and
  Slalom were cut earlier. **Level numbers in these notes are historical** —
  a number is a position in a pack, and nothing renumbers a pack but the pack. **A level's display number is its array index + 1, computed where it
  is shown and stored nowhere** — `levelLabel` in `goomba/levels.ts`, used by
  the selector's cards, the level-change toast and the proctor's Goomba line.
  So removing, inserting or DRAGGING one renumbers the whole pack for free; a
  `name` is just a name, and typing a number into one now double-numbers the
  card. The last level is the finale: `nextLeadsToSplash` and the selector's
  clear-every-level gate both key off the LAST index, so adding a level moves
  the splash behind it.
- **The Long Way Up (3) is the one to read first if you are building from a
  sketch**: one concave-up slope she RIDES, poppers shooting her along it, three
  long rough steps notched perpendicular into it for the players' bands to chord
  across, and a bumper at the top that mirrors her into a flat run home across
  three cans. Two of its lessons generalise — cut obstacles perpendicular to the
  surface she rides (a vertical wall becomes a rail that carries her up past the
  rim), and put every band end on a terrain vertex ~9 units clear of its
  neighbours so snap absorbs finger slop (29/30 at ±3u on a level that is
  otherwise exact ballistics).
- **Fencing a world makes it more forgiving.** The Long Way Down, drawn in
  Figma and pasted in, dropped from three jobs to two the moment both edges were
  fenced: two of its jobs were only jobs because failing them threw her out of
  the world, and a fence does that work for free. Reopening the right edge put
  the third back, and with it three different deaths (stall / off-the-left /
  flew-off-the-right). Worth remembering before fencing anything else — and it
  is the same fact as "a bigger frame is a more forgiving level", read from the
  other end.
  There and Back Again grew from a hand sketch over several rounds and was the
  best-measured board here: the bare run failed, all three bands were
  load-bearing with three different deaths, and it survived ±3u of finger slop
  22 times in 30 — the best any board managed with a bumper in the loop. Its
  fourth can at (13,54) is a TOLL BOOTH: it sits on the ↙ popper's 135° throw arc, so the
  only way to collect it is to actually be thrown by that popper, which is what
  stops winning lines threading past it. Its ↙ return
  popper is the piece that was wrong twice, and the lesson is the sentence after
  this one (it used to live in a comment in `levels.ts`, which is deleted):
  what matters is whether a popper's aim has ROOM downrange, and the fix for a
  135° throw that overshot the world's left edge was moving the LANDING popper
  left, not re-aiming the thrower.
  Don't copy the structure of the teaching level; copy **The Long Way Up** (a ridden slope
  with perpendicular notches), **Cat's Cradle** (four one-way popper lanes,
  sparse and staggered, where the players' bands are the only walls — it
  replaced The Popper Grid's dense version of the same idea and is more
  robust), or the
  four-different-deaths chain the removed Four Ways to Help demonstrated —
  those levels are gone, the patterns are written up in DESIGNING.md. The
  shelf-gated switchback that Mind the Gap demonstrated is still a good
  pattern and still written up there too — those levels are gone, their
  findings are not.
- **A sketch is a spec, and the toys in it carry the scale**: a popper's dashed
  ring is 6 units, a can's 7.5, so one ring measured in pixels converts the
  whole drawing (DESIGNING.md, "Transcribing a sketch"). Cat's Cradle came in
  as a picture; the rings not touching was the design.
- Parallel level threads no longer collide in a file: a level is a frame in
  Figma and a link in an event's pack, so two people designing at once share
  nothing but the pack itself — and a `packSet` writes one slot. What they do
  share is the EVENT: a paste is live for all four phones a second later, so
  point a second thread at its own event rather than editing over a party in
  progress.

## Repo invariants (violating these has burned us before)

- **Deploy order**: the Worker must go out BEFORE a Vercel deploy that depends
  on new protocol/DO classes. CI deploys it (`.github/workflows/deploy-worker.yml`,
  on push to main touching `server/**` or `packages/shared/**`), but that RACES
  Vercel's push build rather than ordering it — for a breaking change, run the
  workflow manually on the branch first, confirm it's live, then merge.
  `wrangler.jsonc` migrations are APPEND-ONLY (new class = new tag, never edit
  an old one). Renaming a Worker or DO class orphans its storage.
- **One origin**: vanity domains (hexxygon.com, g00.mba) REDIRECT to
  cat-games-tau.vercel.app — never turn them into rewrites; the localStorage
  pid (team identity) only follows players on one origin. No `?room=` params,
  ever — the lobby is the only way into a team.
- **Vite `base` is absolute** per app and must match its `dist/` subdirectory
  (`/hexxygon/`, `/g00mBa/` — casing is load-bearing). `npm run build:vercel`
  runs `check-routing.mjs`; keep its expectations current.
- **Two cursors in the games, ever**: `pointer` if a tap does something,
  `default` if it does not. These are phone games — almost nobody playing has a
  cursor, so a third value cannot be telling players anything, it can only be
  inconsistent (the shop shipped `not-allowed` for "too expensive" and `default`
  for "still locked", two disabled states telling two stories). `npm run
  build:vercel` runs `check-cursors.mjs`, which fails on anything else in
  apps/{hex-clicker,goomba-glider,lobby,chat}. `apps/proctor` and `tools/` are
  deliberately exempt: one operator, one laptop, and `grab`/`crosshair` are
  doing real work there. Note the level editor is now INSIDE goomba-glider, so
  it lives under the rule — its grid controls are taps, not drags, and that is
  part of why.
- **Proctor box heights are fixed**: every stat line renders in every state
  (placeholders, never fewer lines) so boxes don't shift under a drag.
- **Goomba Glider's level selector is EARNED; `?debug` and `\` only override
  that gate**: a room that has cleared every level (`goombaCleared` = `finishedAt`
  set, in `goomba/sim.ts`) unlocks the **levels** grid for all four phones on
  the same snapshot, and a proctor **reset** takes it back with the rest of the
  room state. The level dots top-left ARE its button: once unlocked the dot
  strip wears a plate and a ▦, and tapping it opens the grid — every level as a
  card drawn from its own geometry (Goomba idle on her `start`, the plant on the
  goal) under its name, and tapping a card jumps THE WHOLE ROOM to that level (a
  real wire intent; teammates follow). **A card carries NO verdict**, and both
  the ones it used to are gone for the same reason. It graded a baked
  `solution` — dashed `band` layers drawn into the Figma frame and carried
  through the codec, back when a level had such a field — which had to be re-drawn by hand every time the geometry
  moved, and a stale one graded green; then it graded the BARE run alone, which
  was honest but was one word about a level, and it cost a full sim of every
  level just to open the menu. Nothing grades a level now — the bench that did
  is deleted and people playing it is the answer — so a card has nothing true
  to say in one word. Don't put a verdict back on one. `?debug` puts one phone in the unlocked
  state without playing the game first — that is ALL it does now, so don't add
  features behind it that a cleared room doesn't get.
  `?solo` runs the same grid on the in-page sim with no server. Testing on
  prod: `/proctor`, assign yourself to a team, open the game with `?debug`. Hex
  keeps `?debug&speed=N` for balance work.
- **NEXT off the finale of a cleared room lands on the `splash` phase**, not a
  victory lap: the congratulations screen (`drawSplash` in `main.js`) — a BLACK
  screen with CONGRATULATIONS, what the room just cleared and the way on drawn
  on it (`drawSplashWords`), and no other control than the level selector the
  clear just unlocked. There is no picture here: the stand-in art
  (`public/art/splash.webp`) is deleted, along with the edge-sampler that
  continued its sky past the ends of a tall phone, and this app now loads no
  image asset at all. The words are on the CANVAS rather than in the HUD because
  they are the screen — every line shrinks to fit rather than wrapping, since a
  canvas has no wrapping and a 320px phone silently ran them off both sides, and
  the block centres now that there is no art to sit clear of. **The whole screen
  is the way on** — a tap
  anywhere opens the levels grid (`splashTap`), the dot strip's plate still does
  too, and both call one `openSelector` so the gate cannot differ between them.
  The tap fires on the RELEASE, so the grid never inherits the tail of the
  gesture that opened it (a phone plays a card on the press). Nothing places or
  plays from the splash; the ways out are a `goto` and a proctor reset.
  `nextLeadsToSplash` is the one predicate for the transition into it — the PLAY
  button's "FINISH ▸" label reads it too.
- **The splash picture is HEX's, and it is a drop-in file**:
  `apps/hex-clicker/public/art/hex-splash.webp`. Goomba's copy is gone — its
  splash is black now (see the congratulations screen above) — and the two were
  always separate files rather than one shared asset, which is what let one game
  drop its picture without touching the other. Replace hex's file and nothing in
  code changes: it shows the WHOLE picture, fitted on whichever axis binds —
  width on a phone (far narrower than it is tall), height on a laptop (wider
  than it is proportionally tall, so a width fit would overflow and eat the cat
  off the top) — and fills the slack with sky SAMPLED from the picture's own
  edges: the flat top and bottom rows above and below it, a ramp between those
  two beside it. Don't hardcode a sky, and don't go back to cropping either
  axis. If Goomba ever wants a picture again, that sampler is the pattern to
  copy back (`skyStops` still lives in hex's `phase.js`; git has Goomba's).
- **Goomba's waiting screen IS its how-to-play sheet, and it is PICTURES**:
  the gate that a phone waits on before the proctor sorts it in shows the game's
  title, two scenes and two short captions — where she is going (past every can,
  home to the plant) and what the players do about it (lay bands in her way).
  The scenes are drawn by the RENDERER, not by hand: `GOAL_SCENE` / `BAND_SCENE`
  in `main.js` are level-shaped literals, and `drawScene` points the module's
  `ctx`/`W`/`H`/`cam` at the sheet's little canvases and back — the same trick
  the level cards play, and the reason a can in the picture cannot drift from a
  can in the game. `?` bottom-left (PLAY's corner, mirrored) re-opens the same
  element mid-party. `.ready` is the dismissible wearing — a tap anywhere or any
  key, with the connection lines swapped for the way out — and the sheet
  **never dismisses itself**: the first snapshot only ARMS it (`armSheet`), so
  the player taps past the pictures rather than having them yanked away the
  instant the proctor sorts the phone in. The exception is the grid already
  being open (`?solo`, a pasted level), where `#hud.lab > *` would hide the
  sheet anyway. The tap is bound to **pointerdown, not click** — the kiosk
  lockdown preventDefault()s touchstart off buttons and links, which kills the
  synthesised click, so an `onclick` here dismisses on a laptop and does
  nothing on a phone (it shipped that way once). That `?` button is the point
  of the redesign — the old four-sentence gate was read once, by whoever was
  looking, and nothing ever brought it back. Don't add a second copy of these
  instructions anywhere; edit the sheet.
- **Hex's win is the PROCTOR's press, and it unlocks a splash you can toggle
  away from**: hex cannot score its own win — the code word leaves the game on a
  phone and comes back as four people reading it out — so `wonAt`
  (`hex/sim.ts`, `hexWon`) is set by a proctor-only `won` intent, the 🏆 button
  in each team's Hex box. A toggle, not a latch (a mis-pressed team box must not
  need a whole-game reset), and taking a win BACK confirms while granting it
  does not. Room state like everything else: all four phones light up on one
  snapshot, it survives a reload, a reset clears it. `#wonPill` top-left is the
  only control the win adds, and it ping-pongs — `🏆 win screen` ⇄ `← back to
  game` — because the night wall they just read is what they EARNED and a victory
  screen that buried it for good would be taking it away. Which of the two a
  phone is looking at is LOCAL (Goomba's card taps move what the room PLAYS, so
  those are wire intents; these are one room state seen two ways). The splash
  raises itself once, on the live edge only — a rejoin gets the pill, not a
  replayed celebration, exactly as the night cutscene never replays. `?debug`
  gets a 🏆 toggle in the 🛠 panel so the screen is testable without a proctor.

## Commands

```sh
npm run dev            # everything: server :1999, hex :5173, goomba :5178,
                       # proctor :5175, lobby :5176, chat :5177
npm run typecheck      # all workspaces
npm run build:vercel   # full build + assemble + routing & cursor checks
npm run check:cursors  # the two-cursor rule, on its own
cd tools/goomba && node bands.mjs          # the room's band budget (4, and no rule about whose)
cd tools/goomba && node test-codec.mjs     # the save format (a link round-trips; old links still decode)
cd tools/goomba && node seed.mjs --pull    # what is the event running right now?
cd tools/goomba && node seed.mjs --push --file pack.json  # move a pack between events
```

`npm run dev` no longer starts an editor on :5179 — press `\` in the game
instead. **There is no command that evaluates a level**, and that is the whole
of the change: the bench that used to (`verify.mjs` and twelve others) is
deleted, so a level is designed in Figma, pasted in, and played. `?solo` for the
in-page sim, `/proctor` + `?debug` for a real room.

The three commands left need no levels except `figma/levels-to-svg.mjs`, which
draws a pack as artboards and takes one from `--pack <file>`, `GOOMBA_PACK`, or
a gitignored `pack.json` in `tools/goomba/` (`seed.mjs --pull > pack.json`).
