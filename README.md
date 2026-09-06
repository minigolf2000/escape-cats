# Escape Cats 🐾

Two cooperative 4-player mini games for a puzzle escape room, starring Hex and
Goomba. Players are sorted onto a team in the lobby and play together for ~10
minutes.

- **Hex Clicker** — a cooperative cookie-clicker. One shared mouse pool, shared
  buildings and upgrades. Petting Hex mints mice; buying the twist puts her to
  sleep, and the night wall's drifting dream-mice gradually ink the code word,
  identically on every phone.
- **Goomba Glider** — a line rider where the track is silly bandz. The room
  shares 4 elastic bands a level. Anyone hits PLAY and every phone watches the
  same deterministic ride: collect every watering can, then land on the plant.

## Layout

```
apps/hex-clicker/    Player client — see its src/README.md
apps/goomba-glider/  Player client — see its src/README.md
apps/lobby/          Landing page: name entry, then the room board (read-only)
apps/chat/           Per-team chat, roomed by team id
apps/proctor/        Hidden dashboard: five boxes (Unassigned + four teams), each a
                     drop target with its room's game readouts, resets and chat
packages/shared/     Wire protocol, seeded RNG, lobby rules, and BOTH whole games:
                     hex/{data,rules,sim}, goomba/{levels,physics,sim,codec,pack}
server/              Cloudflare Worker: four Durable Objects (hex, goomba, lobby,
                     chat) on partyserver — NOT the PartyKit platform
tools/goomba/        DESIGNING.md, the Figma bridge (figma/), seed/test/draft commands
tools/               qr-studio.html and reveal-lab.html, two standalone pages
scripts/             assemble.mjs + check-routing/cursors/visibility, run by build:vercel
```

## Where things live

- **Hex balance** — buildings, upgrades, costs, click math, wall ramp:
  `packages/shared/src/hex/data.ts` (+ `rules.ts` for derived rules). Server,
  phones and `?debug` all import it. Game logic: `hex/sim.ts`; the room server is
  a thin websocket wrapper around it.
- **Goomba physics and level types** — `goomba/physics.ts`, `goomba/levels.ts`
  (the type and `initLevel`); the room state machine is `goomba/sim.ts`; the
  save format is `goomba/codec.ts`. **There are no levels in this repo** — a
  level is a Figma frame and an event's levels are links in its lobby pack.
  Start at [`tools/goomba/DESIGNING.md`](./tools/goomba/DESIGNING.md).
- **Art & rendering** — client-only, one module per system. Hex:
  `src/{wall,cat,art,fx,shop,phase}.js`. Goomba: `src/{render,selector,sheet}.js`.
- **Each client's CSS is `src/styles.css`**, imported from its `main`.

## Development

```sh
npm install
npm run dev
```

| What          | URL                                        |
| ------------- | ------------------------------------------ |
| Room server   | 127.0.0.1:1999 (wrangler dev)              |
| Hex Clicker   | http://localhost:5173/hexxygon/            |
| Proctor       | http://localhost:5175                      |
| Team lobby    | http://localhost:5176                      |
| Team chat     | http://localhost:5177                      |
| Goomba Glider | http://localhost:5178/g00mBa/              |

The vite servers listen on the LAN; point `VITE_PARTYKIT_HOST` (the only client
env var, in `apps/*/.env.local`) at your machine's LAN IP for phones. The
player id is per browser profile, so fake players need separate profiles or
incognito windows.

**Locally, start each fake player at the GAME, not the lobby.** Dev serves each
surface on its own port, so each has its own `localStorage` and a game opened
directly is a fresh pid that lands in the testing room. A game page registers
itself in the lobby roster and reloads into its team when you drag it onto one.
Set `escape-cats-name` in that origin's `localStorage` for a name other than
"Cat".

**Modes are query params, never paths**, so they compose:

- `?debug` (hex) runs the shared sim in-page with no server; `?speed=N`
  fast-forwards it (`?debug&speed=20` walks a run in ~20 s). It also mounts the
  🛠 panel: grants, story-beat jumps (`hex/presets.ts`), a 🏆 win toggle, time
  scale, reset. It drives the shipped economy through the real `HexSim`.
