# Escape Cats 🐾

Two cooperative 4-player mini games for a puzzle escape room, starring Hex and
Goomba. Players are sorted onto a team in the lobby and play together for ~10
minutes.

- **Hex Clicker** — a cooperative cookie-clicker. One shared mouse pool, shared
  buildings and upgrades. Petting Hex mints mice; buying the twist puts her to
  sleep, and the night wall's drifting dream-mice gradually ink the code word —
  identically on every phone.
- **Goomba Glider** — a line rider where the track is silly bandz. The room
  shares 4 elastic bands a level and there is no rule about whose they are.
  Anyone hits PLAY and every phone watches the same deterministic ride: collect
  every watering can, then land on the thirsty spider plant.

## Layout

```
apps/hex-clicker/    Player client, 16 modules — see its src/README.md
apps/goomba-glider/  Player client, 11 modules — see its src/README.md
apps/lobby/          Landing page: name entry, then THE ROOM — all four teams
                     and who is on them, the proctor's board read-only, and on
                     a sorted phone the whole screen. No links out: not to the
                     games, and not to chat. Your name is a chip you can edit
                     from any screen
apps/chat/           Per-team chat: one channel per team, roomed by team id
apps/proctor/        Hidden dashboard, one flat page: five boxes, where a box is
                     a drop target, its room's live game status (+ reset) and
                     its room's chat — plus one QR into the lobby
packages/shared/     Wire protocol, seeded RNG, and BOTH whole games: hex
                     balance/rules/sim (hex/), and goomba level types + physics
                     + room sim (goomba/)
server/              Cloudflare Worker: two game rooms, team lobby and team
                     chat, as four Durable Objects (partyserver, NOT the
                     PartyKit platform)
tools/goomba/        The design guide (DESIGNING.md), the Figma bridge, and
                     three commands: move a pack between events, test the save
                     format, test the room's band rule. Nothing grades a level
tools/               Two self-contained browser tools: QR Art Studio and the
                     night-reveal lab
```

## Where things live (so a retune touches one file)

- **Hex balance** — buildings, upgrades, costs, click math, wall ramp:
  `packages/shared/src/hex/data.ts` (+ `rules.ts` for derived rules). The
  server, the phones and `?debug` all import it, so there is one copy to edit.
- **Hex game logic** — what a pet/purchase/golden-catch does:
  `packages/shared/src/hex/sim.ts`. The room server is a thin websocket wrapper
  around it.
- **Goomba physics and level types** — `goomba/physics.ts` and `goomba/levels.ts`
  (the level TYPE and `initLevel`). The room state machine is `goomba/sim.ts`.
  **There are no levels in this repo**: a level is a Figma frame, and an event's
  levels are links in its lobby pack. Start at
  [`tools/goomba/DESIGNING.md`](./tools/goomba/DESIGNING.md).
- **Art & rendering** — client-only, one module per system. Hex:
  `src/{wall,cat,art,fx,shop,phase}.js`. Goomba: `src/{render,selector,sheet}.js`.
  Each app's `src/README.md` is the map.

### Goomba's level selector, and the editor inside it

