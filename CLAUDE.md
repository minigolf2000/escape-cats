# Escape Cats — notes for Claude threads

Two SINGLE-PLAYER games (Hex Clicker, Goomba Glider), each its own Vercel site,
no server of any kind. [README.md](./README.md) is the map and the rulebook;
each app's `src/README.md` is its module map. This file is the short list of
things that bite.

They were four-player co-op games for a physical escape room, run from a
proctor's dashboard over a Cloudflare Worker. **All of that is deleted** — the
Worker and its four Durable Objects, the lobby, the team chat, the proctor,
the player roster, names, teams, ad-hoc rooms and the wire protocol. If you
find a comment that still talks about a room, a team or the proctor, it is
stale: fix it rather than working around it.

## Map

```
apps/hex-clicker/      player client (hexxygon.com)  src/README.md
apps/goomba-glider/    player client (g00.mba)       src/README.md
packages/shared/src/   hex/{data,rules,sim}, goomba/{levels,physics,sim,codec,library,levels.data}
tools/goomba/          DESIGNING.md, the Figma bridge (figma/), level + draft commands
scripts/               assemble + the three build checks (routing, cursors, visibility)
```

Most edits are: CSS/UI in a game client's `styles.css`/`main.js`, a shared rule
in `packages/shared`, or a Goomba level (which is a Figma frame, not code —
see below).

## The shape of a client — don't break this

```
input -> transport.send(intent) -> backend -> sim -> snapshot -> onSnapshot -> UI
```

`backend.js` runs the shared sim in the tab and saves to `localStorage`. The
seam is where a room server used to be, and it STAYS: the UI hangs off snapshot
EDGES (`e.wonFlip`, `e.reset`, a phase change), and those are differences
between two snapshots. **Nothing calls a sim method directly.** The one
sanctioned exception is hex's 🛠 `?debug` panel, a tuning bench reaching past
the game on purpose — keeping its moves out of the intent list is what stops
any of them becoming something a player can do.

## Commands

```sh
npm run dev            # hex :5173, goomba :5178 — both at /
npm run typecheck      # both workspaces
npm run build:sites    # build + assemble both sites + every check
npm run test:goomba    # codec + progress identity + the shipped list
cd tools/goomba && node test-codec.mjs        # save format
cd tools/goomba && node test-library.mjs      # progress across a changed list
cd tools/goomba && node levels.mjs            # what the game ships
cd tools/goomba && node bands.mjs             # band rule
cd tools/goomba/figma && node test-*.mjs      # the Figma readers
```

