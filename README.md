# Escape Cats 🐾

Two cooperative 4-player mini games for a puzzle escape room, starring Hex and
Goomba. Players are sorted onto a team in the lobby and play together for ~10
minutes.

- **Hex Clicker** — a cooperative cookie-clicker. One shared mouse pool,
  shared buildings and upgrades. Petting Hex mints mice; buying the twist
  puts her to sleep, and the night wall's drifting dream-mice gradually ink
  the code word — identically on every phone.
- **Goomba Glider** — a line rider where the track is silly bandz. The team
  shares 4 elastic bands a level, and no player may hold more than
  ⌈4 ÷ players in the room⌉ of them — four players means one each, nobody
  spectates. Anyone hits PLAY and every phone watches the same deterministic
  ride: collect every watering can, then land on the thirsty spider plant.

## Layout

```
apps/hex-clicker/    Player client: vanilla JS/TS, the prototype's rendering split
                     into modules (see its src/README.md for the map)
apps/goomba-glider/  Player client for Goomba Glider: the prototype's canvas
                     rendering on the shared sim, driven by room snapshots
apps/lobby/          Landing page: name entry, then the team the proctor put
                     you on (and its chat) — no links into the games
apps/chat/           Per-team chat: one channel per team, roomed by team id
apps/proctor/        Hidden proctor dashboard, one flat page: five boxes, where a
                     box is a drag-and-drop drop target, its room's live game
                     status (+ reset) and its room's chat, read-only — plus one
                     QR into the lobby
packages/shared/     Wire protocol, seeded RNG, and BOTH whole games: hex
                     balance/rules/sim (hex/), and goomba levels + physics +
                     room sim (goomba/)
server/              Cloudflare Worker: two game rooms, team lobby and team
                     chat, as four Durable Objects (partyserver, NOT the
                     PartyKit platform)
tools/goomba/        Goomba level-design bench: node QA tools over the shared
                     sim + the design guide (DESIGNING.md). `verify.mjs` is the
                     gate, and it accepts an editor link as well as an index
```

## Where things live (so a retune touches one file)

- **Balance** — buildings, upgrades, costs, click math, wall ramp:
  `packages/shared/src/hex/data.ts` (+ `rules.ts` for derived rules). The
  server, the phones, and the client's `?debug` mode all import it,
  so there is exactly one copy to edit.
- **Game logic** — what a pet/purchase/golden-catch does: `packages/shared/src/hex/sim.ts`
  (the room server is a thin websocket wrapper around it).