A team that has cleared every level (`goombaCleared` in `goomba/sim.ts` — the
same `finishedAt` the proctor's finish line reads) unlocks the **levels** grid
on all four phones at once, and a proctor reset takes it back. The level dots
top-left ARE the button: once unlocked the strip wears a plate and the words
**select level** on a line under the dots — a glyph said nothing a player could
learn from, and this is the only control the clear unlocks, so it names itself.
Tapping anywhere on that plate, dots included, opens the grid. Every level is a
card drawn from its own geometry, under its name and **no verdict** — nothing
grades a level. Tapping a card jumps the whole room there.

**The other corner is the same object.** The band slots top-right ARE the button
that empties them, wearing the same plate with **clear bands** on a line
underneath — one idiom, twice: a strip of state that, when its control is live,
puts on a plate and says what it does. The two differ in one way, and it is the
interesting one. `#lab` grows its plate exactly ONCE, when the team clears the
game; the band plate's condition is the edit phase, which comes and goes every
time somebody hits PLAY, so its box is always reserved and only the INK changes
— chrome on the phase, words dimmed and the button `disabled` at zero bands.
Nothing in that row ever moves, which is also what lets the **bunting hang off
`#top`'s measured bottom edge** (`drawBackground`) instead of off a constant
copied out of the stylesheet.

**The selector IS the editor** (`apps/goomba-glider/src/figma/`), and `\` is the
door — it opens the grid, and `\` again goes back to playing. That is ALL the
key does. There is no editing mode to be in or out of: **the surface decides,
every time** (`editorOn` in `state.js`, read live rather than latched at boot),
so a laptop's grid always has the controls on it and a phone's never does. The
key used to carry the mode as well, which made two laptop grids — the one `\`
opened and the lesser one the clear unlocked — and the lesser one looked exactly
like the ⌫ and the drag having been deleted.

- **A phone** taps a card and the room jumps there. That is the whole screen: no
  editing controls at all, since a phone has no Ctrl+V to follow them up with.
- **A laptop** gets a file browser — click selects, double-click plays, drag
  reorders with a bar in the gap the drop lands in, and `⌫` deletes.

Closing with `\` (or Escape) locks the door behind you, so a room that has not
cleared the game goes back to not having the selector. A team that HAS cleared it
owns it: their plate is room state off the snapshot, and neither key takes it
away.

**Ctrl+V lands wherever you were looking.** On the grid that is the selection: a
card replaces that level, the trailing dashed slot appends. Playing, it is the
level on the screen, so the Figma loop (tweak the frame, Ctrl+C, Ctrl+V, watch it
redraw under you) costs no trip out to the grid. The only paste that still opens
the grid is one with nowhere else to land: an empty pack. Deleting, and pasting
over a level whose NAME differs from what is coming in, both ask first on the
browser's own `confirm()` — native rather than canvas-drawn precisely because a
paste can now land with the grid shut.

`clipboard.js` decodes a plain Ctrl+C from Figma (a `fig-kiwi` payload, real
layer names and stored geometry) and is the ONLY reader — an SVG-export path sat
beside it and is gone, because Figma writes layer names into SVG only when the
`id` attribute is on, and names are the whole contract. `stitch.js` chains the
one-Line-per-segment terrain back into polylines so it draws like a hand-authored
level. The kit and the naming contract are in
[`tools/goomba/figma/README.md`](./tools/goomba/figma/README.md).

`?debug` is nothing but a local override of the unlock — one phone in the state a
cleared room is already in. `?solo` runs the same grid on the in-page sim with no
server. To test on prod: `/proctor`, assign yourself a team, open with `?debug`.

**Laying a band** takes whichever gesture a player reaches for — tap both ends,
drag one end to the other, or stretch between two fingers — all three funnel into
one `place` intent. The edit camera is fixed at fit-the-whole-level and nothing
pans, so any point a band can reach is a point a finger can reach. Teammates
watch it happen: a drag streams as a ghost band, and a tap-tap waiting on its
second tap streams as a marker (a preview shorter than `BAND_MIN`, so it reads as
"choosing here").

## Architecture decisions (agreed up front)

1. **Monorepo** — the hard part (join/presence/reset/reveal plumbing) is shared;
   the games are apps on top of it.
2. **Mobile web, no install** — QR scan → URL → playing in seconds. Both games
   are portrait.
3. **Server-authoritative rooms** (Cloudflare Durable Objects). Clients send
   intents; the server owns all game state.
4. **Shared cooperative state** — one point pool in Hex Clicker.
5. **Deterministic synced toy animation** — toy positions are a pure function of
   (room seed, toy index, server-synced clock), so all four phones show the
   identical reveal pattern with zero position traffic.
6. **The code word is gated, not secret.** The server withholds it until the wall
   is legible, but the word is a plain constant in `hex/data.ts` and ships in the
   client bundle regardless (`?debug` runs the sim in-page). Nothing here is a
   security boundary.
7. **10 minutes is a completion target, not a timer** — achieved through balance,
   which lives in `hex/data.ts` and `goomba/levels.ts`, never in game code.
8. **Seat reclaim** — each phone has a persistent player id in localStorage, so a
   locked phone or dropped wifi rejoins the same seat.
9. **Two cursors, ever** — `pointer` if a tap does something, `default` if it does
   not. These are phone games; a third value cannot be telling players anything.
   `npm run check:cursors` enforces it over the four player-facing apps.
   `apps/proctor` and `tools/` are exempt: one operator, one laptop, and
   `grab`/`crosshair` do real work there.

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

Open the lobby on phones on the same wifi, then drag each phone onto a team from
the proctor page. The vite servers listen on the LAN; point `VITE_PARTYKIT_HOST`
at your machine's LAN IP for phone testing.

Simulate 4 players with 4 browser tabs — but the persistent player id is per
browser profile, so use different profiles or incognito windows.

**Locally, start each fake player at the GAME, not at the lobby.** Production
serves every surface from one origin; dev serves them on separate vite ports,
which means separate `localStorage`, so a game opened on its own port is a
brand-new pid and lands in the testing room as an unsorted "Cat". Open
`localhost:5173/hexxygon/` directly instead — a game page registers itself in the
lobby roster and reloads into its team the moment you drag it onto one. Set
`escape-cats-name` in that origin's `localStorage` for a name other than "Cat".

For balance work on Hex, **`?debug`** runs the shared sim in the page with no
server, and `?speed=N` fast-forwards it — `localhost:5173/?debug&speed=20` walks
a whole run in about 20 seconds. A real room always runs at ×1.

`?debug` also mounts a floating **🛠 panel**: grants, story-beat jumps (`day` →
`legible`, see `hex/presets.ts`), a 🏆 win toggle, time scale and reset. It drives
the SHIPPED economy through the real `HexSim`, so what you tune is what players
get, and nothing debug-related is in the wire protocol. `window.__hexSim` exposes
the sim; `window.__hex` and `window.__goomba` expose each client's state mirror
and a `send()`, always on, in any mode.

Modes are **query params, never paths** — they compose (`?debug&speed=20`) where
path segments don't, and a path would need a rewrite per mode on a static host.

```sh
npm run typecheck                          # all workspaces
npm run build:vercel                       # full build + assemble + routing & cursor checks
cd tools/goomba && node test-codec.mjs     # the save format
cd tools/goomba && node bands.mjs          # the room's band budget
cd tools/goomba && node seed.mjs --pull    # what is this event running?
cd tools/goomba/figma && node read-frame.mjs --nodes f.json  # a Figma frame, in world units
```

## Configuration

Client env vars (Vite, set in `apps/*/.env.local`):

- `VITE_PARTYKIT_HOST` — host:port of the room server (default
  `127.0.0.1:1999`). Kept under its old name: it is what `partysocket` reads.

The server takes no vars. The code word is a constant (`HEX_CODEWORD` in
`hex/data.ts`, paired with the wall art), and the proctor identifies itself with
`?role=proctor` — a claim, not a credential. Anyone who opens `/proctor` can
watch and reset the rooms; that is accepted, not overlooked.

## Deploying

Two deploys total: **one Cloudflare Worker** (the rooms) and **one Vercel
project** (every static surface). Vanity domains are routed inside `vercel.json`,
so repointing one is a repo change, not dashboard clicking.

### 1. The room server — Cloudflare Workers

**CI deploys it** — `.github/workflows/deploy-worker.yml`, on any push to `main`
touching `server/**`, `packages/shared/**` or the lock file, and on demand via
**Run workflow**. It runs `npm run typecheck -w server` as a guard first.

It authenticates with **`CLOUDFLARE_API_TOKEN`** in the repo's Actions secrets,
minted from the **Edit Cloudflare Workers** template. If the token can see more
than one account, wrangler refuses to guess — add **`CLOUDFLARE_ACCOUNT_ID`** too;
it is ignored when unset.

By hand, from the repo root:

```sh
npm run cf:login        # once per machine — opens a browser, laptops only
npm run deploy:server   # wrangler deploy
```

Wrangler belongs to the `server` workspace, not the root, so a bare
`npx wrangler login` at the top level fails — these scripts route it through the
workspace.

Four Durable Objects behind one Worker — game room, lobby, chat, goomba — mapped
by `routePartykitRequest` onto the `/parties/:party/:room` URLs clients speak.

**Three things here are one-way doors:**

- **Migrations are append-only.** A new DO class needs its own **new** migration
  tag in `wrangler.jsonc`; each tag runs once, so a new class is never an edit to
  an existing tag.
- **Renaming the Worker or a DO class orphans its storage.** A rename creates a
  new Worker with empty storage and strands every room in the old one.
- **Deploy order: the Worker goes out BEFORE the Vercel build that depends on
  it**, or a client speaks a protocol the live Worker doesn't know and is
  ignored. CI has narrowed this but not closed it — a push to `main` starts both
  at once, and the Worker job normally wins (no Vite builds, no assemble step),
  but "normally" is not a guarantee. For a **breaking** protocol or DO change,
  run **Deploy Worker** manually against the PR branch first, confirm it is live,
  then merge. Additive changes can race harmlessly.

The Worker is live at **`escape-cats.escape-cats.workers.dev`** — Worker name,
then the account-wide workers.dev subdomain. That is what `VITE_PARTYKIT_HOST`
must point at.

**This does NOT run on the PartyKit platform**, despite the `partysocket` and
`partyserver` packages: PartyKit's hosted tier stopped accepting new projects in
June 2026 ([partykit#985](https://github.com/partykit/partykit/issues/985)).
`partyserver` is the same programming model on plain Workers + Durable Objects,
so only the host changed.

Room state lives in `ctx.storage`, so a redeploy or eviction does not lose a
team's progress. The free tier meters **duration** — GB-seconds of objects held
resident — not requests, so the design keeps rooms evictable: every server
hibernates (`static options = { hibernate: true }`), the tick loop runs only
while a **player** is connected (a proctor is a spectator and gets a snapshot on
connect), and the proctor page drops its sockets while its tab is hidden. One
forgotten proctor tab used to keep five objects awake around the clock — at
128 MB each, ~11,000 GB-s/day against a 13,000 GB-s/day allowance.

### 2. Vercel — one project

Import the repo; leave **Root Directory** at the repo root. Build settings come
from `vercel.json`.

`npm run build:vercel` builds the Vite apps and then `scripts/assemble.mjs`
collects every surface into one `dist/`:

| Path in `dist/` | Source | What |
| --- | --- | --- |
| `/` | `apps/lobby` | Team lobby (landing page) |
| `/hexxygon/` | `apps/hex-clicker` | Hex Clicker (coop) |
| `/g00mBa/` | `apps/goomba-glider` | Goomba Glider (coop) |
| `/chat/` | `apps/chat` | Per-team chat |
| `/proctor/` | `apps/proctor` | Proctor dashboard |
| `/qr-studio/` | `tools/qr-studio.html` | QR Art Studio |
| `/reveal-lab/` | `tools/reveal-lab.html` | Night reveal wall lab |

A single-file surface is copied to `<name>/index.html`, so it gets a pretty URL
with no rewrite — the path is a real directory on disk.

Env vars (all in this one project, so every surface points at one server):

```
VITE_PARTYKIT_HOST=escape-cats.escape-cats.workers.dev
```

**Root Directory must be blank.** `vercel.json` overrides the dashboard's
framework, build command and output directory, but it cannot set the root
directory — it is read *from* it. A project pointed at a subfolder never sees
this file, so `build:vercel` never runs and the hostname rules never apply.

### 3. Vanity domains

The two vanity domains **redirect** (307) into this origin rather than rewriting
to it:

| Domain | Redirects to | Serves |
| --- | --- | --- |
| `hexxygon.com` | `/hexxygon/` | Hex Clicker coop |
| `g00.mba` | `/g00mBa/` | Goomba Glider coop |

**Redirect, not rewrite, is the whole point, and it is load-bearing for
identity.** Player identity is a `pid` in `localStorage`, which is per-origin, so
the lobby's assignment only follows a player into a game served from the lobby's
own origin. Nothing server-side can bridge that: cookies are domain-scoped, every
phone on venue wifi shares one NAT address, and fingerprinting is neither
reliable nor welcome. The one fallback — carrying the team in the link
(`?room=t2`) — is gone (see `?r=` below), so **turning a vanity domain back into
a rewrite would break joining outright**: that origin would have its own empty
store, so every phone on it would mint a fresh pid, appear on the proctor's board
as a stranger, and never inherit its team. `check:routing` would NOT catch it —
it asserts which app each vanity root lands on, and a rewrite lands on the same
app as a redirect.

They are 307s, not 308s — a permanent redirect is cached indefinitely and would
be painful to walk back.

Each domain needs **two** rules, one for the bare root and one for everything
below it, root first (Vercel takes the first match). Both are load-bearing:

- **The `/:path*` rule cannot serve the bare root.** With zero path segments the
  destination resolves to a directory rather than a file, and rewrites run
  *after* the filesystem check — so the directory-index lookup has already been
  passed and it 404s. Symptom: every deep link works, the domain root alone
  fails.
- **Use `:path*`, not `/(.*)` with `$1`.** Vercel only substitutes `$1` when the
  source is an explicitly anchored regex; an unanchored source is parsed as
  path-to-regexp, where `$1` is not a substitution token, so everything rewrites
  to a literal `/hex/$1`.

**The missing-root case in the redirect form fails silently and much worse.**
There IS a `dist/index.html` (the lobby), so a missing `"source": "/"` rule does
not 404 — the root quietly serves the lobby, while that page's own `/assets/*`
requests still match `/:path*` and get redirected cross-origin. Vite marks those
tags `crossorigin`, the redirected origin sends no `Access-Control-Allow-Origin`,
and the browser blocks the script and the stylesheet. The symptom is a **pure
white page with nothing in the console but CORS errors** — which reads like a
broken build, not a routing bug. `check-routing.mjs` asserts the expected landing
path for every vanity root specifically to catch this; keep it current.

`vercel.json` cannot carry comments — it is strict JSON and the schema rejects
unknown keys. Explanations go here.

The paths are `/hexxygon` and `/g00mBa` rather than `/hex` and `/goomba` so that
a player who guesses a path cannot walk into a game without being sorted onto a
team first. **`/g00mBa` is case-sensitive** — URL paths are, per RFC 3986 — so
`/g00mba` is a 404. The QR code carries the exact casing.

**Each app's vite `base` must be absolute and match its `dist/` subdirectory** —
`/hexxygon/`, `/g00mBa/`, `/proctor/`, `/` for the lobby. Do not make them
relative: Vercel normalises `/hexxygon/` to `/hexxygon`, and against that URL the
browser resolves a `./assets/` reference to the **lobby's** asset directory. The
HTML loads, its script 404s, white screen.

`vercel.json` sets **`trailingSlash: true`**, so directory URLs keep their slash.
Paths carrying a file extension are excluded from that 308, so a rewrite whose
source is an extensionless pretty URL has to be registered in both slashed and
unslashed forms. Landing a single file as `<name>/index.html` in `assemble.mjs`
avoids the problem entirely, which is how `/qr-studio/` and `/reveal-lab/` are
served.

Do not test this with `python -m http.server`. It redirects `/hexxygon` to
`/hexxygon/`, the opposite of Vercel's default, so it will happily serve a build
that is broken in production — which is exactly how two of these shipped. Run
**`npm run check:routing`** instead: it resolves every surface through a router
implementing `vercel.json` (trailing slash, then redirects, then rewrites, then
the filesystem) and follows each page's own links and assets. It runs as part of
`build:vercel`.

## What a phone downloads

Both clients are measured the same way: the assembled `dist/` served locally to
a headless Chromium on an emulated 4G phone — 1.6 Mbps, 70 ms RTT, 4x CPU
throttle — with the game booting for real (`?debug` for hex, `?solo` for
goomba) rather than sitting at the join gate. Median of three runs.

| | first paint | largest paint | `load` | bytes |
| --- | --- | --- | --- | --- |
| Hex Clicker | 810 ms | 1.39 s | 1.34 s | 216 KB, then 400 KB after |
| Goomba Glider | 370 ms | 370 ms | 0.72 s | 94 KB |

The rules that keep those numbers, in the order they were worth:

- **Nothing invisible is on the critical path.** Hex's five cat poses are all
  in the served markup so a pose swap has nothing to wait for, but seven of the
  eleven files cannot be on screen in the day phase — and an SVG `<image>` has
  no `loading="lazy"` to say so. They park their URL in `data-href` and land one
  idle callback after the page is up (`warmPoseFrames` in
  `hex-clicker/src/cat.js`); the win splash, which needs a proctor's press to
  appear at all, waits the same way. Before that, the LARGEST paint on the page
  was the SLEEPING cat, on a screen with no night phase yet.
  `check-routing.mjs` reads `data-href` like any other ref, so a deferred file
  cannot be renamed out from under the page.
- **A render-blocking stylesheet carries no binaries.** Baloo 2 was a base64
  data URI inside `styles.css` — 26 KB that gzip cannot touch, sitting between
  the browser and the first pixel. It is a real file in `public/fonts/` now,
  with a `preload` (and `crossorigin`, which is required rather than decorative:
  a font is always fetched in anonymous CORS mode, and a preload without it is
  fetched twice). That one change is 300 ms of hex's first paint.
- **Art ships as WebP.** The cat frames are lossless WebP, pixel-identical to
  the PNGs they replaced, for 445 KB -> 262 KB.
- **Laptop-only code loads on the laptop.** Goomba's Figma clipboard reader is
  ~34 KB that only a `Ctrl+V` can reach, so it is a dynamic import behind the
  paste (`figma/paste.js`) and never reaches a phone. Both clipboard reads
  happen before that `await` and must stay there — a `DataTransfer` is only
  readable during its own event.
- **The socket is named in the markup.** Neither the room server's host nor
  partysocket's chunk name appeared in the HTML, so the connection could not
  start until the app chunk had been fetched AND parsed — partysocket was the
  last request either game made. `scripts/vite-net-hints.mjs` adds a
  `preconnect` and a `modulepreload` at build time, where both are known.
  partysocket stays a *dynamic* import on purpose: `?debug` and `?solo` run the
  whole game in-page with no socket at all, and a preload is a hint the browser
  may decline where a static import is 12 KB nobody can.
- **Hashed assets are cached forever.** Vercel's default for a static output
  directory is `max-age=0, must-revalidate`, which spends a round trip per file
  per reload asking a question a content hash has already answered — and a party
  reloads these pages a lot. The `assets/` rules in `vercel.json` say
  `immutable`; `art/` and `fonts/` are not hashed (they live in `public/`), so
  they get a day plus a week of stale-while-revalidate instead.

**Measured and rejected:** preloading the four day-pose images. The preload
scanner does not read inline SVG, so they are discovered late — but the
connection is bandwidth-bound rather than discovery-bound, and the preloads took
bandwidth from the stylesheet for a consistent ~20 ms of first paint and no gain
in the largest one. Don't re-add one without a measurement.

## A level is a link

The level editor has no server, no database and no account, and that is the
design rather than a shortcut. A design session produces twenty candidate levels,
nineteen of which never ship; standing up storage for them would be more
machinery than the levels are worth, and it would put a login between a person
and a drawing tool.

So a level IS a link. `encodeLevel` (`packages/shared/src/goomba/codec.ts`) packs
a whole level — name, terrain, cans, poppers, cushions, bumpers, start, goal, the
frame it was drawn in — into 100–350 base64url characters, which fits in a URL, a
chat message, a sticky note or a QR code. It round-trips byte-identical
(coordinates are quantised to tenths of a world unit, exactly the precision the
design tools emit, and then written as the STEP from the last point — a level is
a walk, and a step of a few units fits in a byte where a position never does).
`tools/goomba/test-codec.mjs` is the proof, against real links frozen from before
each time the format moved.

The codec lives in `shared/` because the browser, the Worker and the node tools
must agree on it byte for byte. Never fork it.

**The format has moved three times, and the cases are the rule for changing it
again.** Adding `frame` was free: it rides at the TAIL behind a flag bit, so
every offset before it is untouched and an older bundle reads a new link right up
to the frame and stops. Removing `solution` was not: `nSolution` sat
unconditionally in the MIDDLE, so dropping it moved every byte after it and no
flag could have said otherwise. That cost a version (fmt 2). Making links shorter
(fmt 3) moved every coordinate in the file, so it cost one too. Old links still
decode; an older bundle REFUSES a new one rather than misreading it, which is
deliberate — a level that goes missing is a bug someone can see. **A new field
rides at the tail behind a flag; anything that moves an existing byte costs a
version, and the Worker goes out first.**

What fmt 3 buys is 20–30% off the levels that were actually long. Coordinates
stop being positions and become STEPS from the last point, spelled as zigzag
varints, so a vertex two units along a polyline costs one byte instead of four.
The saving tracks chain length — `The Long Way Up` (46 vertices in 3 polylines)
went 355 characters to 263, the 12-vertex teaching level 143 to 139 — which is
the right way round, since the long links are the vertex-heavy ones. Three
tempting alternatives were measured and lost: general compression (deflate,
brotli) bought 1–10% on bytes this dense, a wider fragment alphabet bought 5% and
would have made links fragile in chat clients, and re-fitting terrain
semantically — arcs, repeats — is a lossy geometry rewrite for no gain, since not
one interior vertex of a real level is redundant even at 0.3u of tolerance.

### Levels live in the lobby

`GOOMBA_LEVELS` ships EMPTY and is filled by `setGoombaLevels` from whatever
arrives over the wire. `packages/shared/src/goomba/pack.ts` is the shape: an
ordered `string[]` of `encodeLevel` output. The lobby DO owns it, the goomba room
reads it object-to-object (it scores runs, so it cannot take a phone's word for
the geometry) and re-broadcasts it to phones as a separate `pack` message —
separate because snapshots go out at 10Hz during a band drag and the pack has
nothing new to say on any of them.

Edits ride the ROOM socket (the lobby's is closed the moment a phone learns its
team) and are forwarded to the lobby, which validates by DECODING, writes, and
pokes all four `TEAM_IDS` rooms so a change lands mid-session. **A new event
starts with no levels** — you fill it by pasting frames. `node seed.mjs --pull`
prints what an event is running; `--push --file <pack.json>` moves one between
events.

**The pack can change under a live room**, and `GoombaSim.reconcile` is the whole
of "apply immediately, keep progress": `completed` is re-fitted to the new
length, `level` is clamped back inside the pack, a run in flight is abandoned (it
was scored against geometry that may be gone), and the finish line is recomputed
both ways. It deliberately does NOT remap flags by identity — deleting a level
shifts every flag after it. That is the accepted cost of editing live.

**A level's display number is its array index + 1**, computed where it is shown
and stored nowhere (`levelLabel` in `goomba/levels.ts`). So removing, inserting or
dragging one renumbers the whole pack for free, and typing a number into a
level's `name` now double-numbers the card. The last level is the finale:
`nextLeadsToSplash` and the selector's clear-every-level gate both key off the
LAST index.

## Next steps (deliberately not in the scaffold)

- Per-session code words configured from the proctor dashboard.
- CI beyond the deploy guard: nothing runs `npm run typecheck` across the whole
  repo, or the tests (`tools/goomba/bands.mjs`, `test-codec.mjs`, the four in
  `tools/goomba/figma/`) on a pull request. The Worker deploy typechecks only the
  workspace it ships, deliberately — a broken proctor page shouldn't block a
  room-server deploy — so a PR check is a separate job worth adding.

## Teams and the lobby

Four teams, `t1`–`t4`, of `TEAM_SIZE` (4) players each. **A team id is also the
room id the game runs in**, so once the proctor puts someone on `t2`, their game
room is `t2` and nothing else has to agree on anything.

The flow: a player opens `/`, types a name, and waits — watching the room fill up
while they do (see below). The proctor's dashboard lists everyone on that page as
**five boxes** — Unassigned, then one per team — and sorting is **drag and drop
between them**, the only assignment gesture there is. Once assigned, the waiting
card goes away and the room IS the page — your box is the one wearing your
colour, with your name in it. No links out: the games are reached by their own
URLs, and because no surface ever carried the team in a link, dropping those
buttons changed nothing (a phone finds its room by asking the lobby for this
pid); chat has no link either, until it is ready to be shown.

Sorting is deliberately all manual. Who sits with whom is a judgement call made
in the room (friends, kids, one group of six), and the auto-assign button that
existed only ever produced an arrangement the proctor undid by hand.

The drag runs on **pointer events, not HTML5 drag-and-drop** — `dragstart` never
fires under a finger, and since dragging is the whole interface, a proctor on a
tablet would otherwise be unable to sort anyone.

**The game has no menu.** The client never shows a form: it asks the lobby for
this pid's room and slots straight in. Opening a game page also registers the
phone in the lobby roster, so it appears on the proctor's list either way. The
room is never written into the URL, so a refresh re-asks the lobby and a re-sort
takes effect on reload.

### The room, on a player's phone

Every phone shows **the room**: the four teams, their colours, and who is on
each of them, with your own row marked. It is the proctor's board with the drag,
the buttons, the game readouts and the chat taken out, and it exists because the
lobby already knew all of it: **every phone's snapshot carries the whole roster**
(`LobbySnapshot.players`), so this cost one render and not one byte of protocol.

**On a sorted phone it is the WHOLE screen.** There is no "you're on Team 3" card
over it any more, and no heading or counts above it: your box is the one wearing
your colour, lifted, with your name in it under a `you` pill — the same fact the
card used to state, drawn once, in the place that also answers where everybody
else went. Anything appears over the board only when the board cannot answer the
question, which is exactly one case: an **unsorted** phone is in none of the four
boxes, so it gets one muted line saying what it is waiting for.

**A status is a sentence, not a panel.** That line, and the "Connecting…" that
precedes the first snapshot, are the whole of it — no card, no title, no spinner.
Each part of the card they replaced was already on screen somewhere better: the
title named the app to somebody who had just typed their name into it, the
greeting named you (which the chip does, editably), and the spinner promised the
page was live — which the board does better and more honestly, since names appear
in boxes as the proctor sorts people, while a spinner keeps spinning after the
socket has dropped. There is now no animation anywhere on this page, which is why
there is no `prefers-reduced-motion` rule in its stylesheet either.

The cost of that trade is written down here because it was deliberate: the line
**"Grab the pink ears 🐾"** went with the card, and it was the one thing turning
a colour into an instruction — the headbands are on a table and somebody has to
pick one up. The colours are still on screen; the sentence telling you to go and
wear one is not. If people stop reaching for the headbands, that line is what to
put back, and the smallest place for it is the box that is already yours.

It is **read-only, and that is the design**. Sorting is a judgement call made in
the room and `assign` is proctor-only on the wire, so nothing on the board is
tappable and nothing on it declares a cursor — `pointer` would promise a tap that
the server would refuse. What it is for is the thing a waiting player actually
wants to know: which teams are still short, and which one their friends went to.

Two details are load-bearing and easy to tidy away:

- **A team's box is four seats whether or not they are filled**, exactly as on
  the proctor's board and for a sharper reason: the proctor is dragging names
  between boxes *while this is on somebody's phone*, and boxes that resized on
  every drop would make the whole board twitch under a player's eyes.
- **Team rosters are NOT filtered by `connected`.** That flag means "holding a
  socket to the lobby", which a sorted phone drops the moment it moves on to the
  game — so filtering on it would empty all four teams the instant they started
  playing. It is only trustworthy for an unsorted phone — which is what the
  proctor's board uses it for, and the reason nothing here counts on it.

**Your name is a chip under the board, on every screen but the first.** Renaming
happens in place: the chip becomes an input, `rename` goes down the socket the
lobby has always accepted it on, and you keep your team and your place. It
replaced a "Not Kelly?" link that *deleted the stored name* and threw the phone
back to the blank first-run screen, which is a different thing entirely. The
half-typed draft lives in module state rather than in the DOM, because a lobby
broadcast rebuilds this page — and the proctor is sorting people the whole time
somebody is renaming themselves.

### The proctor's board

**A box is EVERYTHING about one room, in one place**: the roster, both game
readouts, and the chat log, stacked in that order. They all answer the same
question — how is Team 2 doing? — so they are one card, not three. Unassigned is
a box like any other: its players are exactly the phones in the shared testing
room, so it carries t0's readouts and t0's channel in the same two slots
(`TestRoom.tsx`, `TeamChat` in `Chats.tsx`).

What does NOT live in a box is the chat SOCKETS — five of them, held by a
provider above the board so a re-render cannot reconnect them (five connections
reopening on every re-render would replay history each time).

**Every destructive control is per BOX**, which is the same argument the box
itself is: one card, one room. A team's box carries **Clear team** under its
roster and **Clear chat** under its log, beside the two game resets. The
board-wide pair they replaced wiped four conversations nobody asked about to turn
over one. Both are always drawn and go DISABLED at zero rather than
disappearing, and both confirm.

A full team refuses a fifth drop (it turns red under the drag instead of taking
it). That cap is enforced in the proctor UI only — the lobby server still accepts
any assignment it is sent. The proctor is the only client that assigns and
nothing here is a security boundary, so a second copy of the rule on the server
would be one more place to forget rather than a real guard.

**A team's box is a fixed size, and that is a hard requirement.** Five boxes sit
in one grid row, so a box that grew by a line when a codeword landed — or when a
mouse count reached seven figures — would shove its neighbours out from under a
proctor's finger, mid-drag. So: every seat is the same height whether filled or
empty, every readout line is drawn in every state (absent values become
placeholders), and long values are CLIPPED rather than wrapped. Adding a line to
a game block is a layout decision, not a free one. The chat log obeys the same
rule by a different means: a fixed 150px that scrolls internally, which is what
lets it sit inside a drop target at all.

Goomba's block is live off the fourth Durable Object: phase, current level,
levels completed out of the set, bands placed, plus its own reset. The phase is
its ICON alone (🛹 / 🎉 / 🏁 / ✏️), with the word on the tooltip. The finish line
is all levels completed, shown with the run time in the same slot the in-progress
count occupies. That same finish line unlocks the team's level selector, so the
proctor's reset is also how a cleared room is put back to level 1 with the grid
locked again.

Hex's block carries the one control here that is a GAME action rather than
housekeeping: **🏆 Mark won** — see "The win splash".

### The four bands

Goomba Glider gives a room **4 bands per level** (`MAX_BANDS`) and says nothing
about whose they are. Any player may lay any of the four, take back any of them —
their own or a teammate's — and clear the board. The whole permission check is

```
canPlaceBand(bands)  ⟺  bands.length < MAX_BANDS
```

in `goomba/sim.ts`, enforced at two points off that one implementation: the
client greys the gesture out with it (so a refused tap is never silent, and the
toast says why) and the Durable Object rejects with it anyway.

**The per-player quota is reverted, on purpose.** The room used to cap a player at
⌈4 / connected players⌉, so a full team laid exactly one each and nobody could
spectate. It cost more than it bought: presence became a game rule, a phone that
locked mid-level took a band's worth of budget with it, and a player who wanted
to say "no — put it *there*" had to talk someone else's thumb through it. The
argument over where the four bands go is the game; rationing the placements is
not what makes it multiplayer. `tools/goomba/bands.mjs` tests the room half,
because that half is code.

There is also **no rule about what a LEVEL must require**. There was — every
level must genuinely require all 4 bands, enforced by a simulation bench — and
both are deleted. A level is evaluated by people playing it. Don't rebuild the
bench, don't add a verdict to a level card, and don't write "must pass" into a
doc: this was tried, at length, and four people around a table found what
mattered sooner and said WHY. Git history has every line.

Mechanics worth knowing before changing any of it:

- **A band still carries the `pid` of whoever laid it**, and the pid survives a
  drop and rejoin. It is a note, not a claim: no rule reads it.
- **A band's colour is the TEAM's colour** — `earsFor(team).ink` from
  `shared/ears.ts`, the same ink the proctor's board paints that team's box in
  and the same colour as the cat-ear headbands on the table. Every band is that
  one colour, because every band is anybody's. The testing room (`t0`) is not a
  team and has no headband, so it and `?solo` fall back to pink. The party
  palette (confetti, ambient drift, bunting) keeps all four colours: decor, not
  identity.
- **A Durable Object handles one message at a time**, so the last band needs no
  locking: two players racing for it are serialized and the loser is refused.
- **Presence is not a game rule.** The `onConnect`/`onClose` broadcasts keep
  `players` current on the snapshot; nothing on either board reads it as a rule.
- **Both games draw the ROOM's names, and nothing else does.** A column above
  PLAY in Goomba, a column above the shop tray in Hex — one name per line, the
  dropped ones dimmed. Never a label on a teammate's anchor or a band: a name
  attached to a THING says whose it is, and neither game has an owner for
  anything. Goomba's earlier roster was deleted for a good reason and it was not
  this one — it was a centred line at a hardcoded offset, sitting in the corridor
  the bunting hangs in, so the party lights ran through the names. The argument
  that replaced it (four people in one living room already know who is here)
  holds mid-level and not for the minute before, which is when anyone asks. See
  `#team` in each app's `styles.css` for why a column and why no plate.

### Goomba's waiting screen is its how-to-play sheet

The gate a phone waits on before the proctor sorts it in shows the game's title,
two scenes and two short captions — where she is going (past every can, home to
the plant) and what the players do about it (lay bands in her way). `?`
bottom-left re-opens the same element mid-party, which is the half that was
actually missing: the old four-sentence gate was read once, by whoever was
looking, and nothing ever brought it back.

The scenes are drawn by the RENDERER, not by hand: `GOAL_SCENE` / `GESTURE_SCENE` in
`sheet.js` are level-shaped literals, and `drawScene` points the renderer's
surface at the sheet's little canvases and back — the same trick the level cards
play, and the reason a can in the picture cannot drift from a can in the game.

The sheet **never dismisses itself**: the first snapshot only ARMS it, so the
player taps past the pictures rather than having them yanked away the instant the
proctor sorts the phone in. The tap is bound to **pointerdown, not click** — the
kiosk lockdown preventDefault()s touchstart off buttons and links, which kills
the synthesised click, so an `onclick` here dismisses on a laptop and does
nothing on a phone (it shipped that way once). Don't add a second copy of these
instructions anywhere; edit the sheet.

### The win splash

Both games end on a terminal screen of their own and reach it two different ways,
because the two wins are different KINDS of fact.

**Goomba Glider scores its own.** Clearing every level sets `finishedAt`, and
taking NEXT off the finale lands the room on a terminal `splash` phase — a BLACK
screen with CONGRATULATIONS on it and one control: the level selector that same
clear unlocked. There is no picture; this app loads no image asset at all. The
words are drawn on the canvas (`drawSplashWords`) rather than in the HUD, centred,
and every line shrinks to fit rather than wrapping, which a canvas cannot do for
itself. The way on is the whole screen — a tap anywhere opens the grid, the dot
strip's plate still does too, and both go through one `openSelector`. The tap
fires on the RELEASE, so the grid never inherits the tail of the gesture that
opened it. `nextLeadsToSplash` is the single predicate for the transition INTO
it, so the PLAY button's "FINISH ▸" label and the sim's own branch cannot
disagree.

**Hex cannot.** Its ending is a code word that leaves the game on a phone and
comes back as four people reading it out to the proctor, so no amount of state in
the room proves it happened. The proctor presses **🏆 Mark won** (`wonAt`, a
proctor-only `won` intent, `hexWon`), and that unlocks a **gold pill top-left**
which the team can flip back and forth with: `🏆 win screen` shows the picture,
`← back to game` returns to the night scene. The wall stays live behind the
artwork the whole time — it is the thing they earned, and a victory screen that
buried it for good would be taking it away. It is a toggle, not a latch: taking a
win BACK confirms, granting one does not (you are standing in front of the team
who just read the word out). Which view a phone is on is LOCAL — Goomba's card
taps move what the room PLAYS, so those are wire intents; these are one room
state seen two ways. The splash raises itself once, on the live edge only, so a
rejoin gets the pill rather than a replayed celebration.

**Hex's splash picture is a drop-in file**:
`apps/hex-clicker/public/art/hex-splash.webp`. It is drawn as the WHOLE picture,
never cropped, fitted on whichever axis binds — width on a phone, height on a
laptop (fitting the width there would overflow and eat the cat off the top) — and
the slack is filled with sky SAMPLED from the picture's own edges: flat top and
bottom rows above and below it, a ramp between those two beside it. The two fills
never collide, so each is exact rather than approximate. Replace the file and it
brings its own sky; there is no palette to update, and don't go back to cropping
either axis.

Either win is taken back by that game's **reset**, along with everything else.

### The testing room

**An unsorted phone plays too, in one shared room.** `roomFor(team)` in
`packages/shared/src/lobby.ts` is the whole rule and all three surfaces ask it: a
sorted phone gets its team, an unsorted one gets `OPEN_TEAM` — room `t0`,
"Testing Room". It exists for the device-testing window, where new handsets turn
up with no proctor to drag them anywhere. `OPEN_ROOM_OPEN = false` restores the
waiting screen everywhere at once, which is what an event night wants.

- **`t0` is not in `TEAMS`.** The proctor's drop targets and the lobby's
  assignment validation both read that list, so the testing room can never be
  dragged into, and the board stays five boxes.
- **A sorted phone closes its lobby socket** the moment it learns its team. A
  phone in the testing room keeps it OPEN, because that answer can still change:
  when the proctor sorts a tester onto a real team, the page reloads and re-asks.
- **The proctor watches it inside the Unassigned box** (`TestRoom.tsx`) — same
  two game readouts, same two resets, which is the only way to unwedge a room
  nobody is sorted into. Not a sixth drop target; a block inside the first of
  five.
- **What degrades with a crowd.** Both games are built for four. Goomba has 4
  bands for the whole room however many phones are in it, so a crowd is a lot of
  thumbs over one board. Hex's click income is per tap, so it scales with however
  many phones are tapping — weakly: 20 phones are about 14% ahead of 4, inside
  the noise of how a team spends. Neither is a reason not to test on it; both are
  reasons not to leave `OPEN_ROOM_OPEN` on for a real group.

### `?r=` is the one room a URL may name, and it is never a team

**`?room=` is gone.** It let anyone edit a URL into another team's room, which
made the proctor's board advisory rather than authoritative, and it
`toUpperCase()`d its value — Durable Object names are case-sensitive, so a
scanned `?room=t2` played in room `T2` while that phone's teammates played in
`t2`. Two live rooms per team, neither of them the one the dashboard watched.

**`?r=<slug>` replaces it and cannot repeat any of that.** Both games read it and
play in room `r-<slug>` (`ADHOC_PREFIX` in `lobby.ts`) — a link you hand to
friends, so two who share it play together and one on his own plays alone, both
with the durable progress a team room has. Three properties keep it clear, and
all three are load-bearing:

- It cannot reach a **team**. The `r-` prefix is a namespace a team id can never
  enter, `assign` still validates against `TEAM_IDS`, and `roomFor` answers the
  team FIRST — so a stale bookmark can never override the proctor's board.
- It cannot be **cased wrong**. `adhocRoomId` lowercases and strips the slug in
  shared, so the URL bar, the game and the copied link agree byte for byte.
- It stays on **one origin**, so the pid still follows the player.

Both games take the same slug, because it names a ROOM and not a game:
`/g00mBa/?r=kelly` and `/hexxygon/?r=kelly` are two rooms sharing a name, the way
a team's two always have. Hex needs one thing Goomba does not — its win is a
proctor's press, so an ad-hoc room must reach the board or its players could earn
the code word and never be told they won. `HexServer` therefore announces itself
to the registry on connect, which is its only reason to call the lobby. Chat is
the one surface still out: a channel is read from a box on the board.

An ad-hoc room **plays** the level pack without editing it (`isAdhocRoom` in
`server/src/goomba.ts`). The levels grid is open to any phone on the premise that
the party's own phones are the tool, and a link handed outside the party is past
that premise — a friend on a laptop who cleared the game could otherwise delete a
level for the whole event.

The proctor watches them from a collapsible section at the bottom of the board
(`AdhocRooms.tsx`), which is also where both games' links are minted. Nothing can
list Durable Objects, so that list is a REGISTRY: a goomba room announces its own
name on the pack fetch it already makes on every connect, and the lobby remembers
it (pruned to a week, capped). A room therefore appears the first time somebody
JOINS it, never when the link is made. The list goes to proctor connections only
— a slug is not a secret, but broadcasting every friend room to the landing page
would put each one a tap away from every guest at the party.

### Persistence

Both parties persist to `room.storage`, tuned to what each can afford to lose:

- **The lobby writes through on every change.** Losing it costs every team its
  identity mid-event, and assignments change a handful of times per night.
- **The game room writes behind, every 5s** (`HexPersistedV1` in `hex/sim.ts` —
  the sim serializes itself; storage I/O stays in the room server). The sim
  mutates 4×/sec, so per-change writes would be per-tick writes; a 5s cadence
  bounds an eviction's loss to 5s of a 10-minute game. On rehydrate the gap is
  credited at the restored build rate, **capped at 30s** — a room left open
  overnight does not hand the next team a fortune — and elapsed time stays
  wall-clock. `speed` is `?debug`-only and never persisted. The one
  write-through exception is proctor **reset**, since rehydrating the previous
  run after an eviction would silently undo it. The tick/persist loops run only
  while someone is connected: the last socket closing stops them with a final
  save, so an empty room is evictable instead of pinning itself on the duration
  meter.

## Team chat

`/chat/` is one channel per team, and **the room id is the team id** — the same
convention the game rooms use, so the proctor sorting someone onto `t2` is also
what puts them in t2's channel. There is no team picker and no way to end up in
another team's chat. Like the game, chat has no menu: it asks the lobby for this
pid's room, and opening it registers the phone in the lobby roster.

This is the surface people TYPE, and the only way in: **the lobby has no chat
link at all**. The "Team chat" button went with the team card when the landing
page was stripped back to the board (see "The room, on a player's phone"), so
until chat is ready to be shown, `/chat/` is reached by typing it or off a QR.

What the chat server enforces (`server/src/chat.ts`, tunables in
`packages/shared/src/chat.ts`):

- **A bounded history.** `CHAT_HISTORY` messages per room, persisted one small
  key per message rather than as a blob. The lobby and the game room rewrite
  their whole state on every change, which is right for state that mutates in
  place; an append-only log would turn every line into a full-history write.
- **Clamped text.** Whitespace is collapsed and the result truncated to
  `CHAT_MAX_TEXT` — truncated, not rejected, so a pasted essay lands clipped
  rather than vanishing. Collapsing before the clamp is what makes the clamp mean
  anything: a screenful of newlines is one line of content.
- **A per-connection token bucket.** `CHAT_BURST` messages land instantly, then
  one per `CHAT_REFILL_MS`. Over the limit, messages are dropped silently.
- **No ticker.** Chat is entirely event-driven, so this DO does nothing at all
  between messages.

**Where the messages live.** In the chat DO's own `ctx.storage` — one key per
message, `m:` plus the zero-padded id, so `storage.list({prefix:"m:"})` returns
them chronologically and `onStart` rehydrates by listing the prefix. Nothing is
stored on Vercel or in `localStorage`.

**The proctor reads every channel**, live, inside each box. It connects with
`?role=proctor`, which the chat server treats as a spectator: a `say` from that
connection is refused and the Roster never counts it, so watching doesn't change
the "n here" line the team sees. **Clear chat** deletes the `m:` keys by prefix in
chunks of 128 (`storage.delete` takes no more at once), then broadcasts an
ordinary `chat` snapshot with an empty list — the same message a fresh connection
gets, so the wipe needed no new client case.

Two client-side notes that are easy to undo by accident:

- Message bodies are set with `textContent`, never `innerHTML` (in the proctor's
  React log, by rendering the string as a child). This is the one string on any
  surface in the repo that is arbitrary player-authored text.
- A line typed before the socket opens (or during a wifi drop) is **queued**, not
  dropped — the composer is on screen a moment before partysocket has connected.
  The hex client queues taps for the same reason.
