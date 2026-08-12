# Escape Cats 🐾

A cooperative 4-player mini game for a puzzle escape room, starring Hex.
Players are sorted onto a team in the lobby, play together for ~10 minutes,
and unlock a code word to give the proctor.

- **Hex Clicker** — a cooperative cookie-clicker. One shared mouse pool,
  shared buildings and upgrades. Petting Hex mints mice; buying the twist
  puts her to sleep, and the night wall's drifting dream-mice gradually ink
  the code word — identically on every phone.

## Layout

```
apps/hex-clicker/    Player client: vanilla JS/TS, the prototype's rendering split
                     into modules (see its src/README.md for the map)
apps/lobby/          Landing page: name entry, then the team the proctor put
                     you on, with a link into the game
apps/chat/           Per-team chat: one channel per team, roomed by team id
apps/proctor/        Hidden proctor dashboard, one flat page: team assignment,
                     live overview of all four rooms, QR codes, reset
packages/shared/     Wire protocol, seeded RNG, and the WHOLE hex
                     game: balance tables (hex/data.ts), pure rules (hex/rules.ts)
                     and the authoritative simulation (hex/sim.ts)
server/              Cloudflare Worker: the game room, team lobby and team chat,
                     as three Durable Objects (partyserver, NOT the PartyKit
                     platform)
hex/                 The original single-player prototype — FROZEN as reference
```

## Where things live (so a retune touches one file)

- **Balance** — buildings, upgrades, costs, click math, wall ramp:
  `packages/shared/src/hex/data.ts` (+ `rules.ts` for derived rules). The
  server, the phones, and the client's `?debug` mode all import it,
  so there is exactly one copy to edit.
- **Game logic** — what a pet/purchase/golden-catch does: `packages/shared/src/hex/sim.ts`
  (the room server is a thin websocket wrapper around it).
- **Art & rendering** — client-only, one module per system:
  `apps/hex-clicker/src/{wall,cat,art,fx,shop}.js`.
- **The prototype** (`hex/index.html`) is frozen. It was the tuning bench;
  that job moved to the multiplayer client's `?debug&speed=N` mode, which runs
  the same shared sim in-page. Don't retune the prototype — it no longer
  feeds anything.

## Architecture decisions (agreed up front)

1. **Monorepo** — the hard part (join/presence/reset/reveal plumbing) is
   shared; the games are apps on top of it.
2. **Mobile web, no install** — QR scan → URL → playing in seconds.
   Hex Clicker is portrait.
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
| Hex Clicker   | http://localhost:5173/?room=TEST           |
| Proctor       | http://localhost:5175                      |
| Team lobby    | http://localhost:5176                      |
| Team chat     | http://localhost:5177                      |

Open the proctor page and scan a team tile's QR code with phones on
the same wifi (the vite servers listen on the LAN; point
`VITE_PARTYKIT_HOST` at your machine's LAN IP for phone testing — see
`.env` handling below).

Simulate 4 players locally with 4 browser tabs — but note the persistent
player id is per-browser-profile, so use different profiles/incognito
windows to appear as different players.

For balance work on Hex, **`?debug`** runs the shared sim in the page with no
server at all, and `?speed=N` fast-forwards it — so
`localhost:5173/?debug&speed=20` walks a whole run in about 20 seconds. It is
the only mode besides the real game, and the only fast-forward — a real room
always runs at ×1. (`?solo` was the interim name and still works.)

`?debug` also mounts a floating **🛠 panel** — grant buttons, story-beat jumps
(`day` → `legible`, see `packages/shared/src/hex/presets.ts`), time scale and
reset. This is the old prototype panel ported onto the SHIPPED economy: presets
drive the real `HexSim`, so what you tune here is what players get. The panel's
controls call the sim directly and exist only in this mode — nothing
debug-related is in the wire protocol, so there is no path to a real room.
`window.__hexSim` exposes the sim itself (the mirror in `__hex.game` drops
server-private fields like `legibleAt`); use it for console-driven tuning.

Modes are **query params, never paths**. `?debug` modifies the same page rather
than naming a different one, params compose (`?debug&speed=20`) where path
segments don't, and a path would need a rewrite per mode on a static host —
`/hexxygon/debug` is a 404 unless routing is taught about it. `?room=` already
works this way, so the whole surface stays consistent.

`window.__hex` exposes the state mirror and a `send()` for driving the game
from a console or a test — always on, in any mode.

## Configuration

Client env vars (Vite, set in `apps/*/.env.local`):

- `VITE_PARTYKIT_HOST` — host:port of the room server (default `127.0.0.1:1999`).
  Kept under its old name: it is what `partysocket` reads on every client.
- `VITE_HEX_URL` — public game URL the proctor QR code points at

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
(`/solo-hex/`, `/prototypes/`, and `?debug`) need no server, and the coop
client builds and deploys fine with a stub `VITE_PARTYKIT_HOST` — it renders
its join screen and only fails at the point of joining a room.

