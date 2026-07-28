# Prototypes 🧪

Single-player, mobile-only (portrait, touch) game prototypes, deliberately
outside the multiplayer architecture: each is a single self-contained HTML
file with zero dependencies, zero build step, and no server. The goal is to
find the fun fast; anything that graduates gets rebuilt properly as an app
in the monorepo.

| File | Game | Mechanic |
| --- | --- | --- |
| `stack-cats.html` | **Stack Cats** | Tap-timing tower stacker — cats swing overhead, tap to drop them on the pile; overhang gets trimmed, perfect drops combo. |
| `yarn-flick.html` | **Yarn Flick** | Drag-and-release slingshot — fling Goomba's yarn ball to bonk mice off shelves across 3 levels. |
| `laser-dash.html` | **Laser Dash** | One-thumb endless runner — Hex chases the red dot down a neon street; tap to jump, tap again to double-jump, catch the laser dot for a frenzy. |
| `goomba-rider.html` | **Goomba Rider** | Line-rider clone where the track is **silly bandz**: Goomba autoboards downhill; two fingers (or a drag) stretch one band of elastic track, one finger pans, up to **4 bands** per level (the team budget: 4 players × 1 band; 3-player teams have someone place two). 5 portrait-leaning vertical levels, each verified unsolvable bare and solvable with bands (headless sim via the `window.__gr.simulate` dev hook), plus two elevation mechanics: **bouncy cushions** (restitution > 1 springs) and **party poppers** (fixed boosters that re-launch her along their aim and erase accumulated slop). Band ends snap onto terrain lips; bands sag, jiggle, and bounce. ⚙ dev panel with live edit/run zoom sliders for feel-tuning, plus an **SVG level importer**: draw a level in Figma on a 390×844 frame with a small naming convention, export SVG, and drag the file onto the game to playtest it instantly ([design guide](./goomba-rider-levels.md)). Levels are shaped ~portrait-phone so fit-to-screen is the right zoom by construction. Party skin: string lights, confetti, birthday-cake goal. Multiplayer plan: everyone holds their band in place, someone hits PLAY, server runs the same deterministic sim. |
| `salad-cat.html` | **Salad Cat** | Slingshot *the cat*: after landing he auto-runs right and climbs walls until something stops him. Eat every plant in 5 handcrafted levels. Twists: cucumbers end the run, catnip zoomies smash them, cushions bounce, boxes teleport. |
| [`../hex/index.html`](../hex/index.html) | **Hex Clicker** | Classic Cookie-Clicker clone in the neon skin. Pet Hex to collect **neon mice**; buy buildings that auto-generate them (Robo-Cat → Amazon Shopper → Neon Mouse Farm → Mouse Quarry → Mouse Factory → Schrödinger Lab). Geometric x1.15 cost curve, per-building mps, golden-mouse Zoomies bonus (catch it, pet power ×6 for 7s), one-off upgrades, localStorage autosave. **The twist:** the Catnap Study upgrade puts Hex to sleep and flips a night phase — the reveal wall (ported from [`reveal-lab.html`](../hex/reveal-lab.html)) inks TO THE MOON behind her as wall mice accumulate on lifetime earnings and Comet Trails upgrades grow their ink; night buildings dwarf day production. Single-player v1; multiplayer/eras still deliberately absent. **Graduated to its own deploy root at [`../hex/`](../hex/)** so it can be hosted at the root of a domain — no longer part of this folder's deploy. |
| `hex-clicker-neon.html` | **Hex Clicker — Neon Lab** | Playable single-player skin of the coop clicker in the committed neon line-art theme. Currency is **neon mice**; mice climb onto the wall automatically on lifetime-mice milestones, Comet Trail upgrades ink the reveal, claw/whisker upgrades keep petting relevant, and a golden mouse (one slot per player seat) triggers escalating team Zoomies. No in-game end state — the word is read off the wall and given to a proctor in person. Locked vs open decisions live in [`hex-clicker-design.md`](./hex-clicker-design.md). |

One non-game tool lives here too:

| File | Tool | What it does |
| --- | --- | --- |
| [`../hex/qr-studio.html`](../hex/qr-studio.html) | **QR Studio** | Live QR pixel painter — paint black/white/noise directly on a working code; a GF(2) solver honors your pixels in paint order (~4ms/solve), an error-correction budget absorbs stragglers, and a background pass retries every EC level × mask to keep more of your paint legal. Over-budget pixels are annotated, never blocked; the code always scans. Hover fades noise to read your art; **Randomize** samples a fresh noise field (2^k equivalent states) with the art untouched; drawings save into the URL hash. Cat presets, image import, and `cat-qr.*` / `hex-poster.*` outputs. Notes in [`../hex/qr-art-notes.md`](../hex/qr-art-notes.md). **Moved to [`../hex/`](../hex/)** to be hosted alongside the game — no longer part of this folder's deploy. |

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