- **Goomba levels & physics** — `packages/shared/src/goomba/levels.ts` and
  `physics.ts`; the multiplayer room state machine is `goomba/sim.ts`. The
  level-design loop and QA tools live in `tools/goomba/` (start with its
  `DESIGNING.md`). The **level selector** is what a team earns by clearing
  every level (`goombaCleared` in `goomba/sim.ts`, which is the same
  `finishedAt` the proctor's finish line reads — so it arrives on one snapshot
  for all four phones and a proctor reset takes it back): the **levels** grid,
  opened from the top-left level dots (once unlocked the strip wears a plate
  and a ▦), every level a card with live bare/solution verdicts, and tapping
  a card jumps the whole room to that level (teammates follow) — on a laptop
  that is a DOUBLE-click, since a single one selects (see the editor below). Taking NEXT off
  the finale of a cleared room lands on the **splash** phase — the
  congratulations screen, whose only control is that selector: the strip is
  still up top, and a tap anywhere on the picture opens the grid too. `?debug` is nothing but a local override of the
  unlock — one phone in the state a cleared room is in — and `?solo` runs the
  same grid on the in-page sim with no server (hex's
  `?debug` architecture). Testing happens
  on the real game — assign yourself to a team from `/proctor`, open with
  `?debug`; the four bands belong to the room and not to anybody in it, so one
  phone can still play everything (see "The four bands" below).
  **Laying a band** (`main.js`) takes
  whichever gesture a player reaches for — tap both ends, drag one end to the
  other, or stretch between two fingers — all three funnel into the same
  `place` intent. The edit camera is fixed at fit-the-whole-level and nothing
  pans, so any point a band can reach is a point a finger can reach.
  Teammates watch it happen: a drag streams as a ghost band, and a tap-tap
  waiting on its second tap streams as a named marker (a preview shorter than
  `BAND_MIN` — it can't become a band, so it reads as "choosing here").
- **The level editor is the level SELECTOR** — `apps/goomba-glider/src/figma/`,
  reached with `\` from inside the game. There is no separate editor page; the
  grid a cleared team earns is the same screen that edits the event's level
  pack, because both only ever wanted to show the same thing: every level as a
  card. `clipboard.js` decodes a plain Ctrl+C from Figma (a `fig-kiwi` payload,
  real layer names and stored geometry) and is the ONLY reader — an SVG-export
  path sat beside it and is gone, because Figma writes layer names into SVG only
  when the `id` attribute is on and names are the whole contract, so the copy
  people reach for first could never work; `stitch.js` chains the one-Line-per-
  segment terrain back into polylines so it DRAWS like a hand-authored level.
  What a paste produces is a level link, and the pack is a list of those — see
  "Levels live in the lobby" below. The grid it edits is two surfaces on one
  screen: a phone gets the free-play menu and nothing else (tap plays), a
  laptop gets a file browser — click selects, double-click plays, drag
  reorders, `⌫` deletes, and Ctrl+V lands on the
  selection — or, with the grid shut, straight onto the level you are playing,
  so the Figma loop does not cost a trip out to the grid and back. Deleting,
  and pasting over a level whose NAME does not match what is coming in, both
  ask first, on the browser's own `confirm()`. The kit and the naming contract are in
  [`tools/goomba/figma/README.md`](./tools/goomba/figma/README.md).
- **Art & rendering** — client-only, one module per system:
  `apps/hex-clicker/src/{wall,cat,art,fx,shop}.js`; Goomba's is one ported
  canvas module, `apps/goomba-glider/src/main.js`.
- **The prototype** (`hex/index.html`) is **deleted**. It was the tuning bench;
  that job moved to the multiplayer client's `?debug&speed=N` mode, which runs
  the same shared sim in-page. It had been frozen since #88 and was drifting
  further behind shipped balance with every retune, which made it a trap rather
  than a reference — git history has it if the port ever needs checking against
  its source. The two standalone tools it was hosting alongside now live in
  `tools/` (see [`tools/README.md`](./tools/README.md)).

## Architecture decisions (agreed up front)

1. **Monorepo** — the hard part (join/presence/reset/reveal plumbing) is
   shared; the games are apps on top of it.
2. **Mobile web, no install** — QR scan → URL → playing in seconds.
   Both games are portrait.
3. **Server-authoritative rooms** (Cloudflare Durable Objects). Clients send
   intents (clicks, purchases); the server owns all game state.
4. **Shared cooperative state** — one point pool in Hex Clicker.
5. **Deterministic synced toy animation** — toy positions are a pure
   function of (room seed, toy index, server-synced clock), so all four
   phones show the identical reveal pattern with zero position traffic.
6. **The code word is gated, not secret.** The server withholds it until the
   wall is legible, but the word itself is a plain constant in
   `packages/shared/src/hex/data.ts` — it ships in the client bundle regardless
   (`?debug` runs the sim in-page), and the wall art is hand-placed glyphs for
   that exact string. Nothing here is a security boundary; see also the
   proctor role in `server/src/connections.ts`.
7. **10 minutes is a completion target, not a timer** — achieved through
   balance. All economy/level tuning lives in `packages/shared/src/hex/data.ts`
   and `levels.ts`, never in game code.
8. **Seat reclaim** — each phone has a persistent player id in localStorage,
   so a locked phone or dropped wifi rejoins the same seat.

## Development

```sh
npm install
npm run dev
```

This starts everything:

| What          | URL                                        |
| ------------- | ------------------------------------------ |
| Room server   | 127.0.0.1:1999 (wrangler dev)              |
| Hex Clicker   | http://localhost:5173/hexxygon/            |
| Goomba Glider | http://localhost:5178/g00mBa/              |
| Proctor       | http://localhost:5175                      |
| Team lobby    | http://localhost:5176                      |
| Team chat     | http://localhost:5177                      |

Open the lobby on phones on the same wifi (one address for the whole room),
then drag each phone onto a team from the proctor page. The vite servers listen
on the LAN; point `VITE_PARTYKIT_HOST` at your machine's LAN IP for phone
testing — see `.env` handling below.

Simulate 4 players locally with 4 browser tabs — but note the persistent
player id is per-browser-profile, so use different profiles/incognito
windows to appear as different players.

**Locally, start each fake player at the GAME, not at the lobby.** In
production every surface shares one origin, so a phone sorted on the landing
page carries its pid into the game. In dev they are separate vite ports, which
means separate origins and separate `localStorage` — so a game opened on its own
port is a brand-new pid the proctor has never sorted, which lands it in the
testing room (or, with that closed, on a waiting screen) as an unsorted "Cat".
`?room=` used to paper over this and is gone (see `?room=` below). Open
`localhost:5173/hexxygon/` directly instead: the game page registers itself in
the lobby roster, appears on the proctor's board, and reloads into its team the
moment you drag it onto one. Set `escape-cats-name` in that origin's
`localStorage` first if you want it to show up as something other than "Cat".
Serving every app through one dev port would remove the whole wrinkle.

For balance work on Hex, **`?debug`** runs the shared sim in the page with no
server at all, and `?speed=N` fast-forwards it — so
`localhost:5173/?debug&speed=20` walks a whole run in about 20 seconds. It is
the only mode besides the real game, and the only fast-forward — a real room
always runs at ×1. (`?solo` was the interim name and still works.)

`?debug` also mounts a floating **🛠 panel** — grant buttons, story-beat jumps
(`day` → `legible`, see `packages/shared/src/hex/presets.ts`), a 🏆 win toggle
(the stand-in for the proctor's press, so the win splash is testable without a
second surface open), time scale and reset. This is the old prototype panel ported onto the SHIPPED economy: presets
drive the real `HexSim`, so what you tune here is what players get. The panel's
controls call the sim directly and exist only in this mode — nothing
debug-related is in the wire protocol, so there is no path to a real room.
`window.__hexSim` exposes the sim itself (the mirror in `__hex.game` drops
server-private fields like `legibleAt`); use it for console-driven tuning.

Modes are **query params, never paths**. `?debug` modifies the same page rather
than naming a different one, params compose (`?debug&speed=20`) where path
segments don't, and a path would need a rewrite per mode on a static host —
`/hexxygon/debug` is a 404 unless routing is taught about it.

`window.__hex` exposes the state mirror and a `send()` for driving the game
from a console or a test — always on, in any mode.

## Configuration

Client env vars (Vite, set in `apps/*/.env.local`):

- `VITE_PARTYKIT_HOST` — host:port of the room server (default `127.0.0.1:1999`).
  Kept under its old name: it is what `partysocket` reads on every client.

`VITE_HEX_URL` / `VITE_GOOMBA_URL` used to point the lobby's **Play** buttons at
the public game URLs. The lobby no longer links to the games — a sorted player
sees their team and nothing else, and the games are reached by their own URLs —
so nothing reads those vars. They are harmless if still set in Vercel.

The server takes no vars. The code word is a constant
(`HEX_CODEWORD` in `packages/shared/src/hex/data.ts`, paired with the wall
art), and the proctor identifies itself with `?role=proctor` — a claim, not a
credential. Anyone who opens `/proctor` can watch and reset the rooms; that is
accepted, not overlooked. Nothing here defends against a determined player,
and the only power on offer is reset on a room you are already in.

## Deploying

Two deploys total: **one Cloudflare Worker** (the rooms) and **one Vercel
project** (every static surface). Vanity domains are routed inside
`vercel.json`, not by splitting into more projects — so adding a domain or
repointing one is a repo change, not dashboard clicking.

### 1. The room server — Cloudflare Workers

Can be done last if you just want the site up: the single-player surfaces
(`/prototypes/`, the `tools/` pages, and `?debug`) need no server, and the coop
client builds and deploys fine with a stub `VITE_PARTYKIT_HOST` — it renders
its join screen and only fails at the point of joining a room.

**CI deploys it now** — `.github/workflows/deploy-worker.yml`, on any push to
`main` that touches `server/**`, `packages/shared/**` or the lock file, and on
demand via **Run workflow** (`workflow_dispatch`) against any branch. It runs
`npm run typecheck -w server` as a guard first, so a Worker that doesn't compile
is never deployed. See "Deploy order" below for when to use the manual trigger.

It authenticates with an API token, not the browser login: add
**`CLOUDFLARE_API_TOKEN`** to the repo's Actions secrets, minted from the
dashboard's **Edit Cloudflare Workers** template (Account → Workers Scripts:
Edit, which covers Durable Objects and migrations). Nothing here uses custom
domains, so no zone permissions are needed. If the token can see more than one
Cloudflare account, wrangler refuses to guess — add
**`CLOUDFLARE_ACCOUNT_ID`** as a second secret; it is ignored when unset.

By hand, from the repo root:

```sh
npm run cf:login        # once, per machine — opens a browser
npm run deploy:server   # wrangler deploy
```

Wrangler is a dependency of the `server` workspace, not of the root, so a bare
`npx wrangler login` at the top level fails with "not recognized" — these
scripts route it through the workspace for you. `cf:login` is a browser OAuth
flow, so it is for laptops only: a CI runner or a remote agent container has no
browser and no persistent home directory, which is why those use the token.

Three Durable Objects behind one Worker: the `Main` binding is the game room,
`Lobby` is the team lobby and `Chat` is per-team chat, and
`routePartykitRequest` maps them onto the `/parties/:party/:room` URLs the
clients already speak. There are no deploy vars to set.

Adding a DO class needs its own **new** migration tag in `wrangler.jsonc` —
migrations are append-only and each tag runs once, so a new class is never an
edit to an existing tag.

**Deploy order.** The Worker must be live BEFORE the Vercel build that depends
on it, or a client speaks a protocol the live Worker doesn't know and is simply
ignored. CI has narrowed this gap but not closed it: a push to `main` starts the
Worker deploy and the Vercel build *at the same time*. The Worker job normally
wins by a wide margin — it has no Vite builds, no assemble step, no routing
check — but "normally" is not a guarantee, and the two are independent.

So for a **breaking** protocol or DO change, don't race them: run **Deploy
Worker** manually against the PR branch first, confirm it is live, then merge.
The Worker is already serving the new protocol when Vercel picks the merge up.
For additive changes (a new snapshot field, a new intent the old client never
sends) the race is harmless and the automatic path is fine.

The Worker is live at **`escape-cats.escape-cats.workers.dev`** — the first
label is the Worker name (`name` in `wrangler.jsonc`), the second is the
account-wide workers.dev subdomain, which prefixes every Worker on the account.
That hostname is what `VITE_PARTYKIT_HOST` must point at.

Renaming the Worker later is not free: Durable Object storage is keyed to the
Worker, so a rename creates a NEW Worker with EMPTY storage and orphans the old
one along with every room in it.

**This does NOT run on the PartyKit platform**, despite the `partysocket` and
`partyserver` packages. PartyKit's hosted tier stopped accepting new projects
in June 2026 — its shared `partykit.dev` zone hit Cloudflare's cap of 10,000
custom domains per zone ([partykit#985](https://github.com/partykit/partykit/issues/985),
still open). The server runs on **your own** Cloudflare account instead, which
is what PartyKit's author recommends. `partyserver` is the same programming
model on plain Workers + Durable Objects, so the client code was unaffected by
the move; only the host changed.

Room state lives in Durable Object storage (`ctx.storage`), so a Worker
redeploy or an evicted room does not lose a team's progress.

What the free tier actually meters is **duration** — GB-seconds of objects
held resident — not requests, so the design keeps rooms evictable. All three
servers hibernate (`static options = { hibernate: true }`): an open-but-idle
socket no longer pins its object in memory, and per-connection identity rides
the socket attachment so it survives eviction. The game room's 4Hz tick loop
runs only while a **player** is connected — a proctor is a spectator of a
paused game and gets a snapshot on connect instead — and the proctor page
drops its sockets while the tab is hidden. Before all this, one forgotten
proctor tab kept five objects awake around the clock, which at 128 MB each is
~11,000 GB-s/day against a 13,000 GB-s/day free allowance.

### 2. Vercel — one project

Import the repo; leave **Root Directory** at the repo root. Build settings
come from `vercel.json`, so there is nothing to override in the dashboard.

`npm run build:vercel` builds the three Vite apps and then
`scripts/assemble.mjs` collects every surface into one `dist/`:

| Path in `dist/` | Source | What |
| --- | --- | --- |
| `/` | `apps/lobby` | Team lobby (landing page) |
| `/hexxygon/` | `apps/hex-clicker` | Hex Clicker (coop) |
| `/g00mBa/` | `apps/goomba-glider` | Goomba Glider (coop) |
| `/chat/` | `apps/chat` | Per-team chat |
| `/proctor/` | `apps/proctor` | Proctor dashboard |
| `/qr-studio/` | `tools/qr-studio.html` | QR Art Studio |
| `/reveal-lab/` | `tools/reveal-lab.html` | Night reveal wall lab |
| `/prototypes/` | `prototypes/` | Prototypes menu |

A single-file surface is copied to `<name>/index.html`, so it gets a pretty URL
without a rewrite — the path is a real directory. `/ar/` and both `tools/` pages
work that way.

Env vars (all in this one project — `VITE_PARTYKIT_HOST` is set once here, so
every surface points at one server):

```
VITE_PARTYKIT_HOST=escape-cats.escape-cats.workers.dev
```

**Root Directory must be blank.** `vercel.json` overrides the dashboard's
framework, build command and output directory, but it cannot set the root
directory — it is read *from* it. A project pointed at `prototypes/` or `tools/`
never sees this file, so `build:vercel` never runs and the hostname rewrites
never apply.

### 3. Vanity domains

Attach the domain to the project in Vercel, then add **two** host rewrites in
`vercel.json` pointing it at the right subdirectory — one for the bare root,
one for everything below it:

```json
{
  "source": "/",
  "has": [{ "type": "host", "value": "hex.example.com" }],
  "destination": "/hex/index.html"
},
{
  "source": "/:path*",
  "has": [{ "type": "host", "value": "hex.example.com" }],
  "destination": "/hex/:path*"
}
```

The root rule must come first — Vercel takes the first matching rewrite.

Both rules are load-bearing, and each covers a case the other cannot:

- **The `/:path*` rule cannot serve the bare root.** With zero path segments
  the destination resolves to `/hex/`, a directory rather than a file. Rewrites
  run *after* the filesystem check, so the directory-index lookup that turns
  `/hex/` into `/hex/index.html` has already been passed — the rewrite
  destination is resolved as an exact output path, and 404s. `assemble.mjs`
  writes no `dist/index.html`, so nothing catches the request first. Symptom:
  every deep link works, the domain root alone 404s.
- **Use `:path*`, not `/(.*)` with `$1`.** Vercel only substitutes `$1` when
  the source is an explicitly anchored regex; an unanchored source is parsed as
  path-to-regexp, where `$1` is not a substitution token, so every request
  rewrites to a literal `/hex/$1` and 404s — including the root.

Conversely, do **not** fix the root by adding a `dist/index.html` landing page.
The filesystem check runs before rewrites, so a root index would win over the
`"source": "/"` rules and every vanity domain would serve the landing page
instead of its game.

**The same root gap in the *redirect* form fails silently and much worse.**
There now IS a `dist/index.html` (the lobby), so a missing `"source": "/"` rule
does not 404 — the root quietly serves the lobby, while that page's own
`/assets/*` requests still match `/:path*` and get redirected cross-origin.
Vite marks those tags `crossorigin`, the redirected origin sends no
`Access-Control-Allow-Origin`, and the browser blocks the script and the
stylesheet. `#app` never populates, so the symptom is a **pure white page with
nothing in the console except CORS errors** — which reads like a broken build,
not a routing bug. `check-routing.mjs` asserts the expected landing path for
every vanity root specifically to catch this; keep those expectations current.

`vercel.json` also cannot carry comments — it is strict JSON and Vercel's
schema rejects unknown keys, so a `"comment"` field fails the deployment with a
link to the project-configuration docs. Explanations go here instead.

The two vanity domains **redirect** (307) into this origin rather than
rewriting to it:

| Domain | Redirects to | Serves |
| --- | --- | --- |
| `hexxygon.com` | `/hexxygon/` | Hex Clicker coop |
| `g00.mba` | `/g00mBa/` | Goomba Glider coop |
| `g00.mba/ar` | `/ar/` | Scent Tracker (AR prototype) |

`g00.mba/ar` borrows the Goomba domain purely as a short URL to type on a
phone; it is not part of that game. Its rule must sit **before** the host's
`/:path*` catch-all in `vercel.json` — redirects are matched in array order, and
the catch-all would otherwise swallow `/ar` into `/g00mBa/ar/` and 404. It is
registered in both slashed and unslashed forms for the same reason the
`/qr-studio` rewrites are.

Redirect, not rewrite, is the whole point: it puts every player on one origin,
so the `localStorage` pid the lobby assigned a team to is the same pid the game
sees. A rewrite would leave each vanity domain as its own origin with its own
empty store, and the team would not follow. See "The origin constraint" below.

They are 307s, not 308s -- a permanent redirect is cached by the browser
indefinitely and would be painful to walk back.

The paths are `/hexxygon` and `/g00mBa` rather than `/hex` and `/goomba` so
that a player who guesses a path cannot walk into a game without being sorted
onto a team first. **`/g00mBa` is case-sensitive** — URL paths are, per RFC
3986, and Vercel honours that — so `/g00mba` is a 404. The QR code carries the
exact casing.

**Each app's vite `base` must be absolute and match its `dist/` subdirectory**
— `/hexxygon/`, `/g00mBa/`, `/proctor/`, `/` for the lobby. Do not make them
relative.

Vercel serves with `trailingSlash: false`, so a request for `/hexxygon/` is
normalised to `/hexxygon`. Against that URL the browser resolves a `./assets/`
reference to `/assets/` — the **lobby's** asset directory, not the app's. The
HTML loads, its script 404s, and you get a white screen with nothing useful in
the console.

A relative base was correct when the vanity domains *rewrote* to these paths
and an app could be served from a domain root. Since they *redirect* (#99),
each app only ever lives at its own path, and an absolute base is both simpler
and immune to the trailing slash.

`vercel.json` sets **`trailingSlash: true`**, so directory URLs keep their
slash. That is what hand-authored HTML in `prototypes/` assumes: a sibling link
like `scent-tracker.html` resolves correctly from `/prototypes/` but points at
the site root from `/prototypes`. Paths carrying a file extension are excluded
from the redirect, so a rewrite whose source is an extensionless pretty URL has
to be registered in both slashed and unslashed forms to catch both sides of
that 308. Landing a single file as `<name>/index.html` in `assemble.mjs` avoids
the problem entirely — no rewrite, nothing to register twice — which is how
`/qr-studio/` and `/reveal-lab/` are served.

Do not test this with `python -m http.server`. It redirects `/hexxygon` to
`/hexxygon/`, the opposite of Vercel's default, so it will happily serve a
build that is broken in production — which is exactly how two of these
shipped.

Instead run **`npm run check:routing`**, which resolves every surface through
a router implementing `vercel.json` (trailing slash, then redirects, then
rewrites, then the filesystem) and follows each page's own links and assets.
It runs as part of `build:vercel`, so a routing regression fails the Vercel
build rather than reaching a player's phone.

`hex/vercel.json` and `prototypes/vercel.json` are leftovers from when those
folders were their own Vercel projects. They are inert under the
single-project setup (only the root `vercel.json` is read); keep them only if
you intend to split those surfaces back out.

## The editor saves into its URL

The level editor has no server, no database and no account, and that is the
design rather than a shortcut. A design session produces twenty candidate
levels, nineteen of which never ship; standing up storage for them would be
more machinery than the levels are worth, and it would put a login between a
person and a drawing tool.

So a level IS a link. `encodeLevel` (`packages/shared/src/goomba/codec.ts`)
packs a whole level — name, terrain, cans, poppers, cushions, bumpers, start,
goal, the four-band solution — into 100–450 base64url characters, which fits in
a URL, a chat message, a sticky note or a QR code. Every level currently in
`levels.ts` round-trips through it byte-identical (coordinates are stored in
tenths of a world unit, which is exactly the precision the design tools emit).
This is the trade `tools/qr-studio.html` already makes for its drawings, and
the storage tiers are the same three:

1. **`location.hash` — sharing.** Read at boot, written when someone presses
   *copy link*. Not rewritten on every drag: a hash that changes with each
   gesture turns the back button into an undo log and buries the link the
   designer arrived on.
2. **`localStorage` — the draft.** Autosaved continuously, so a reload or a
   closed lid costs nothing.
3. **The tray** — a named list of links in `localStorage`, so one laptop can
   hold a whole group's output, and *download .links* writes the file
   `node verify.mjs --file` reads.

The payoff is that the codec is shared code, not editor code: `lib.mjs` bundles
it for the node bench too, so `node verify.mjs --hash <link>` runs the full
gate — including the beam search the browser never runs — on a level that
nobody has committed. A design can be made, shared, gated and rejected before
it is ever a diff.

## Next steps (deliberately not in the scaffold)

- Per-session code words configured from the proctor dashboard.
- CI beyond the deploy guard: nothing runs `npm run typecheck` across the whole
  repo, the level gates (`tools/goomba/verify.mjs`) or the room gate
  (`bands.mjs`) on a pull request. The Worker deploy typechecks only the
  workspace it ships, deliberately — a broken proctor page shouldn't block a
  room-server deploy — so a PR check is still a separate job worth adding.

## Teams and the lobby

Four teams, `t1`–`t4`, of `TEAM_SIZE` (4) players each. **A team id is also the
room id the game runs in**, so once the proctor puts someone on `t2`, their game
room is `t2` and nothing else has to agree on anything.

A team box draws all four seats whether or not they are filled, so a short team
reads as unfinished rather than merely small, and a full team refuses a fifth
drop (it turns red under the drag instead of taking it). That cap is enforced in
the proctor UI only — the lobby server still accepts any assignment it is sent.
The proctor is the only client that assigns, and nothing here is a security
boundary, so a second copy of the rule on the server would be one more place to
forget rather than a real guard.

**A box is EVERYTHING about one room, in one place**: the roster, both game
readouts, and the chat log, stacked in that order behind one divider each. They
all answer the same question — how is Team 2 doing? — so they are one card, not
three. Unassigned is a box like any other: its players are exactly the phones
in the shared testing room, so it carries t0's readouts and t0's channel in the
same two slots (`TestRoom.tsx`, `TeamChat` in `Chats.tsx`). What does NOT live
in a box is the chat SOCKETS — five of them, held by a provider above the board
so a re-render cannot reconnect them, and so the one "Clear all chats" button
can fan out over all five at once.

**A team's box is a fixed size, and that is a hard requirement rather than a
nicety.** Five boxes sit in one grid row, so a box that grew by a line when a
codeword landed — or when a mouse count reached seven figures, or when a fourth
absent player joined the "not in game" list — would shove the boxes beside it out
from under a proctor's finger, mid-drag. So: every seat is the same height
whether filled or empty, every readout line is drawn in every state (absent
values become placeholders, and the finished-run line occupies the same slot the
"codeword locked" line does), and long values are CLIPPED rather than wrapped.
Adding a line to a game block is therefore a layout decision, not a free one.
The chat log obeys the same rule by a different means: it is a fixed 150px that
scrolls internally, so a hundred messages move nothing. That fixed height is
what lets it sit inside a drop target at all — it was below the board until the
height, not the position, turned out to be the load-bearing part.

Goomba Glider's block in each team box is live: the fourth Durable Object
(`Goomba` binding, roomed by team id like everything else) feeds it phase,
current level, levels completed out of the set, bands placed and fails — plus
its own reset button. Every level is played with the full 4-band budget; the
finish line the proctor watches for is all levels completed, shown with the
run time in the same slot the in-progress count occupies (the box never
changes height). That same finish line is what unlocks the team's level
selector and what its `🏁 splash` phase means, so the proctor's reset is also
how a cleared room is put back to level 1 with the grid locked again.

Hex's block carries the one control on this dashboard that is a GAME action
rather than housekeeping: **🏆 Mark won**. Hex cannot score its own win — the
code word leaves the game on a phone and comes back as four people reading it
out to you — so the win is something you witness and press, and pressing it
unlocks that team's win splash on all four of their phones (see "The win
splash" below). The readout line above the button swaps its ✅ for a 🏆 to
match. It is a toggle: press it again to take a win back, which asks first,
because it pulls a picture off four phones mid-event. Granting one does not
ask — you are standing in front of the team who just read the word out.

### The four bands

Goomba Glider gives a room **4 bands per level** (`MAX_BANDS`) and says nothing
about whose they are. Any player may lay any of the four, take back any of them
— their own or a teammate's — and clear the board. The whole permission check is

```
canPlaceBand(bands)  ⟺  bands.length < MAX_BANDS
```

in `goomba/sim.ts`, and it is enforced at two points off that one
implementation: the client greys the gesture out with it (so a refused tap is
never a silent one, and the toast says why) and the Durable Object rejects with
it anyway.

**This replaced a per-player quota**, and the revert is the product decision
worth recording. The room used to cap a player at ⌈4 / connected players⌉ bands,
so a full team was forced to lay exactly one each and nobody could spectate.
It worked, and it cost more than it bought: presence became a game rule, a
phone that locked mid-level took a band's worth of the team's budget with it
until its socket closed, and a player who wanted to say "no — put it *there*"
had to talk someone else's thumb through it. Four people around one board are
already a crowd; the argument over where the four bands go is the game, and
rationing the placements is not what makes it multiplayer.

What is left carrying that weight is the level-design gate. With nobody
rationed, **a level that wins on one band is a level three people watch** — so
geometry that genuinely needs all four (`tools/goomba/verify.mjs`) is the only
thing standing between the party and a solo puzzle. Two gates still, but they
no longer split one rule: `verify.mjs` for the geometry, `tools/goomba/bands.mjs`
for the room.

Mechanics worth knowing before changing any of it:

- **A band still carries the `pid` of whoever laid it**, and the pid is the
  persistent localStorage identity, so it survives a drop and rejoin. It is a
  note, not a claim: no rule reads it, and it no longer picks the band's colour.
- **A band's colour is the TEAM's colour** — `earsFor(team).ink` from
  `shared/ears.ts`, the same ink the proctor's board paints that team's box in
  and the same colour as the cat-ear headbands on the table. Every band on the
  board is that one colour, because every band is anybody's. The bands used to
  wear one colour per roster slot, which is exactly the ownership that is gone.
  The testing room (`t0`) is not a team and has no headband, so it and `?solo`
  fall back to the old pink. The party palette (confetti, the ambient drift, the
  bunting) keeps all four colours: that is decor, not identity.
- **A Durable Object handles one message at a time**, so the last band needs no
  locking: two players racing for it are serialized, and the loser is refused by
  the `bands.length` check.
- **Presence is no longer a game rule**, and it is no longer drawn either. The
  `onConnect`/`onClose` broadcasts still keep `players` current on the snapshot,
  but nothing on Goomba's HUD renders it: a phone that locks mid-level costs the
  team nothing, and there is nobody to watch drop out.
- **Goomba draws no player NAMES.** Not a roster line under the band slots, not
  a label on a teammate's waiting anchor — both were there and both are gone.
  Four people playing one board are in one living room, so a name on the screen
  only ever repeated what everyone could see by looking up. Names still travel
  the wire (`join` carries one, the room keeps it on `players`) because the
  LOBBY and the proctor's board are where a name does real work; the game just
  never paints one. Hex still shows its roster line — this is Goomba's call, not
  a house rule.


The flow: a player opens `/`, types a name, and waits. The proctor's dashboard
lists everyone currently on that page as **five boxes** — Unassigned, then one
per team — and sorting is **drag and drop between them**, the only assignment
gesture there is. Once assigned, the player's page turns into their team name
and who else is on it — no game links. The games are reached by their own URLs
(the vanity domains, which redirect onto this origin), and because no surface
ever carried the team in a link, dropping the buttons changes nothing about how
a phone finds its room: it asks the lobby for this pid.

Sorting is deliberately all manual: an auto-assign button existed and was
removed. Who sits with whom is a judgement call made in the room (friends,
kids, one group of six), and a round-robin only ever produced an arrangement
the proctor then had to undo by hand.

The drag runs on **pointer events, not HTML5 drag-and-drop** — `dragstart`
never fires under a finger, and since dragging is now the whole interface, a
proctor on a tablet would otherwise be unable to sort anyone. Two other
controls survive: **×** on a row forgets that one player (their phone
re-registers if it is still connected), and **Clear teams** sends everybody
back to Unassigned between groups.

**The game has no menu.** `apps/hex-clicker` never shows a form: it asks the
lobby for this pid's room and slots straight in. Opening the game page also
registers the phone in the lobby roster (same pid+name contract as the landing
page), so it appears on the proctor's list either way. `?debug` bypasses the
server entirely. The room is never written into the URL, so a refresh re-asks
the lobby and a proctor re-sort takes effect on reload.

### The win splash

Both games end on the same picture and reach it two different ways, because the
two wins are different KINDS of fact.

**Goomba Glider scores its own.** Clearing every level sets `finishedAt`
(`goombaCleared`), and taking NEXT off the finale then lands the room on a
terminal `splash` phase — one full-screen picture, CONGRATULATIONS over it, and
one control: the level selector that same clear unlocked. The words are drawn
on the canvas with the picture (`drawSplashWords`) rather than in the HUD, so
they are measured against the art and shrink to fit a narrow phone; they are
deliberately boilerplate, because the art under them is a stand-in and words
that leaned on a particular picture would have to be redrawn with it. The way on
is the whole screen — a tap anywhere opens the grid (`splashTap`), the dot
strip's plate still does too, and both go through one `openSelector`.
`nextLeadsToSplash` is the single predicate for the transition INTO it, so the
PLAY button's "FINISH ▸" label and the sim's own branch cannot disagree.

**Hex cannot.** Its ending is a code word that leaves the game on a phone and
comes back as four people reading it out to the proctor, so no amount of state
in the room proves it happened. The proctor presses **🏆 Mark won** instead
(`wonAt`, a proctor-only `won` intent, `hexWon`), and that unlocks a **gold pill
top-left** which the team can flip back and forth with: `🏆 win screen` shows
the picture, `← back to game` returns to the night scene. The wall stays live
behind the artwork the whole time — it is the thing they earned, and a victory
screen that buried it for good would be taking it away. Which view a phone is on
is that phone's business (Goomba's card taps move what the room PLAYS, so those
travel; these are one room state seen two ways). The splash raises itself once,
on the live edge, exactly as the night cutscene fires once and never replays for
a rejoining phone.

Both pictures are ordinary files —
`apps/{goomba-glider,hex-clicker}/public/art/*splash.webp`, the same image for
now as a stand-in until Goomba has its own — and both are drawn the same way:
the WHOLE picture, never cropped, fitted on whichever axis binds. A phone is far
narrower than these are tall, so the width binds and the slack is above and
below; a laptop is wider than the picture is proportionally tall, so the height
binds instead and the slack is to the sides (fitting the width there would
overflow the screen and eat the top of the art, which is where the cat is). The
sky is continued into whichever slack there is, in colours sampled from the
picture's own edges: flat top and bottom rows above and below it, and a ramp
between those two beside it, pinned to the art's own ends so it tracks the sky
painted down the picture's edge. The two fills never collide — a width-fitted
picture covers the screen side to side, a height-fitted one covers it top to
bottom — so each is exact rather than approximate. Replace a file and it brings
its own sky; there is no palette to update.

Either win is taken back by that game's **reset**, along with everything else.

### The testing room

**An unsorted phone plays too, in one shared room.** `roomFor(team)` in
`packages/shared/src/lobby.ts` is the whole rule and all three surfaces (both
games and chat) ask it: a sorted phone gets its team, an unsorted one gets
`OPEN_TEAM` — room `t0`, "Testing Room". It exists for the device-testing
window, where new handsets turn up with no proctor in the room to drag them
anywhere; `OPEN_ROOM_OPEN = false` restores the old waiting screen everywhere at
once, which is what an event night wants.

The details that make it behave:

- **`t0` is not in `TEAMS`.** The proctor's drop targets and the lobby's
  assignment validation both read that list, so the testing room can never be
  dragged into, and the board stays five boxes.
- **A sorted phone still closes its lobby socket** the moment it learns its
  team, exactly as before. A phone in the testing room keeps it OPEN, because
  that answer can still change: when the proctor sorts a tester onto a real
  team, the page reloads and re-asks — which lands it in the team's room, chat
  included. That is the only new socket this adds, and only for phones that
  would have been sitting on a waiting screen anyway.
- **The proctor watches it inside the Unassigned box**
  (`apps/proctor/src/TestRoom.tsx`): same two game readouts, same two reset
  buttons, which is the only way to unwedge a room nobody is sorted into, and
  t0's chat log under them. It goes there because the pen's roster IS the set of
  phones playing in t0 — the same pairing a team's box makes between its players
  and its games. It is still not a sixth drop target; it is a block inside the
  first of the five.
- **What degrades with a crowd.** Both games are built for four. Goomba has 4
  bands for the whole room however many phones are in it, so a crowd is a lot of
  thumbs over one board — first tap wins the band, and the rest watch or lift it
  back off (the room still works, it just stops being a party). Hex's click
  income is per tap, so it scales with
  however many phones are tapping — weakly: the sim puts 20 phones about 14%
  ahead of 4, well inside the noise of how a team spends. Neither is a reason
  not to test on it; both are reasons not to leave `OPEN_ROOM_OPEN` on for a
  real group.

**`?room=` is gone, and asking the lobby is the only way in.** It used to
override the lookup — the proctor's per-team QR codes carried it — and it had
to go for two reasons. It let anyone edit a URL into another team's room, which
made the proctor's board advisory rather than authoritative. And it
`toUpperCase()`d the value it was given, a leftover from the ad-hoc four-letter
room codes: Durable Object names are case-sensitive, so a scanned `?room=t2`
played in room `T2` while that phone's lobby-sorted teammates played in `t2`.
Two live rooms per team, neither of them the one the dashboard watched, and a
team silently split by how each phone happened to arrive.

Removing it costs nothing because every surface is one origin (the vanity
domains redirect — see "The origin constraint"), so the pid the proctor sorted
is the pid the game sees. The proctor page therefore shows **one** QR code, for
the lobby, rather than one per team.

Both parties persist to `room.storage`, tuned to what each can afford to lose:

- **The lobby writes through on every change.** Losing it costs every team its
  identity mid-event, and assignments change a handful of times per night.
- **The game room writes behind, every 5s** (`HexPersistedV1` in
  `packages/shared/src/hex/sim.ts` — the sim serializes itself; storage I/O
  stays in the room server). The sim mutates 4×/sec on its own, so per-change
  writes would be per-tick writes; a 5s cadence bounds an eviction's loss to
  5s of a 10-minute game. On rehydrate the gap is credited at the restored
  build rate, **capped at 30s** — a room left open overnight does not hand the
  next team a fortune — and elapsed time stays wall-clock (the reveal keys off
  `total`, not elapsed time, so only the proctor's timer jumps). `speed` is
  `?debug`-only and never persisted — a real room always runs at ×1.
  The one write-through exception is proctor **reset** — rehydrating the
  previous run after an eviction would silently undo it. The tick/persist
  loops run only while someone is connected: the last socket closing stops
  them (with a final save), so an empty room is evictable instead of pinning
  itself in memory — and on the Durable Object duration meter — indefinitely.

### Team chat

`/chat/` is one channel per team, and **the room id is the team id** — the same
convention the game rooms use, so the proctor sorting someone onto `t2` is also
what puts them in t2's channel. There is no team picker and no way to end up in
another team's chat.

Like the game, chat has no menu: it asks the lobby for this pid's room (the
same `roomFor` both games use, so an unsorted phone lands in the testing room's
channel), and opening chat registers the phone in the lobby roster, so it
appears on the proctor's list.

Neither of the lobby's buttons carries a team in its URL — see `?room=` above.
Both surfaces ask the lobby, so a proctor re-sort takes effect on reload instead
of stranding someone in their old team's channel.

What the chat server enforces (`server/src/chat.ts`, tunables in
`packages/shared/src/chat.ts`):

- **A bounded history.** `CHAT_HISTORY` messages per room, persisted one small
  key per message rather than as a blob. The lobby and the game room rewrite
  their whole state on every change, which is right for state that mutates in
  place; an append-only log would turn every line into a full-history write.
- **Clamped text.** Whitespace is collapsed and the result truncated to
  `CHAT_MAX_TEXT` — truncated, not rejected, so a pasted essay lands clipped
  rather than vanishing. Collapsing before the clamp is what makes the clamp
  mean anything: a screenful of newlines is one line of content.
- **A per-connection token bucket.** `CHAT_BURST` messages land instantly, then
  one per `CHAT_REFILL_MS`. Over the limit, messages are dropped silently.
- **No ticker.** Chat is entirely event-driven, so unlike the game room this DO
  does nothing at all between messages.

**Where the messages actually live.** In the chat Durable Object's own
`ctx.storage`, on the Worker — one DO per team (`t1`…`t4`, roomed by team id),
one key per message: `m:` plus the zero-padded message id, so the order
`storage.list({prefix:"m:"})` returns is chronological and `onStart` can
rehydrate by listing the prefix. `this.history` is a memory mirror of exactly
that, capped and trimmed in the same step that appends. Nothing is stored on
Vercel, nothing in `localStorage` — a phone re-reads the room's history on every
connect. Storage survives Worker redeploys and DO eviction; it does not survive
renaming the Worker or the DO class (see "Deploy order").

**The proctor reads every channel.** Chat is a line from a team to the proctor
as much as between teammates, so the dashboard shows every log below the board
(`apps/proctor/src/Chats.tsx`) — one column per team, plus the testing room
while it is open — live. It connects with
`?role=proctor`, which the chat server already treated as a spectator: a `say`
from that connection is refused, and the Roster never counts it, so watching a
channel doesn't change the "n here" line the team sees. The logs sit BELOW the
board rather than inside the team boxes because a box is a fixed-height drop
target — see the box-height rule above.

**Clear all chats** wipes every channel, for use between groups. It is
per-room on the wire (`{type:"clear"}`, proctor only — a Durable Object can
only clear its own storage), and "global" is the proctor page fanning that one
message out over the four sockets it already holds. The server deletes the
`m:` keys by prefix, in chunks of 128 (`storage.delete` takes no more at once,
and `CHAT_HISTORY` is larger), then broadcasts an ordinary `chat` snapshot with
an empty list — the same message a fresh connection gets, which every client
already replaces its history on, so the wipe needed no new client case.

Two client-side notes that are easy to undo by accident:

- Message bodies are set with `textContent`, never `innerHTML` (in the proctor's
  React log, by rendering the string as a child). This is the one string on any
  surface in the repo that is arbitrary player-authored text.
- A line typed before the socket opens (or during a wifi drop) is **queued**,
  not dropped — the composer is on screen a moment before partysocket has
  connected. The hex client queues taps for exactly the same reason.

### The origin constraint

Player identity is a `pid` in `localStorage`, and **`localStorage` is
per-origin**. The lobby's assignment only follows a player into a game if the
game is served from the same origin as the lobby. On `cat-games-tau.vercel.app`
it is. On `hexxygon.com` it is not — that origin has its own empty store, so the
client mints a fresh pid and the server sees a stranger.

Nothing server-side can bridge that: cookies are domain-scoped, every phone on
venue wifi shares one NAT address, and fingerprinting is neither reliable nor
welcome. There were two ways to live with it, and **this repo now depends
entirely on the first**:

- **Serve the games from the lobby's origin** — what the vanity domains do
  today, by redirecting (307) to `cat-games-tau.vercel.app` instead of
  rewriting to it. One origin, one pid, assignments follow players everywhere.
- **Carry the team in the link** (`<game>/?room=t2`), so the assignment rides
  in the URL and the origin stops mattering. This is gone: see `?room=` above
  for why. A player who types a vanity domain from scratch still lands on the
  shared origin and is asked to wait for sorting, which is the intended
  behaviour rather than a gap.

Because the fallback is gone, **turning a vanity domain back into a rewrite
would break joining outright** — that origin would have its own empty
`localStorage`, so every phone on it would mint a fresh pid, appear on the
proctor's board as a stranger, and never inherit its team. Note that
`check:routing` would NOT catch it: it asserts which app each vanity root lands
on, and a rewrite lands on the same app as a redirect. The redirect is only
load-bearing for identity, which nothing automated currently checks.