Open either game and play; there is nothing to join. `?debug` mounts hex's 🛠
panel (`?debug&speed=N` fast-forwards) and opens goomba's levels grid early;
`\` does the same from the keyboard in both.

## Goomba levels (the most common task)

Start at [`tools/goomba/DESIGNING.md`](./tools/goomba/DESIGNING.md). Draw in
Figma, Ctrl+V into the game, play it, export, commit.

- **The shipped list lives in `packages/shared/src/goomba/levels.data.ts`**, one
  `{ id, name, hash }` row per level — ten of them, read out of the Figma Levels
  page (`47:2`) frame by frame through the shipped reader. This REPLACED "no
  level lives in this repo": that rule described a pack that was an event's live
  state in a lobby Durable Object, and there is no event and no lobby. Figma is
  still a level's SOURCE; a row is what a frame becomes when it ships, so to
  change one, change the frame and re-paste it. `name` is a readable copy of a
  name that really lives inside `hash`; `npm run check:levels` fails if the two
  drift, or if an `id` is empty or duplicated.
- **Nothing grades a level.** Still true and not negotiable. The simulation
  bench and its 4-band gate are deleted on purpose — don't rebuild them, don't
  put a verdict on a level card, don't write "must pass" into a doc.
- **A paste is LOCAL now.** It lands in this browser's overlay (`library.js`),
  after the shipped levels, visible to nobody else. `export` in the grid copies
  the overlay as `levels.data.ts` rows; that copy-paste and its review are the
  whole publishing pipeline, and they are deliberately a human's job.
- **Progress is keyed by a level's `id`, never its index** (`goomba/library.ts`,
  `test-library.mjs`). Reorder, rename or retune-and-re-paste and a cleared
  level stays cleared; change the `id` and it un-clears. `GoombaSim.reconcile`
  still re-fits `completed` BY INDEX and still should — so the id projection is
  handed to it as an argument, applied before the re-fit (`backend.js`,
  `applyLibrary`). An id in the save that is not in the list is left alone,
  which is what makes deleting a level and pasting it back a no-op.
- **Figma file `vRN6Q44ReIaESP5wv8M2dI`: Levels page `47:2`, Components `45:55`,
  Scratchpad `0:1`.** `get_metadata` with no nodeId lists only `Components` —
  go straight to `47:2`. **Never take a position from `get_metadata`**: it gives
  a node's ORIGIN and its BOUNDING BOX with no rotation, so `x + w/2` is wrong
  for anything rotated. Use `figma/read-frame.mjs --nodes` (a read-only
  `use_figma` dump) or `--clipboard` (a saved Ctrl+C).
- **The selector is the editor; `\` is only the door.** Editing controls depend
  on the SURFACE (`editorOn` in `state.js`, read live): a laptop always has ⌫ and
  drag, a phone never does. Ctrl+V lands on what you were looking at; only an
  empty list opens the grid. Delete, and a paste whose name differs, confirm on
  the browser's own `confirm()`; a matching name goes straight through. ⌫, drag
  and paste-over act on the OVERLAY only — a shipped level has no ⌫, because it
  is source and the way to change it is a commit.
- **`stitch.js` welds Figma's one-Line-per-segment terrain into polylines**
  (`WELD` 2.0 u, under the 4.4 u wedge rule) and snaps loose ends onto walls
  (T-junctions). Terrain must be a Line, Rectangle or Ellipse; a pen path is
  skipped with a warning because its bbox edge would read as plausible geometry.
- **The frame's size is the world.** `initLevel` UNIONS it into `bounds`, which is
  the camera and three of the four deaths. Resizing a frame is a design change:
  play it again.
- **Before debugging "the geometry looks off"**, read "Testing this bridge" in
  [`tools/goomba/figma/README.md`](./tools/goomba/figma/README.md). Ground truth
  is Figma's Design panel; A/B with encoded links, not re-pastes; `#hash` is read
  only at boot.
- **The codec (`goomba/codec.ts`) is shared by the browser and the node tools
  and is never forked.** A new field rides at the TAIL behind a flag bit.
  Anything that moves an existing byte costs a format version; there is no
  longer a Worker that has to ship first, so a bump is one deploy.
  `test-codec.mjs` holds a frozen link per version.
- **Four bands a level, no rule about whose.** `bands.mjs` tests that.
  `PARTY_COLORS` is confetti and bunting only; a band wears the one band colour
  (`bandInk`), which used to be the team's.
- **A level's number is its list index + 1**, computed at display (`levelLabel`).
  Don't type a number into a name.
- **The list can change under a live page** — the overlay is edited while you
  play. `reconcile` is still needed for exactly that.
- **A level whose numbers are still being swept lives in `tools/goomba/draft/`**
  (`P` + `buildLevel(P)`, driven by `draft.mjs run|from|sweep|audit|card|link`).
  `link` prints a `#hash` URL; that is the verdict. Nothing there grades. A
  `#hash` level is SCRATCH: appended to the list, no id, never saved.

### Goomba client invariants

- **Both top corners are one idiom**: a strip of state that wears a plate and a
  label when its control is live. `#lab` grows its plate ONCE (on the clear);
  the band plate's box is always reserved and only the ink changes, keyed on the
  EDIT PHASE, never on the band count. The bunting hangs off `#top`'s MEASURED
  bottom edge (`drawBackground` + ResizeObserver); the 24px under it is a
  corridor, not slack. Clear bands has no confirm; if strays turn up, add undo.
- **Never write `visibility: visible`** — hide with `hidden`, re-show with
  `inherit`, or a leaf re-opens itself under every hidden ancestor.
  `check-visibility.mjs` enforces it. Goomba only.
- **The how-to-play sheet is pictures** drawn by the renderer from level-shaped
  literals in `sheet.js`. It is NOT armed under anything that covers it — the
  grid (`#hud.lab > *`) or the finale (`#hud.splash > *`), both of which hide it
  wholesale: an armed invisible sheet swallows the next key and then reappears
  the moment its cover comes off (which is how it turned up over a post-credits
  level). Load-bearing: the band
  gap is at the END of the run; no X over a band being taken back; the plant's
  goal sits 3.6 above the floor; the fingertip is the one mark with no game
  counterpart; the title cat is sized by the GOAL picture. The sheet never
  dismisses itself, is opaque, dismisses on **pointerdown** (kiosk lockdown
  kills click) and on Space/Enter/Escape ONLY (a catch-all ate Cmd+R and
  Ctrl+V). `zoopMs` must stay unit-aware (the minifier writes `.46s`). Don't
  copy these instructions anywhere else.
