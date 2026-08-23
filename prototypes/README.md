# Prototypes 🧪

Single-player, mobile-only (portrait, touch) game prototypes, deliberately
outside the multiplayer architecture: each is a single self-contained HTML
file with zero dependencies, zero build step, and no server. The goal is to
find the fun fast; anything that graduates gets rebuilt properly as an app
in the monorepo.

| File | Game | Mechanic |
| --- | --- | --- |
| `hex-clicker-neon.html` | **Hex Clicker — Neon Lab** | Playable single-player skin of the coop clicker in the committed neon line-art theme. Currency is **neon mice**; mice climb onto the wall automatically on lifetime-mice milestones, Comet Trail upgrades ink the reveal, claw/whisker upgrades keep petting relevant, and a golden mouse (one slot per player seat) triggers escalating team Zoomies. No in-game end state — the word is read off the wall and given to a proctor in person. Locked vs open decisions live in [`hex-clicker-design.md`](./hex-clicker-design.md). |

**Graduated:** **Goomba Glider** (once `goomba-rider.html`, a single-file
line-rider where the track is silly bandz) was rebuilt as the coop app in
[`../apps/goomba-glider/`](../apps/goomba-glider/) on the shared sim in
[`../packages/shared/src/goomba/`](../packages/shared/src/goomba/), and the
prototype was deleted — one copy of the physics, one copy of the levels.
Its level-design bench (QA tools + design guide + physics cheat sheet, plus
the SVG-import Figma kit it retired) lives on in
[`../tools/goomba/`](../tools/goomba/); the Figma kit is recoverable from git
history if drawing levels ever beats coding them again.

Also graduated: the original **Hex Clicker** prototype (once `hex/index.html`,
one 5,400-line file) had a row here until it was rebuilt as the coop app. Its
balance now lives in [`../packages/shared/src/hex/`](../packages/shared/src/hex/)
and its client in [`../apps/hex-clicker/`](../apps/hex-clicker/), where `?debug`
runs that same shared sim in-page with no server — which is what finally made
the prototype redundant, so it was deleted. Two of its design docs stayed
behind: [`hex-clicker-design.md`](./hex-clicker-design.md) (locked vs open
decisions) and [`hex-clicker-synergy-brief.md`](./hex-clicker-synergy-brief.md)
(historical). The standalone tools it was hosting alongside — QR Studio and the
reveal lab — moved to [`../tools/`](../tools/), which has its own README.

**Retired:** Stack Cats, Yarn Flick, Laser Dash and Salad Cat were cut — each
was a one-commit experiment that answered its question and was never returned
to. `lineart-sketches.html` went with them: the theme it studied is committed
and shipping, and of its three panels only TO THE MOON survived into the game.
All are recoverable from git history if a mechanic or a panel is worth
revisiting.

## Playtesting

These are previewed via Claude Code artifact links during development
(published straight from the working session — no deploy pipeline needed).
They also run fine by opening the file in any browser, or:

```sh
npx serve prototypes
```

Note: each game file starts with `<!doctype html>` (so it renders in
standards mode when self-hosted on a static host, rather than quirks mode)
but still omits the `<html>`/`<head>`/`<body>` wrapper tags, since the
artifact host injects its own document skeleton. Browsers render them fine
standalone either way. (`index.html` is a full document — it's the deployed
landing menu, not a prototype.)

## Deploying

This folder deploys as a static site with no build step. On Vercel: import
the repo, set **Root Directory** to `prototypes` and **Framework Preset** to
**Other**. `index.html` is the landing menu; `vercel.json` sets
`X-Robots-Tag: noindex` on every path so the site stays out of search
results (it's unlisted, not password-protected — obscurity of the URL is the
only gate for now).
