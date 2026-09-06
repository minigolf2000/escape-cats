# Escape Cats — notes for Claude threads

Two coop 4-player party games (Hex Clicker, Goomba Glider) on one Cloudflare
Worker + one Vercel deploy. [README.md](./README.md) is the map and the rulebook;
each app's `src/README.md` is its module map. This file is the short list of
things that bite.

## Map

```
apps/hex-clicker/      player client (/hexxygon/)   src/README.md
apps/goomba-glider/    player client (/g00mBa/)     src/README.md
apps/lobby/ chat/ proctor/                          landing page, team chat, dashboard
packages/shared/src/   protocol, lobby rules, hex/{data,rules,sim}, goomba/{levels,physics,sim,codec}
server/src/            one Worker, four Durable Objects (hex, goomba, lobby, chat)
tools/goomba/          DESIGNING.md, the Figma bridge (figma/), seed/test/draft commands
scripts/               assemble + the three build checks (routing, cursors, visibility)
```

Most edits are: CSS/UI in a game client's `styles.css`/`main.js`, lobby or
proctor UI, a shared rule in `packages/shared`, or a Goomba level (which is a
Figma frame, not code — see below).

## Commands

```sh
npm run dev            # server :1999, hex :5173, proctor :5175, lobby :5176, chat :5177, goomba :5178
npm run typecheck      # all workspaces
npm run build:vercel   # build + assemble + check:routing + check:cursors + check:visibility
cd tools/goomba && node test-codec.mjs        # save format
cd tools/goomba && node bands.mjs             # room band rule
cd tools/goomba && node seed.mjs --pull       # what an event is running
cd tools/goomba/figma && node test-*.mjs      # the Figma readers
```

Testing a real room: `/proctor`, drag yourself onto a team, open the game with
`?debug`. No server: hex `?debug&speed=N`, goomba `?solo`.

## Goomba levels (the most common task)

Start at [`tools/goomba/DESIGNING.md`](./tools/goomba/DESIGNING.md). Draw in
Figma, Ctrl+V into the game, play it with `?solo` and then with four people.

- **No level lives in this repo and nothing grades one.** A level is a Figma
  frame; an event's levels are links in its lobby pack. The simulation bench and
  its 4-band gate are deleted on purpose — don't rebuild them, don't put a
  verdict on a level card, don't write "must pass" into a doc.
- **A paste is live on every phone a second later.** Point a second thread at its
  own event rather than editing over a party in progress.
- **Figma file `vRN6Q44ReIaESP5wv8M2dI`: Levels page `47:2`, Components `45:55`,
  Scratchpad `0:1`.** `get_metadata` with no nodeId lists only `Components` —
  go straight to `47:2`. **Never take a position from `get_metadata`**: it gives
  a node's ORIGIN and its BOUNDING BOX with no rotation, so `x + w/2` is wrong
  for anything rotated. Use `figma/read-frame.mjs --nodes` (a read-only
  `use_figma` dump) or `--clipboard` (a saved Ctrl+C).
- **The selector is the editor; `\` is only the door.** Editing controls depend
  on the SURFACE (`editorOn` in `state.js`, read live): a laptop always has ⌫ and
  drag, a phone never does. Ctrl+V lands on what you were looking at; only an
  empty pack opens the grid. Delete, and a paste whose name differs, confirm on
  the browser's own `confirm()`; a matching name goes straight through.
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
- **The codec (`goomba/codec.ts`) is shared by browser, Worker and tools and is
  never forked.** A new field rides at the TAIL behind a flag bit. Anything that
  moves an existing byte costs a format version, and the Worker ships first.
  `test-codec.mjs` holds a frozen link per version.
- **Four bands for the ROOM, no rule about whose.** `bands.mjs` tests that. A band
  wears the TEAM colour; `PARTY_COLORS` is confetti and bunting only.
- **A level's number is its pack index + 1**, computed at display (`levelLabel`).
  Don't type a number into a name.
- **The pack can change under a live room.** `GoombaSim.reconcile` keeps progress
  by index, not identity: deleting a level shifts every flag after it.
- **A level whose numbers are still being swept lives in `tools/goomba/draft/`**
  (`P` + `buildLevel(P)`, driven by `draft.mjs run|from|sweep|audit|card|link`).
  `link` prints a `?solo#hash` URL; that is the verdict. Nothing there grades.

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
- **The waiting screen IS the how-to-play sheet, and it is pictures** drawn by
  the renderer from level-shaped literals in `sheet.js`. Load-bearing: the band
  gap is at the END of the run; no X over a band being taken back; the plant's
  goal sits 3.6 above the floor; the fingertip is the one mark with no game
  counterpart; the title cat is sized by the GOAL picture. The sheet never
  dismisses itself, is opaque, dismisses on **pointerdown** (kiosk lockdown
  kills click) and on Space/Enter/Escape ONLY (a catch-all ate Cmd+R and
  Ctrl+V). `zoopMs` must stay unit-aware (the minifier writes `.46s`). Don't
  copy these instructions anywhere else.
- **The finale is TERMINAL and it is a picture.** Clearing the last level lands
  the room on `splash` from `resolve` itself — no banner, no NEXT — and nothing
  takes it back: no tap, no `\`, no paste, no `goto` (the sim refuses it). Only
  a proctor reset, or a pack edit that un-clears the room (`reconcile`). The
  screen is `public/art/goomba-splash.webp` drawn whole with its own edge rows
  as the wash (replace the file, the backdrop comes with it), then two plates in
  THIS ORDER: "All levels cleared!" pops on top, and a beat later the CODE WORD
  rises at the bottom — hand the word over first and nobody looks at the rest.
  That picture is this app's ONE image asset; every prop is still procedural.

## Repo invariants

- **Deploy order: Worker BEFORE the Vercel build that needs it.** CI deploys the
  Worker on push to main but races Vercel; for a breaking protocol/DO change run
  the workflow on the branch first, confirm, then merge. `wrangler.jsonc`
  migrations are append-only; renaming a Worker or DO class orphans storage.
- **One origin, `escape-cats.vercel.app`.** Vanity domains REDIRECT (307), never
  rewrite: the pid in localStorage is per-origin and `check:routing` would not
  catch a rewrite. No `?room=`, ever. Changing the origin costs every player
  their pid — do it between events. The old `cat-games-tau.vercel.app` is gone,
  not redirected.
- **`?r=<slug>` is the one room a URL may name, and never a team**: the `r-`
  prefix, `roomFor` answering the team first, and `adhocRoomId` normalising in
  shared are all load-bearing. An ad-hoc room plays the pack and cannot edit it
  (`isAdhocRoom`).
- **Vite `base` is absolute and matches the `dist/` subdirectory** (`/hexxygon/`,
  `/g00mBa/` — casing is load-bearing). `check-routing.mjs` models `vercel.json`
  against `dist/`; keep its expectations current.
- **Two cursors, ever**: `pointer` if a tap does something, `default` if not.
  `check-cursors.mjs` enforces it over the four player apps; proctor and tools
  are exempt.
- **Proctor box heights are fixed**: every stat line renders in every state so a
  box never shifts under a drag.
- **Each client's CSS is `src/styles.css`**, imported from `main`, never inline.
- **Hex's win is the proctor's press** (`wonAt`, proctor-only intent) — hex
  cannot score itself. It is a toggle; taking a win back confirms, granting
  does not. `#wonPill` flips between splash and game LOCALLY (Goomba's card taps
  are wire intents because they move what the room plays). The splash picture
  is a drop-in file that brings its own sky; don't hardcode a sky or crop.
