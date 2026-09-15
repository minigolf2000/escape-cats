# Escape Cats 🐾

Two single-player mini games starring Hex and Goomba. Open a link and play —
there is no server, no room and nothing to join. Each game is its own site.

- **Hex Clicker** — a cookie-clicker. Petting Hex mints mice; buying the twist
  puts her to sleep, and the night wall's drifting dream-mice gradually ink the
  code word. Reading it is the win. → **hexxygon.com**
- **Goomba Glider** — a line rider where the track is silly bandz. Four elastic
  bands a level; hit PLAY and watch the deterministic ride: collect every
  watering can, then land on the plant. → **g00.mba**

Both keep their progress in that site's `localStorage`. Nothing leaves the
browser.

> These were four-player co-op games for a physical escape room, run from a
> proctor's dashboard over a Cloudflare Worker. That hunt is over. The rooms,
> the lobby, the team chat, the dashboard and the Worker are gone; what is left
> is the two games, which were always the good part.

## Layout

```
apps/hex-clicker/    Player client — see its src/README.md
apps/goomba-glider/  Player client — see its src/README.md
packages/shared/     Seeded RNG and BOTH whole games:
                     hex/{data,rules,sim}, goomba/{levels,physics,sim,codec,library}
tools/goomba/        DESIGNING.md, the Figma bridge (figma/), the level list checks
tools/               qr-studio.html and reveal-lab.html, two standalone pages
scripts/             assemble.mjs + check-routing/cursors/visibility
```

## Where things live

- **Hex balance** — buildings, upgrades, costs, click math, wall ramp:
  `packages/shared/src/hex/data.ts` (+ `rules.ts` for derived rules). Game
  logic: `hex/sim.ts`.
- **Goomba physics and level types** — `goomba/physics.ts`, `goomba/levels.ts`
  (the type and `initLevel`); the state machine is `goomba/sim.ts`; the save
  format is `goomba/codec.ts`. **The levels the game ships are
  `goomba/levels.data.ts`**, one `{ id, name, hash }` row each; a level's source
  is still its Figma frame, and a row is what a frame becomes when it ships.
  Start at [`tools/goomba/DESIGNING.md`](./tools/goomba/DESIGNING.md).
- **Art & rendering** — client-only, one module per system. Hex:
  `src/{wall,cat,art,fx,shop,phase}.js`. Goomba: `src/{render,selector,sheet}.js`.
- **Each client's CSS is `src/styles.css`**, imported from its `main`.

## The shape of a client

Both are built the same way, and it is the shape a room server left behind:

```
input → transport.send(intent) → backend → sim → snapshot → onSnapshot → UI
```

`backend.js` runs the shared sim in the tab and saves to `localStorage`. The
seam stays because the UI hangs off snapshot EDGES — "the twist just fired",
"the wall just went legible", "a run just ended" are all differences between
two snapshots. **Nothing calls a sim method directly**, with one sanctioned
exception: hex's 🛠 `?debug` panel, which is a tuning bench reaching past the
game on purpose.

## Development

```sh
npm install
npm run dev
```

| What          | URL                     |
| ------------- | ----------------------- |
| Hex Clicker   | http://localhost:5173/  |
| Goomba Glider | http://localhost:5178/  |

No env vars. No server to start.

**Modes are query params, never paths**, so they compose:

- `?debug` (hex) mounts the 🛠 panel: grants, story-beat jumps
  (`hex/presets.ts`), a 🏆 win toggle, time scale, reset. `?speed=N`
  fast-forwards income and golden cadence (`?debug&speed=20` walks a run in
  ~20s). `\` opens and closes the panel.
- `?debug` or `\` (goomba) opens the levels grid without clearing the game
  first; on a laptop that grid is the level editor.
- `#<link>` (goomba) appends one level from the URL — scratch, never saved.
  `tools/goomba/draft.mjs link` prints these.
- `window.__hex` / `window.__goomba` expose each client's state mirror and a
  `send()`; `window.__hexSim` exposes hex's sim directly.

```sh
npm run typecheck                          # both workspaces
npm run build:sites                        # build + assemble both + every check
npm run test:goomba                        # codec + progress identity + the level list
cd tools/goomba && node levels.mjs         # what the game ships
cd tools/goomba && node bands.mjs          # the band rule
cd tools/goomba/figma && node test-*.mjs   # the Figma readers
```

## Two sites, two Vercel projects

One repo, two projects, each with its own domain and its own `localStorage`:

| project | build command          | output dir     | domain         |
| ------- | ---------------------- | -------------- | -------------- |
| hex     | `npm run build:hex`    | `dist/hex`     | hexxygon.com   |
| goomba  | `npm run build:goomba` | `dist/goomba`  | g00.mba        |

Both read the one `vercel.json` at the repo root (cache headers and
`trailingSlash`; no redirects, no rewrites). `hexxygon.com/reveal-lab` and
`/qr-studio` ride along on the hex site — two standalone HTML pages with no
build and no dependency on either game.

Each game's Vite `base` is `/`: **the app is the site**. It used to be one
origin with the games at `/hexxygon/` and `/g00mBa/` and the vanity domains
307-redirecting in, because five surfaces shared a player's per-origin
`localStorage`. Nothing is shared now.

A branch preview is therefore a complete, standalone game — which it could not
be before, when every deploy pointed at one live Worker and one global level
pack. Its `localStorage` is its own, so a preview always starts as a new player.
