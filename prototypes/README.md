# Prototypes 🧪

Single-player, mobile-only (portrait, touch) game prototypes, deliberately
outside the multiplayer architecture: each is a single self-contained HTML
file with zero dependencies, zero build step, and no server. The goal is to
find the fun fast; anything that graduates gets rebuilt properly as an app
in the monorepo.

| File | Game | Mechanic |
| --- | --- | --- |
| `goomba-rider.html` | **Goomba Rider** | Line-rider clone where the track is **silly bandz**, themed as a bouncy **fun house** rather than a ski hill. Goomba autoboards under gravity; two fingers (or a drag) stretch one band of elastic track, one finger pans, up to **4 bands** per level (the team budget: 4 players × 1 band; 3-player teams have someone place two). 6 portrait levels in party-night order, each verified unsolvable bare and solvable with its bands. Five mechanics: bands (bouncy, sagging), **snake plants** (collectibles that lock the cake — they make winning a *routing* problem, which is what forces multiple bands), **bouncy cushions** (restitution > 1), **party poppers** (redirect: set direction but preserve arrival speed, so upstream bands still matter) and **piñata bumpers** (radial kick that adds energy). Band ends snap onto terrain lips. ⚙ dev panel with live edit/run zoom sliders, a 🔬 **level lab** (every level as a card with live sim verdicts — tap to play, ★ to shortlist), headless level-QA tooling in [`tools/`](./tools/) (a min-bands prober that caught a shipped "3-band" level with 380 one-band solutions; a beam-search auto-solver; **ride cards** that render a level with Goomba's actual traced trajectory for design review), plus an **SVG level importer**: draw a level in Figma on a 390×844 frame with a small naming convention, export SVG, and drag the file onto the game to playtest it instantly ([design guide + physics cheat sheet](./goomba-rider-levels.md)) — with a **Figma starter kit** to drag in: [`goomba-rider-template.svg`](./goomba-rider-template.svg) (the 390×844 frame, rulers, and a verified minimal level) and [`goomba-rider-stencils.svg`](./goomba-rider-stencils.svg) (every importable element, to scale, ready to make components from). Party skin: string lights, confetti, birthday-cake goal. Multiplayer plan: everyone holds their band in place, someone hits PLAY, server runs the same deterministic sim. |
| `scent-tracker.html` | **Scent Tracker** | **WebAR on 8th Wall’s own SLAM — iPhone and Android both work** (WebXR was implemented first and tracked better, but it does not exist on iOS and 75% of the players are on iPhones, so it was cut; git history has it). The phone is a lens: a band of glowing motes lies on your real floor and drifts toward a hidden place. Two milestones in one file: **M0 drift rig** — a measuring instrument, not a game; drop an anchor on a piece of tape, walk your route, re-aim at the same tape, and it reports how far the virtual world slid (median slip, % of distance walked, verdict) — **run this first**, it decides whether the game holds together in a given room; and **M1 scent trail** — walk the route tapping breadcrumbs, then follow it back as motes. Three tricks do the localization work instead of fighting drift: **discrete motes** rather than a ribbon (a hard edge makes error legible), a **reveal window** showing only ~1m behind to ~3m ahead (you cannot see global drift if the global path is never drawn), and a **diegetic tracking-loss state** ("the scent is faint — look around slowly") instead of drawing a world we’ve stopped believing in. Goal is a 75cm radius *place*, not a point. Heat drives colour, mote density, and a haptic heartbeat. **Image targets** (built offline with `npx @8thwall/image-target-cli`) re-express the route in *target space*, so re-sighting a marker snaps the world back and reports the correction in cm — that change of frame, not the storage, is what makes a route survive reload and mean the same thing on a second phone. Deliberately breaks this folder’s zero-dependency rule (three.js + the 8th Wall engine from a CDN, still no build step); `__scent.CFG` is live-tunable over devtools. A no-AR **preview** mode flies a demo route so the look can be tuned on a desktop. Feasibility study, platform constraints, and the full spec in [`scent-tracker-design.md`](./scent-tracker-design.md). |
| `hex-clicker-neon.html` | **Hex Clicker — Neon Lab** | Playable single-player skin of the coop clicker in the committed neon line-art theme. Currency is **neon mice**; mice climb onto the wall automatically on lifetime-mice milestones, Comet Trail upgrades ink the reveal, claw/whisker upgrades keep petting relevant, and a golden mouse (one slot per player seat) triggers escalating team Zoomies. No in-game end state — the word is read off the wall and given to a proctor in person. Locked vs open decisions live in [`hex-clicker-design.md`](./hex-clicker-design.md). |

**Graduated:** the original **Hex Clicker** prototype (once `hex/index.html`,
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
