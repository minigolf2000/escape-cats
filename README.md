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
apps/proctor/        Hidden proctor dashboard: team assignment, QR codes, live
                     progress, reset, rehearsal fast-forward
packages/shared/     Wire protocol, seeded RNG, and the WHOLE hex
                     game: balance tables (hex/data.ts), pure rules (hex/rules.ts)
                     and the authoritative simulation (hex/sim.ts)
server/              PartyKit server: the game room and the team lobby
hex/                 The original single-player prototype — FROZEN as reference
```

## Where things live (so a retune touches one file)

- **Balance** — buildings, upgrades, costs, click math, wall ramp:
  `packages/shared/src/hex/data.ts` (+ `rules.ts` for derived rules). The
  server, the phones, and the client's `?debug` practice mode all import it,
  so there is exactly one copy to edit.
- **Game logic** — what a pet/purchase/golden-catch does: `packages/shared/src/hex/sim.ts`
  (the PartyKit server is a thin websocket wrapper around it).
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
3. **Server-authoritative rooms** (PartyKit / Cloudflare). Clients send
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
| PartyKit dev  | 127.0.0.1:1999                             |
| Hex Clicker   | http://localhost:5173/?room=TEST           |
| Proctor       | http://localhost:5175                      |

Open the proctor page, start a session, and scan the QR codes with phones on
the same wifi (the vite servers listen on the LAN; point
`VITE_PARTYKIT_HOST` at your machine's LAN IP for phone testing — see
`.env` handling below).

Simulate 4 players locally with 4 browser tabs — but note the persistent
player id is per-browser-profile, so use different profiles/incognito
windows to appear as different players.

For balance work on Hex, **`?debug`** runs the shared sim in the page with no
server at all, and `?speed=N` fast-forwards it — so
`localhost:5173/?debug&speed=20` walks a whole run in about 20 seconds. This is
the multiplayer heir to the frozen prototype's `?debug` panel, and carries the
same name; the proctor's ×1/×5/×20 buttons do the same thing to a real room.
(`?solo` was the interim name and still works.)

Modes are **query params, never paths**. `?debug` modifies the same page rather
than naming a different one, params compose (`?debug&speed=20`) where path
segments don't, and a path would need a rewrite per mode on a static host —
`/hexxygon/debug` is a 404 unless routing is taught about it. `?room=` already
works this way, so the whole surface stays consistent.

`window.__hex` exposes the state mirror and a `send()` for driving the game
from a console or a test — always on, in any mode.

## Configuration

Client env vars (Vite, set in `apps/*/.env.local`):

- `VITE_PARTYKIT_HOST` — host:port of the PartyKit server (default `127.0.0.1:1999`)
- `VITE_HEX_URL` — public game URL the proctor QR code points at

The server takes no vars. The code word is a constant
(`HEX_CODEWORD` in `packages/shared/src/hex/data.ts`, paired with the wall
art), and the proctor identifies itself with `?role=proctor` — a claim, not a
credential. Anyone who opens `/proctor` can run a session; that is accepted,
not overlooked. Nothing here defends against a determined player, and the
only powers on offer are reset and speed on a room you are already in.

## Deploying

Two deploys total: **one PartyKit worker** and **one Vercel project** (every
static surface). Vanity domains are routed inside
`vercel.json`, not by splitting into more projects — so adding a domain or
repointing one is a repo change, not dashboard clicking.

### 1. PartyKit

Can be done last if you just want the site up: the single-player surfaces
(`/solo-hex/`, `/prototypes/`, and `?debug`) need no server, and the coop
client builds and deploys fine with a stub `VITE_PARTYKIT_HOST` — it renders
its join screen and only fails at the point of joining a room.

```sh
npm run deploy -w server   # partykit deploy
```

One worker serves both parties: `partykit.json` maps `main` → Hex Clicker and
the `lobby` party → the team lobby. There are no deploy vars to set. Note the
resulting hostname — every client build needs it.

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
| `/proctor/` | `apps/proctor` | Proctor dashboard |
| `/solo-hex/` | `hex/` | Hex Clicker (solo) + QR Studio |
| `/prototypes/` | `prototypes/` | Prototypes menu + Goomba Rider |

Env vars (all in this one project — `VITE_PARTYKIT_HOST` is set once here, so
every surface points at one server):

```
VITE_PARTYKIT_HOST=escape-cats.<user>.partykit.dev
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

The two vanity domains **redirect** (307) into this origin rather than
rewriting to it:

| Domain | Redirects to | Serves |
| --- | --- | --- |
| `hexxygon.com` | `/hexxygon/` | Hex Clicker coop |
| `g00.mba` | `/g00mBa/` | Goomba Rider |

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

- **Room state is not persisted.** The hex sim lives in the Durable Object's
  memory, so an eviction or a redeploy mid-session resets a team to zero. It
  wants a throttled write to `room.storage` plus a rehydrate in `onStart` that
  credits elapsed time (capped, or a room left open overnight hands the next
  team a fortune). This is the one gap that can spoil a live session.
- Per-session code words configured from the proctor dashboard.
- Deploying the PartyKit worker on push (there is no git integration, so
  `packages/shared` can ship to Vercel while the server still runs the old
  economy — see the Deploying note).

## Teams and the lobby

Four teams, `t1`–`t4`. **A team id is also the PartyKit room id the game runs
in**, so once the proctor puts someone on `t2`, their game room is `t2` and
nothing else has to agree on anything.

The flow: a player opens `/`, types a name, and waits. The proctor's dashboard
lists everyone currently on that page and sorts them onto teams — per-person
buttons, or **Auto-assign** to round-robin the unsorted starting from the
smallest team. Once assigned, the player's page turns into their team name plus
a link into the game.

The lobby is the only state written to `room.storage`. A game room losing its
memory costs one team its progress; the lobby losing its memory costs every team
its identity mid-event, with no way to rebuild it except asking forty people who
they are. Assignments change a handful of times per event, so it writes through
on every change.

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
