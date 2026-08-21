# Escape Cats — working notes for Claude threads

Two coop 4-player party games (Hex Clicker, Goomba Glider) on one Cloudflare
Worker + one Vercel deploy. The [README](./README.md) is the full map; these
are the invariants that bite.

## Goomba Glider level design (most common task)

**Start at [`tools/goomba/DESIGNING.md`](./tools/goomba/DESIGNING.md).** It is
the whole loop, the physics cheat sheet, and the accumulated anti-shortcut
findings — do not design from intuition, the sim disproves it reliably.

- **The Figma paste target** (`apps/goomba-editor`, served at `/editor/`,
  :5179 in dev) **authors nothing.** All level design happens in Figma now (see
  [`tools/goomba/figma/README.md`](./tools/goomba/figma/README.md) for the kit
  and the naming contract); this page takes a copied frame, reads it with
  `src/figma-svg.js`, and previews it. **PLAY FOR REAL hands it to the actual
  game** — `/g00mBa/?solo#<hash>`, where `adoptHashLevel` appends it to
  `GOOMBA_LEVELS` and the shipped client plays it with real band placement, the
  real quota and real scoring. Appending to that array rather than teaching the
  sim a second kind of level is what makes it indistinguishable; the one thing
  that must not disagree is the array's LENGTH, so the push happens before
  `new GoombaSim`, which sizes `completed` from it. A pasted level differs from
  a shipped one in exactly two places: it is marked `PASTED — not in levels.ts`
  on a dashed card in the selector, and only the editor offers copy-link.
  Solo only — a real room scores on the server, and the server has never heard
  of it. There is no tool palette,
  no selection, no undo — wrong level, fix it in Figma and paste again. It kept
  the URL codec because that is how a pasted level reaches the gate.
  A level **saves by being a URL** — `encodeLevel`
  in `packages/shared/src/goomba/codec.ts` packs one into ~100–450 base64url
  chars, so designs travel as links and `node verify.mjs --hash <link>` gates
  one that was never committed. The codec lives in shared/ because the browser
  and the node bench must agree on it byte for byte; never fork it. Same for
  `goomba/gate.ts` — the thresholds that DEFINE a pass (jitter, hunt grid,
  legal-band lattice) are one copy that both graders import.
- Levels live in **`packages/shared/src/goomba/levels.ts`** — the ONLY copy
  (the prototype is deleted). Server scoring, phone animation, and the design
  tools all run this exact code.
- **The party rule is locked: every level must genuinely REQUIRE 4 bands**
  (4 players × 1). Not "allow" — require. Its other half is enforced in code:
  a player may hold at most **⌈4 / connected players⌉** bands at once
  (`bandQuota` in `goomba/sim.ts`), so four players is one each. Geometry that
  needs 4 bands + a cap of 1 each = nobody spectates. `node quota.mjs` is that
  half's gate; a lone tester is `n=1`, quota 4, so solo play still works.
- **The gate: `cd tools/goomba && node verify.mjs <levelIdx>`** must print
  PASS before a level ships. It runs the bare/solution checks, load-bearing +
  finger-slop robustness, the exhaustive/randomized minimum-band search, and
  a beam-search shortcut hunt. If verify finds a 1-band win, the level is
  broken no matter how clever the design felt.
- **Five levels ship, and TWO pass the gate — The Long Way Up (2) and Cat's
  Cradle (4).** The Skim, The Puzzle Box, Pillow Fort, Mind the Gap, The Popper
  Grid, Pop Goes Goomba, Popper Pinball, Piñata Alley and Space Cadet were cut,
  and the survivors renumbered — a level's display number is its array index +
  1, so removing or inserting one renumbers everything after it (and the
  numbers live in the `name` strings, so renumbering means editing them). Up
  the Middle (5) is the finale: `nextLeadsToSplash` and the selector's
  clear-every-level gate both key off the LAST index, so adding a level moves
  the splash behind it.
- **The Long Way Up (2) is the one to read first if you are building from a
  sketch**: one concave-up slope she RIDES, poppers shooting her along it, three
  long rough steps notched perpendicular into it for the players' bands to chord
  across, and a bumper at the top that mirrors her into a flat run home across
  three cans. Two of its lessons generalise — cut obstacles perpendicular to the
  surface she rides (a vertical wall becomes a rail that carries her up past the
  rim), and put every band end on a terrain vertex ~9 units clear of its
  neighbours so snap absorbs finger slop (29/30 at ±3u on a level that is
  otherwise exact ballistics).
- Levels 1, 3 and 5 need fewer than 4 bands — the standing debt. Re-measured
  with `minbands`/`solve`, not inherited: The Long Way Down (1) needs **3** and
  Slalom (3) needs 3; 5 is a testbed, not a shipped puzzle. Level 1 is now
  drawn in Figma and pasted in, and one pass of it dropped to 2 bands by
  FENCING the world at both edges: two of its three jobs were only jobs because
  failing them threw her out of the world, and a fence does that work for free.
  **Closing a world makes it more forgiving** — worth remembering before fencing
  anything else. Reopening the right edge put it back to 3, and to three
  different deaths (stall / off-the-left / flew-off-the-right). The
  old blanket "these all collapse to 1 band" note was stale for both — if you
  are about to repeat a debt claim, re-run the tool first. Level 3 predates the
  party rule; level 1 joined it on purpose, rebuilt to a hand sketch whose
  silhouette has no room for a 4th gate (DESIGNING.md has the
  reachability sweep that proves no can placement fixes it).
  There and Back Again (5) grew from a hand sketch over several rounds and is the
  near-miss: bare fails, all three bands load-bearing with three different
  deaths, and finger slop 22/30 — the best any board here has scored with a
  bumper in the loop. It fails only the party rule, at 3 bands. Its fourth can
  at (13,54) is a TOLL BOOTH: it sits on the ↙ popper's 135° throw arc, so the
  only way to collect it is to actually be thrown by that popper, which is what
  stops winning lines threading past it. Its ↙ return
  popper is the piece that was wrong twice, and the lesson is in `levels.ts`:
  what matters is whether a popper's aim has ROOM downrange, and the fix for a
  135° throw that overshot the world's left edge was moving the LANDING popper
  left, not re-aiming the thrower.
  Don't copy the structure of 1 or 3; copy **The Long Way Up** (a ridden slope
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
  apps/{hex-clicker,goomba-glider,lobby,chat}. `apps/proctor`,
  `apps/goomba-editor` and `tools/` are deliberately exempt: one operator, one
  laptop, and `grab`/`crosshair` are doing real work there.
- **Proctor box heights are fixed**: every stat line renders in every state
  (placeholders, never fewer lines) so boxes don't shift under a drag.
- **Goomba Glider's level selector is EARNED, and `?debug` only overrides that
  gate**: a room that has cleared every level (`goombaCleared` = `finishedAt`
  set, in `goomba/sim.ts`) unlocks the **levels** grid for all four phones on
  the same snapshot, and a proctor **reset** takes it back with the rest of the
  room state. The level dots top-left ARE its button: once unlocked the dot
  strip wears a plate and a ▦, and tapping it opens the grid — every level as a
  card with live bare/solution verdicts, and tapping a card jumps THE WHOLE
  ROOM to that level (a real wire intent; teammates follow). `?debug` puts one
  phone in the unlocked state without playing the game first — that is ALL it
  does now, so don't add features behind it that a cleared room doesn't get.
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
cd tools/goomba && node quota.mjs          # the participation gate (room rule)
```