```sh
npm run cf:login        # once, per machine — opens a browser
npm run deploy:server   # wrangler deploy
```

Both from the repo root. Wrangler is a dependency of the `server` workspace, not
of the root, so a bare `npx wrangler login` at the top level fails with "not
recognized" — these scripts route it through the workspace for you.

Three Durable Objects behind one Worker: the `Main` binding is the game room,
`Lobby` is the team lobby and `Chat` is per-team chat, and
`routePartykitRequest` maps them onto the `/parties/:party/:room` URLs the
clients already speak. There are no deploy vars to set.

Adding a DO class needs its own **new** migration tag in `wrangler.jsonc` —
migrations are append-only and each tag runs once, so a new class is never an
edit to an existing tag. Deploy the Worker BEFORE the Vercel build that depends
on it: wrangler has no git integration here, so a client that speaks a protocol
the live Worker doesn't know will simply be ignored (see the note in "Next
steps").

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
| `/g00mBa/` | `prototypes/goomba-rider.html` | Goomba Rider |
| `/chat/` | `apps/chat` | Per-team chat |
| `/proctor/` | `apps/proctor` | Proctor dashboard |
| `/solo-hex/` | `hex/` | Frozen hex prototype + QR Studio (path predates the solo→debug rename) |
| `/prototypes/` | `prototypes/` | Prototypes menu + Goomba Rider |

Env vars (all in this one project — `VITE_PARTYKIT_HOST` is set once here, so
every surface points at one server):

```
VITE_PARTYKIT_HOST=escape-cats.escape-cats.workers.dev
VITE_HEX_URL=https://hexxygon.com
```

**Root Directory must be blank.** `vercel.json` overrides the dashboard's
framework, build command and output directory, but it cannot set the root
directory — it is read *from* it. A project pointed at `hex/` or `prototypes/`
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
| `g00.mba` | `/g00mBa/` | Goomba Rider |
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
— `/hexxygon/`, `/proctor/`, `/` for the lobby. Do not make them relative.

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
slash. That is what hand-authored HTML in `prototypes/` and `hex/` assumes: a
sibling link like `goomba-rider.html` resolves correctly from `/prototypes/`
but points at the site root from `/prototypes`. Paths carrying a file
extension are excluded from the redirect, which is why the `/qr-studio` style
rewrites are registered in both slashed and unslashed forms.

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

## Next steps (deliberately not in the scaffold)

- Per-session code words configured from the proctor dashboard.
- Deploying the Worker on push (wrangler has no git integration here, so
  `packages/shared` can ship to Vercel while the server still runs the old
  economy — see the Deploying note).

## Teams and the lobby

Four teams, `t1`–`t4`. **A team id is also the room id the game runs
in**, so once the proctor puts someone on `t2`, their game room is `t2` and
nothing else has to agree on anything.

The flow: a player opens `/`, types a name, and waits. The proctor's dashboard
lists everyone currently on that page and sorts them onto teams — per-person
buttons, or **Auto-assign** to round-robin the unsorted starting from the
smallest team. Once assigned, the player's page turns into their team name plus
a link into the game.

**The game has no menu.** `apps/hex-clicker` never shows a form: it asks the
lobby for this pid's team and slots straight in. A phone the proctor hasn't
sorted yet gets a waiting screen, not an error — opening the game page
registers the phone in the lobby roster (same pid+name contract as the landing
page), so it appears on the proctor's list and enters the game the moment it's
assigned. `?room=` still overrides for QR codes (which carry the team id);
`?debug` bypasses the server entirely. The room is deliberately NOT written
back into the URL on the lobby path, so a refresh re-asks the lobby and a
proctor re-sort takes effect on reload.

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

Like the game, chat has no menu: it asks the lobby for this pid's team and slots
in. An unsorted phone gets the same waiting room the game gives, and opening
chat registers the phone in the lobby roster, so it appears on the proctor's
list. `?room=` overrides for QR codes and rehearsals.

The lobby's **Team chat** button deliberately does NOT carry `?room=`, unlike its
link into the game. The game may be served from a vanity domain where this
phone's pid doesn't exist, so its team has to ride in the URL; chat is on the
lobby's own origin and can just ask. That also means a proctor re-sort takes
effect on reload instead of stranding someone in their old team's channel.

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

Two client-side notes that are easy to undo by accident:

- Message bodies are set with `textContent`, never `innerHTML`. This is the one
  string on any surface in the repo that is arbitrary player-authored text.
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
welcome. The two ways to live with it:

- **Serve the games from the lobby's origin.** Make the vanity domains redirect
  to `cat-games-tau.vercel.app/hex/` instead of rewriting to it. One origin, one
  pid, assignments follow players everywhere.
- **Carry the team in the link.** What the lobby does today — its buttons point
  at `<game>/?room=t2`, so the assignment rides in the URL and the origin stops
  mattering. A player who types a vanity domain from scratch still arrives
  unsorted.