- `?solo` (goomba) runs the level grid on the in-page sim; `?debug` on a real
  room unlocks the selector on one phone.
- `window.__hex` / `window.__goomba` expose each client's state mirror and a
  `send()`, always; `window.__hexSim` exposes the sim under `?debug`.
- To test a real room: `/proctor`, drag yourself onto a team, open with `?debug`.

```sh
npm run typecheck                          # all workspaces
npm run build:vercel                       # build + assemble + routing, cursor & visibility checks
cd tools/goomba && node test-codec.mjs     # the save format
cd tools/goomba && node bands.mjs          # the room's band rule
cd tools/goomba && node seed.mjs --pull    # what is this event running?
cd tools/goomba/figma && node test-*.mjs   # the Figma readers
```

The server takes no vars. The code word is a constant (`HEX_CODEWORD` in
`hex/data.ts`); the proctor identifies itself with `?role=proctor`, a claim
rather than a credential. Nothing here is a security boundary.

## Deploying

Two deploys: **one Cloudflare Worker** (the rooms) and **one Vercel project**
(every static surface).

### The Worker

CI deploys it (`.github/workflows/deploy-worker.yml`) on any push to `main`
touching `server/**`, `packages/shared/**` or the lock file, and on demand via
**Run workflow**. Secrets: `CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers
template), plus `CLOUDFLARE_ACCOUNT_ID` if the token can see more than one
account. By hand: `npm run cf:login` once, then `npm run deploy:server` (wrangler
belongs to the `server` workspace, so a bare `npx wrangler` at the root fails).

Live at **`escape-cats.escape-cats.workers.dev`**, which is what
`VITE_PARTYKIT_HOST` must point at. Rooms are `/parties/:party/:room`.

**Three one-way doors:**

- **Migrations are append-only.** A new DO class gets its own new migration tag
  in `wrangler.jsonc`; each tag runs once.
- **Renaming the Worker or a DO class orphans its storage.**
- **The Worker goes out BEFORE the Vercel build that depends on it.** A push to
  `main` starts both; the Worker job normally wins but it is a race. For a
  breaking protocol or DO change, run **Deploy Worker** manually on the PR
  branch, confirm it is live, then merge.

The free tier meters **duration** (GB-seconds resident), not requests, so rooms
stay evictable: every server hibernates, the tick loop runs only while a
**player** is connected (a proctor is a spectator), the proctor page drops its
sockets while its tab is hidden, and state lives in `ctx.storage`.

### Vercel

Import the repo with **Root Directory blank** — `vercel.json` sets everything
else but is read *from* the root, so a project pointed at a subfolder never sees
it. One env var: `VITE_PARTYKIT_HOST=escape-cats.escape-cats.workers.dev`.

`npm run build:vercel` builds every app and `scripts/assemble.mjs` collects them
into one `dist/`:

| Path | Source |
| --- | --- |
| `/` | `apps/lobby` |
| `/hexxygon/` | `apps/hex-clicker` |
| `/g00mBa/` | `apps/goomba-glider` |
| `/chat/` | `apps/chat` |
| `/proctor/` | `apps/proctor` |
| `/qr-studio/`, `/reveal-lab/` | `tools/*.html`, copied to `<name>/index.html` |

The game paths are obscure so a guessed URL cannot skip the lobby, and
**`/g00mBa` is case-sensitive**.

### Routing rules (each has shipped broken once)

- **Vanity domains `hexxygon.com` and `g00.mba` REDIRECT (307) into this origin.
  Never rewrite.** The pid in `localStorage` is per-origin, so a rewrite gives
  every phone on that domain a fresh pid that never inherits its team.
  `check:routing` cannot catch this: a rewrite lands on the same app.
- **Changing the origin costs every player their pid.** Do it between events.
  The old `cat-games-tau.vercel.app` is gone, not redirected: an unattached
  `.vercel.app` host 404s before `vercel.json` is consulted, so a rule for it
  passes `check:routing` and 404s in production.
- **Each vanity domain needs two rules, root first.** `/:path*` cannot serve the
  bare root (zero segments resolves to a directory after the filesystem check
  has already passed). A missing root rule does not 404: the root serves the
  lobby, whose `/assets/*` then redirect cross-origin and are blocked by CORS —
  a pure white page with only CORS errors in the console.
- **Use `:path*`, not `/(.*)` with `$1`** — Vercel only substitutes `$1` for an
  anchored regex source.
- **Each app's vite `base` is absolute** (`/hexxygon/`, `/g00mBa/`, `/proctor/`,
  `/`). Relative bases resolve `./assets/` against the lobby after Vercel strips
  the trailing slash.
- **`trailingSlash: true`**: extensionless pretty URLs would need a rule in both
  forms, which is why single-file tools land as `<name>/index.html`.
- **Do not test with `python -m http.server`** — its slash behaviour is the
  opposite of Vercel's. `npm run check:routing` resolves every surface through
  a router that implements `vercel.json` and follows each page's links and
  assets. `vercel.json` is strict JSON with no comments; explanations live here.

### What a phone downloads

Measured on an emulated 4G phone, the game booting for real (`?debug` / `?solo`),
median of three: hex first paint ~0.8 s, ~216 KB then 400 KB deferred; goomba
~0.4 s, 94 KB. The rules that keep it there:

- **Nothing invisible is on the critical path.** Hex's off-screen cat poses and
  the win splash park their URL in `data-href` and load one idle callback later
  (`warmPoseFrames` in `cat.js`); `check-routing.mjs` reads `data-href` like any
  other ref.
- **No binaries in a render-blocking stylesheet.** Baloo 2 is a real file in
  `public/fonts/` with a `preload` + `crossorigin` (required: a font preload
  without it is fetched twice).
- **Art ships as lossless WebP** in `public/art/`.
- **Laptop-only code loads on the laptop.** Goomba's Figma reader is a dynamic
  import behind the paste (`figma/paste.js`). Both clipboard reads happen before
  that `await` and must stay there — a `DataTransfer` is only readable during
  its own event.
- **The socket is named in the markup.** `scripts/vite-net-hints.mjs` adds a
  `preconnect` and a `modulepreload` for partysocket at build time. partysocket
  stays a *dynamic* import: `?debug` and `?solo` run with no socket.
- **Hashed `assets/` are cached `immutable`** in `vercel.json`; `art/` and
  `fonts/` are unhashed and get a day plus stale-while-revalidate.
- Preloading the day-pose images was measured and lost (bandwidth-bound, not
  discovery-bound). Don't re-add one without a measurement.

## Architecture

1. **Monorepo** — join/presence/reset plumbing is shared; the games sit on it.
2. **Mobile web, no install.** Both games are portrait.
3. **Server-authoritative rooms** (Durable Objects). Clients send intents.
4. **Deterministic synced animation** — toy positions are a pure function of
   (room seed, index, server-synced clock), so four phones agree with no
   position traffic.
5. **The code word is gated, not secret.** It ships in the client bundle.
6. **10 minutes is a completion target, not a timer** — reached through balance
   in `hex/data.ts`, never in game code.
7. **Seat reclaim** — a persistent player id in localStorage rejoins the same seat.
8. **Two cursors, ever** — `pointer` if a tap does something, `default` if not.
   `check:cursors` enforces it over the four player apps; `apps/proctor` and
   `tools/` are exempt (one operator, one laptop, `grab`/`crosshair` do work).

## Teams and the lobby

Four teams `t1`–`t4` of `TEAM_SIZE` (4). **A team id is also the room id the game
runs in.** A player opens `/`, types a name, and waits; the proctor drags them
onto a team. Sorting is manual on purpose (who sits with whom is a judgement
made in the room). The drag runs on **pointer events, not HTML5 drag-and-drop**,
which never fires under a finger.

**The game has no menu.** It asks the lobby for this pid's room and slots in;
opening a game page also registers the phone in the roster. The room is never
in the URL, so a refresh re-asks and a re-sort takes effect on reload.

### The room, on a player's phone

Every phone shows the four teams and who is on them, with your box lifted in
your colour and your name under a `you` pill. On a sorted phone that is the
whole screen; an unsorted phone gets one muted line saying what it is waiting
for, and "Connecting…" precedes the first snapshot. No card, no spinner, no
animation (hence no `prefers-reduced-motion` rule). Read-only: `assign` is
proctor-only on the wire, so nothing here declares a cursor.

- **A team's box is four seats whether or not they are filled** — the proctor is
  dragging while this is on a phone, and resizing boxes would twitch.
- **Rosters are NOT filtered by `connected`.** That flag means "holding a lobby
  socket", which a sorted phone drops when it moves to the game. It is only
  trustworthy for an unsorted phone, which is what the proctor's board uses it for.
- **Your name is a chip under the board.** Renaming happens in place over
  `rename`; the half-typed draft lives in module state, because a lobby
  broadcast rebuilds the page.
- If people stop reaching for the headbands, the line to put back is "Grab the
  pink ears 🐾", in the box that is already yours.

### The proctor's board

**A box is everything about one room**: roster, both game readouts, chat log,
stacked. Unassigned is a box like any other — its players are the phones in the
testing room, so it carries `t0`'s readouts and channel (`TestRoom.tsx`,
`TeamChat` in `Chats.tsx`). The five chat sockets live in a provider above the
board so a re-render cannot reconnect them.

- **A box is a fixed size.** Every seat is the same height filled or empty,
  every readout line renders in every state (placeholders, never fewer lines),
  long values clip. Adding a line to a game block is a layout decision. The chat
  log is a fixed 150px scrolling internally.
- **Destructive controls are per box**, always drawn, disabled at zero, and
  confirm.
- A full team refuses a fifth drop in the UI only; the lobby server accepts any
  assignment. One rule, one place.
- Goomba's block: phase icon (🛹 / 🎉 / 🏁 / ✏️, word on the tooltip), level,
  completed count or finish time, bands, reset. The finish line is what unlocks
  the team's level selector, so the reset also relocks it.
- Hex's block carries the one game action here: **🏆 Mark won**.

### The four bands

Goomba gives a room **`MAX_BANDS` (4) per level** and says nothing about whose.
The whole rule is `canPlaceBand(bands) ⟺ bands.length < MAX_BANDS` in
`goomba/sim.ts`, used by the client (greys the gesture and toasts why) and the
Durable Object (rejects anyway). **The per-player quota is reverted on
purpose** — presence became a game rule and a locked phone ate budget.
`tools/goomba/bands.mjs` tests the room half. There is also **no rule about
what a level must require**; a level is evaluated by people playing it.

- A band carries the `pid` of whoever laid it: a note, not a claim.
- **A band's colour is the TEAM's colour** (`earsFor(team).ink` in
  `shared/ears.ts`); `t0` and `?solo` fall back to pink. The party palette is
  decor only.
- A Durable Object handles one message at a time, so the last band needs no lock.
- **Both games draw the room's names, and nothing else does**: a column above
  PLAY in Goomba, a column on the shop tray's top edge in Hex (`#team` in each
  `styles.css`). Never a label on a teammate's anchor or band — nothing has an
  owner.

**Laying a band** takes tap-tap, drag, or a two-finger stretch, all funnelled into
one `place` intent. The edit camera is fixed at fit-the-level, so any point a
band can reach a finger can reach. A drag streams a ghost band; a tap-tap
waiting on its second tap streams a marker shorter than `BAND_MIN`.

### Goomba's level selector, and the editor inside it

A team that clears every level (`goombaCleared` in `goomba/sim.ts`, the same
`finishedAt` the proctor reads) unlocks the **levels** grid on all four phones;
a proctor reset takes it back. The level dots top-left ARE the button: once
unlocked the strip wears a plate and **select level** under the dots. Every
level is a card drawn from its own geometry under its name, with **no verdict**.
Tapping a card jumps the whole room there.

The band slots top-right are the same idiom: a plate and **clear bands** while
the edit phase is on. `#lab`'s plate arrives ONCE; the band plate's box is always
reserved and only the ink changes, chrome on `.laying`, the button `disabled`
at zero. Nothing in that row moves, which is what lets the bunting hang off
`#top`'s measured bottom edge.

**The selector IS the editor** (`apps/goomba-glider/src/figma/`) and `\` is only
the door: it opens the grid and closes it. Editing controls follow the surface
(`editorOn` in `state.js`, read live): a phone taps a card and that is all; a
laptop gets click-select, double-click-play, drag-reorder and ⌫. Closing with
`\` or Escape relocks a room that has not cleared the game; a cleared team's
plate is room state and stays.

**Ctrl+V lands wherever you were looking**: the selection on the grid (the
dashed trailing slot appends), or the level on screen while playing. Only an
empty pack opens the grid. Delete, and a paste whose NAME differs from what it
lands on, ask on the browser's `confirm()` (native, because a paste can land with
the grid shut); a matching name is a redraw and goes straight through.

`clipboard.js` decodes a plain Ctrl+C from Figma (`fig-kiwi`) and is the ONLY
reader; `stitch.js` chains the one-Line-per-segment terrain into polylines. The
kit and naming contract: [`tools/goomba/figma/README.md`](./tools/goomba/figma/README.md).

### A level is a link

`encodeLevel` (`packages/shared/src/goomba/codec.ts`) packs a level into 100–350
base64url characters that round-trip byte-identical (coordinates quantised to
tenths, then written as steps from the last point). The codec lives in shared
because browser, Worker and node tools must agree byte for byte — never fork it.
`tools/goomba/test-codec.mjs` holds a frozen real link per format version.

**Changing the format**: a new field rides at the TAIL behind a flag bit (free —
older readers stop early). Anything that moves an existing byte costs a version;
an older bundle then REFUSES the new link rather than misreading it, so the
Worker goes out first. Shorter links were measured against compression, a
wider alphabet and arc-fitting; the step encoding (fmt 3) won by 20–30% and the
rest lost. Read the codec header before trying again.

**Levels live in the lobby.** `GOOMBA_LEVELS` ships EMPTY and is filled by
`setGoombaLevels` from the wire; `goomba/pack.ts` is the shape (an ordered
`string[]` of links). The lobby DO owns it, the goomba room reads it
object-to-object and re-broadcasts it as a separate `pack` message (snapshots go
out at 10Hz during a drag). Edits ride the room socket and are forwarded to the
lobby, which validates by decoding and pokes all four team rooms. A new event
starts with no levels; `seed.mjs --pull` / `--push --file` moves a pack between
events. `GoombaSim.reconcile` applies a changed pack immediately and keeps
progress by index — deleting a level shifts every flag after it. A level's
display number is its index + 1 (`levelLabel`), stored nowhere; the LAST FLAG to
go up is the finale, whichever level it is (`GoombaSim.resolve`).

### Goomba's waiting screen is its how-to-play sheet

The join gate shows the title, two renderer-drawn scenes (`GOAL_SCENE` /
`GESTURE_SCENE` in `sheet.js`, level-shaped literals drawn via `drawScene`) and
two captions; `?` bottom-left reopens it mid-party. The first snapshot only
ARMS it; the player taps past on **pointerdown** (kiosk lockdown kills the
synthesised click). The load-bearing details are in CLAUDE.md; don't copy the
instructions anywhere else.

### The win splash

**Goomba scores its own.** The win that clears the last level sets `finishedAt`
and lands the room on `splash` in `GoombaSim.resolve` itself — the finale never
passes through `win`, so there is no banner and no NEXT to press: the ride ends
on the picture, on the frame Goomba reaches the plant. That screen is TERMINAL
and has no controls at all. It plays in two beats — "All levels cleared!" first,
then the party's CODE WORD a beat later, which they read out to the proctor —
and the phone cannot be talked out of showing it: a tap does
nothing, `\` and a paste are refused, and `goto` — the intent that used to leave
it — is refused by the sim. The ways off are a proctor reset and a pack edit
that un-clears the room (`reconcile`). The picture is
`apps/goomba-glider/public/art/goomba-splash.webp`, drawn whole and centred with
the slack filled by its own top and bottom rows; like hex's, replace the file
and the backdrop comes with it. It is preloaded at an idle moment because it
arrives with no warning.

**Hex cannot.** Its ending is a code word read out to the proctor, so the
proctor presses **🏆 Mark won** (`wonAt`, a proctor-only `won` intent). That
unlocks a gold pill top-left that flips between `🏆 win screen` and `← back to
game`; the wall stays live behind the picture. Taking a win BACK confirms;
granting does not. Which view a phone shows is LOCAL. The splash raises itself
once, on the live edge, so a rejoin gets the pill and not a replayed celebration.
The picture is `apps/hex-clicker/public/art/hex-splash.webp`, drawn whole and
fitted on whichever axis binds, with slack filled by sky sampled from its own
edges — replace the file and it brings its own sky. Either win is taken back by
that game's reset.

### The testing room

`roomFor(team)` in `packages/shared/src/lobby.ts` is the whole rule: a sorted
phone gets its team, an unsorted one gets `OPEN_TEAM` — room `t0`, "Testing
Room". `OPEN_ROOM_OPEN = false` restores the waiting screen everywhere, which is
what an event night wants.

- `t0` is not in `TEAMS`, so it can never be dragged into.
- A sorted phone closes its lobby socket; a phone in `t0` keeps it open, because
  its answer can change.
- The proctor watches it inside the Unassigned box (`TestRoom.tsx`), which is the
  only way to reset a room nobody is sorted into.
- Both games are built for four; a crowd degrades gracefully but is a reason not
  to leave `OPEN_ROOM_OPEN` on for a real group.

### `?r=` is the one room a URL may name, and it is never a team

`?room=` is gone (it let anyone pick a team's room and upper-cased its value into
a second room). `?r=<slug>` plays in room `r-<slug>` (`ADHOC_PREFIX`): a link
for friends, with a team room's durable progress. Three load-bearing properties:
the `r-` prefix is a namespace no team id can enter and `roomFor` answers the
team first; `adhocRoomId` lowercases and strips the slug in shared; it stays on
one origin. Both games take the same slug, because it names a room.

Hex's ad-hoc room announces itself to the lobby registry on connect, because its
win is a proctor's press and must reach the board. An ad-hoc room **plays** the
pack and cannot edit it (`isAdhocRoom` in `server/src/goomba.ts`). The proctor
sees them in `AdhocRooms.tsx`, where the links are minted; a room appears when
somebody first JOINS it, and the list goes to proctor connections only.

### Persistence

- **The lobby writes through on every change.**
- **The game rooms write behind every 5s** (`HexPersistedV1` in `hex/sim.ts`; the
  sim serialises itself, storage I/O stays in the server). On rehydrate the gap
  is credited at the restored rate, **capped at 30s**. `speed` is never
  persisted. Proctor **reset** writes through. The loops stop with a final save
  when the last socket closes, so an empty room is evictable.

## Team chat

`/chat/` is one channel per team; the room id is the team id. No picker; it
asks the lobby for this pid's room. The lobby has no link to it — it is reached
by typing the path or off a QR.

Server (`server/src/chat.ts`, tunables in `packages/shared/src/chat.ts`):

- **Bounded history** — `CHAT_HISTORY` messages, one storage key per message
  (`m:` + zero-padded id, so a prefix list is chronological).
- **Clamped text** — whitespace collapsed, then truncated to `CHAT_MAX_TEXT`
  (truncated, not rejected).
- **Token bucket** — `CHAT_BURST`, then one per `CHAT_REFILL_MS`; over the
  limit is dropped silently.
- **No ticker.** Event-driven only.
- The proctor connects with `?role=proctor` as a spectator: `say` refused, not
  counted in "n here". **Clear chat** deletes `m:` keys in chunks of 128 and
  broadcasts an ordinary empty snapshot.

Client: message bodies are set with `textContent`, never `innerHTML` (the one
arbitrary player-authored string in the repo). A line typed before the socket
opens is queued, not dropped; the hex client queues taps the same way.

## Not built yet

- Per-session code words from the proctor dashboard.
- A PR check: nothing runs the root `typecheck` or the node tests on a pull
  request. The Worker deploy typechecks only its own workspace on purpose.
