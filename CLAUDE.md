# Escape Cats — working notes for Claude threads

Two coop 4-player party games (Hex Clicker, Goomba Glider) on one Cloudflare
Worker + one Vercel deploy. The [README](./README.md) is the full map; these
are the invariants that bite.

## Goomba Glider level design (most common task)

**Start at [`tools/goomba/DESIGNING.md`](./tools/goomba/DESIGNING.md).** It is
the whole loop, the physics cheat sheet, and the accumulated anti-shortcut
findings — do not design from intuition, the sim disproves it reliably.

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
  source) while grading a live event reads the pack off the lobby instead —
  `seed.mjs --pull` prints it, `verify.mjs --pack` grades all of it at once.
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
  **Before debugging "the geometry looks off", read "Testing this bridge" in
  `tools/goomba/figma/README.md`.** Two rounds of it were closed by reasoning
  about the code and shipping a fix that passed its own tests; both were wrong.
  The committed fixture is a GENERATED frame, so it proves nothing about
  hand-drawn geometry — read the real numbers off Figma's Design panel, A/B with
  encoded level links rather than by re-pasting, and remember `#hash` is read
  only at boot (a fragment-only navigation silently shows you the OLD level).
  A level still **saves by being a URL** — `encodeLevel` in
  `packages/shared/src/goomba/codec.ts` packs one into ~100–450 base64url chars,
  which is both how `node verify.mjs --hash <link>` grades an uncommitted level
  and what a PACK is a list of. The codec lives in shared/ because the browser,
  the Worker and the node bench must agree on it byte for byte; never fork it.
  Same for `goomba/gate.ts`.
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
  `packages/shared/src/goomba/levels.ts` still holds the five designed levels as
  **`SEED_LEVELS`** — nothing reads them at play time; they are the day-one
  seed and the worked examples DESIGNING.md is written about. `node seed.mjs
  --push` loads them into an event; `--pull` prints what an event is running.
  **A new event starts with no levels.**
- **The pack can change under a live room**, and `GoombaSim.reconcile` is the
  whole of "apply immediately, keep progress": `completed` is re-fitted to the
  new length, `level` is clamped back inside the pack, a run in flight is
  abandoned (it was scored against geometry that may be gone), and the finish
  line is recomputed in both directions. It deliberately does NOT remap flags by
  identity — deleting a level shifts every flag after it. That is the accepted
  cost of editing live.
- **The 4-band rule is locked: every level must genuinely REQUIRE 4 bands.**
  Not "allow" — require. There are four bands for the ROOM and **no rule about
  whose**: any player may lay any of the four and lift any of them, their own or
  a teammate's (`canPlaceBand` in `goomba/sim.ts` is the whole check —
  `bands.length < MAX_BANDS`). The per-player quota of ⌈4 / connected players⌉
  that used to force one band each is **reverted, on purpose** — the game is
  multiplayer because four people share four bands, not because the room
  rations them (README, "The four bands"). That revert makes the level gate the
  only thing left: with nobody rationed, a level that wins on one band is a
  level three people watch. `node bands.mjs` gates the room half; solo play
  needs no special case, since one phone was never capped.
  **One level is exempt, on purpose: Welcome to Goomba Glider (1)**, the
  teaching level that ships first. It wants ONE band, because it is the thirty
  seconds before anyone has seen a band work — a floor, a gap in the middle,
  and the only thing a player can do is the thing the game is about.
  `verify.mjs` fails it at check 2 and always will; that is the rule doing its
  job, not a defect. Nothing after it is exempt.
- **A band wears the TEAM's colour** — `earsFor(team).ink` from `shared/ears.ts`,
  the same ink the proctor's board and the cat-ear headbands use. One colour for
  every band on the board, because no band belongs to a player; the four-colour
  palette left in `main.js` (`PARTY_COLORS`) is confetti and bunting only. The
  testing room (t0) and `?solo` have no team, and fall back to the old pink.
- **The gate: `cd tools/goomba && node verify.mjs <levelIdx>`** must print
  PASS before a level ships. It runs the bare/solution checks, load-bearing +
  finger-slop robustness, the exhaustive/randomized minimum-band search, and
  a beam-search shortcut hunt. If verify finds a 1-band win, the level is
  broken no matter how clever the design felt.
