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
| `salad-cat.html` | **Salad Cat** | Slingshot *the cat*: after landing he auto-runs right and climbs walls until something stops him. Eat every plant in 5 handcrafted levels. Twists: cucumbers end the run, catnip zoomies smash them, cushions bounce, boxes teleport. |
| `hex-clicker-neon.html` | **Hex Clicker — Neon Lab** | Playable single-player skin of the coop clicker in the committed neon line-art theme. Currency is **neon mice**; mice climb onto the wall automatically on lifetime-mice milestones, Comet Trail upgrades ink the reveal, claw/whisker upgrades keep petting relevant, and a golden mouse (one slot per player seat) triggers escalating team Zoomies. No in-game end state — the word is read off the wall and given to a proctor in person. Locked vs open decisions live in [`hex-clicker-design.md`](./hex-clicker-design.md). |

One multi-phone concept rig lives here too — it breaks the "single-player,
mobile-only" rule on purpose, because the whole point is several phones at once:

| File | Game | Mechanic |
| --- | --- | --- |
| `laser-relay.html` | **Laser Relay** | Multi-phone laser puzzle, played on a **desktop playtest rig**: each tile is one phone, drag to move and click to rotate. Route a beam from source to target(s) by arranging and turning phone-tiles (corners bend, straights carry, splitters fork, mirrors reflect). The beam crosses wherever two phones sit edge-to-edge — the sim's stand-in for the real "hand off the beam to your neighbour" gesture. Ships with 6 hand-authored puzzles from a 2-phone tutorial to a two-colour packing puzzle; **Peek solution** reveals a valid layout. The pure beam sim + puzzle set is validated by `scratchpad`-style node/headless tests during development (all solutions win, no overlaps). Design rationale in the chat that produced it; the "why no proximity API" thinking lives in the multi-phone design discussion. |

One non-game tool lives here too:

| File | Tool | What it does |
| --- | --- | --- |
| `qr-art-studio.html` | **QR Art Studio** | Design-QR workbench in the Japanese poster style — paint a three-tone target (black / white / free noise), a GF(2) solver pins pixels via free padding + URL-case bits, an error-correction flip budget buys the stragglers, then hand-edit modules with a live per-block "will it still scan" meter. Ships with cat art presets (Hex silhouette + poster face, ink cat, tabby) and solid-shape / line-art cleanup modes for uploads; `cat-qr.*`, `hex-poster.*` and `ink-cat-qr.png` are its output. Technique notes in [`qr-art-notes.md`](./qr-art-notes.md). |

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