- **The finale fires on the last MAIN level and it is a picture.** Clearing the
  last level NOT marked `bonus` lands the game on `splash` from `resolve`
  itself — no banner, no NEXT — and it fires ONCE (`finishedAt` is the latch),
  so no post-credits win re-runs it. It is TERMINAL only when there are no
  post-credits levels: with none, nothing takes it back (no tap, no `\`, no
  paste, no `goto` — the sim refuses it) except `reset` or a list edit that
  un-clears the game (`reconcile`). With a bonus section behind it, a tap and
  `\` open the levels grid, which is the door to them — `hasBonusLevels()` is
  the one question, asked in `sim.goto` (the authority) and `openSelector`
  (the UI declining to open a grid whose every tap the sim would refuse). A
  paste stays refused either way. A RESTORED game lands where it was saved —
  on the splash if the tab was closed there, else in `edit`: the ending plays
  on the win that earns it and is never re-run by a later load. "Not shipped
  is post-credits" (a local paste, a `#hash` link) is the sim's rule, `isMain`,
  asked of `source` — not a flag a layer has to remember to set. The
  screen is `public/art/goomba-splash.webp` drawn whole with its own edge rows
  as the wash (replace the file, the backdrop comes with it), then two plates in
  THIS ORDER: the cheer pops on top, and a beat later the CODE WORD rises at the
  bottom — hand the word over first and nobody looks at the rest. With
  POST-CREDITS levels there is a THIRD beat, later still ("tap for more
  levels"), and a tap then opens the grid; the tap is gated on that beat
  showing (`splashMoreReady`) so it cannot take the word away before it has been
  read. The cheer says "You beat the game!", not "All levels cleared!" — the
  bonus levels are all untouched when it pops on.
  That picture is this app's ONE image asset; every prop is still procedural.

## Repo invariants

- **TWO SITES, one per game, each rooted at `/`.** Two Vercel projects over one
  repo: `npm run build:hex` -> `dist/hex` -> hexxygon.com, `npm run
  build:goomba` -> `dist/goomba` -> g00.mba. Both read the one root
  `vercel.json` (headers + `trailingSlash`; no redirects, no rewrites). Vite
  `base` is `/` in both — the app IS the site. `hexxygon.com/reveal-lab` and
  `/qr-studio` ride along on the hex site. DNS is in Vercel.
- **A save is per-origin `localStorage` and there is nowhere else.** `hex-save`,
  `goomba-progress`, `goomba-overlay`, `goomba-state`. Changing a game's origin
  costs every player their save, with no migration path and no server copy —
  which is exactly why the origins were split before anyone had one.
- **Two cursors, ever**: `pointer` if a tap does something, `default` if not.
  `check-cursors.mjs` enforces it over the two player apps; `tools/` is exempt.
- **Each client's CSS is `src/styles.css`**, imported from `main`, never inline.
- **Hex's win is the wall going LEGIBLE** (`legibleAt`, asked through
  `hexWon`) — it used to be the proctor's press (`wonAt`, `setWon`, both
  deleted), because the code word left the game on a phone and came back as
  four humans reading it out. With one player there is nobody to read it to, so
  the wall being readable IS the win. The `wonFlip` edge raises the splash on
  the beat it happens; `#wonPill` flips between splash and game LOCALLY and is
  the way back. The splash picture is a drop-in file that brings its own sky;
  don't hardcode a sky or crop. Over it runs Goomba's finale beat — cheer
  first, CODE WORD a beat later — but with BOTH plates at the bottom (the cat
  owns the top edge on a laptop) and once per win, because unlike Goomba's
  finale this screen has a way back. The word is `HEX_CODEWORD` imported from
  shared and written into the plate ONCE, not synced: the screen only exists
  after the win, so it has nothing to gate on. Never TYPE the string into a
  client — import the constant.
- **Hex was balanced for FOUR players sharing one mouse pool, over ~10 minutes.**
  `data.ts` contemplates a solo run in places ("a slow solo run", the Cat Brush
  note) so it is not broken, but nobody has timed one and there is no longer a
  four-player mode to fall back on. If a run reads as a slog, `hex/data.ts` is
  the lever — and that is a balance change, made deliberately, not a bug.