- **Five levels ship, and TWO pass the gate — The Long Way Up (3) and Cat's
  Cradle (4)** (Welcome to Goomba Glider (1) is the deliberate exemption
  above). The Skim, The Puzzle Box, Pillow Fort, Mind the Gap, The Popper
  Grid, Pop Goes Goomba, Popper Pinball, Piñata Alley, Space Cadet and Slalom
  were cut. **A level's display number is its array index + 1, computed where it
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
- Levels 2 and 5 need fewer than 4 bands — the standing debt. Re-measured
  with `minbands`/`solve`, not inherited: The Long Way Down (2) needs **3**;
  5 is a testbed, not a shipped puzzle. The Long Way Down is now
  drawn in Figma and pasted in, and one pass of it dropped to 2 bands by
  FENCING the world at both edges: two of its three jobs were only jobs because
  failing them threw her out of the world, and a fence does that work for free.
  **Closing a world makes it more forgiving** — worth remembering before fencing
  anything else. Reopening the right edge put it back to 3, and to three
  different deaths (stall / off-the-left / flew-off-the-right). The
  old blanket "these all collapse to 1 band" note was stale for both — if you
  are about to repeat a debt claim, re-run the tool first. Level 1 joined the
  debt on purpose, rebuilt to a hand sketch whose
  silhouette has no room for a 4th gate (DESIGNING.md has the
  reachability sweep that proves no can placement fixes it).
  There and Back Again (4) grew from a hand sketch over several rounds and is the
  near-miss: bare fails, all three bands load-bearing with three different
  deaths, and finger slop 22/30 — the best any board here has scored with a
  bumper in the loop. It fails only the 4-band rule, at 3 bands. Its fourth can
  at (13,54) is a TOLL BOOTH: it sits on the ↙ popper's 135° throw arc, so the
  only way to collect it is to actually be thrown by that popper, which is what
  stops winning lines threading past it. Its ↙ return
  popper is the piece that was wrong twice, and the lesson is in `levels.ts`:
  what matters is whether a popper's aim has ROOM downrange, and the fix for a
  135° throw that overshot the world's left edge was moving the LANDING popper
  left, not re-aiming the thrower.
  Don't copy the structure of 1; copy **The Long Way Up** (a ridden slope
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
- Parallel level threads: work on your own branch — `levels.ts` is where
  every level thread edits, and sharing a branch collides.

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
  through the codec — which had to be re-drawn by hand every time the geometry
  moved, and a stale one graded green; then it graded the BARE run alone, which
  was honest but was one word about a level, and it cost a full sim of every
  level just to open the menu. Grading is `verify.mjs`'s: it SEARCHES for a
  solution rather than being told one, and says far more than a card can hold.
  Don't put a verdict back on a card. `?debug` puts one phone in the unlocked
  state without playing the game first — that is ALL it does now, so don't add
  features behind it that a cleared room doesn't get.
  `?solo` runs the same grid on the in-page sim with no server. Testing on
  prod: `/proctor`, assign yourself to a team, open the game with `?debug`. Hex
  keeps `?debug&speed=N` for balance work.
- **NEXT off the finale of a cleared room lands on the `splash` phase**, not a
  victory lap: a terminal screen (`drawSplash` in `main.js`) that is one
  full-screen picture and nothing else — its only control is the level selector
  the clear just unlocked. Nothing places or plays from it; the ways out are a
  `goto` and a proctor reset. `nextLeadsToSplash` is the one predicate for that
  transition — the PLAY button's "FINISH ▸" label reads it too.
- **The splash pictures are drop-in files, and there are TWO of them**:
  `apps/goomba-glider/public/art/splash.webp` and
  `apps/hex-clicker/public/art/hex-splash.webp`. Same image today (the cat on
  the moon) as a deliberate stand-in until Goomba has its own; two copies
  because the apps are separately deployed bundles and are expected to diverge,
  not one asset shared. Replace a file and nothing in code changes: both games
  show the WHOLE picture, fitted on whichever axis binds — width on a phone (far
  narrower than these are tall), height on a laptop (wider than they are
  proportionally tall, so a width fit would overflow and eat the cat off the
  top) — and fill the slack with sky SAMPLED from the picture's own edges: the
  flat top and bottom rows above and below it, a ramp between those two beside
  it. Don't hardcode a sky, and don't go back to cropping either axis.
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
cd tools/goomba && node verify.mjs <idx>   # the level-design gate
cd tools/goomba && node route.mjs <idx> drop  # the ride + its four deaths
cd tools/goomba && node slack.mjs <idx>    # per-band forgiveness (jitter/slide/stretch)
cd tools/goomba && node verify.mjs --hash <editor link>   # same gate, no diff
cd tools/goomba && node verify.mjs --file <file of links> # ...on a batch
cd tools/goomba && node bands.mjs          # the room's band budget (4, and no rule about whose)
cd tools/goomba && node seed.mjs           # print the seed pack
cd tools/goomba && node seed.mjs --push    # …load it into a running event
cd tools/goomba && node seed.mjs --pull    # what is the event running right now?
```

`npm run dev` no longer starts an editor on :5179 — press `\` in the game
instead. The bench (`lib.mjs`) loads `SEED_LEVELS` on import so `verify.mjs
<idx>` still indexes the five designed levels exactly as before; `usePack`
points it at an event's real pack.
