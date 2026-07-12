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

One non-game tool lives here too:

| File | Tool | What it does |
| --- | --- | --- |
| `qr-art-studio.html` | **QR Art Studio** | Design-QR workbench in the Japanese poster style — paint a three-tone target (black / white / free noise), a GF(2) solver pins pixels via free padding + URL-case bits, an error-correction flip budget buys the stragglers, then hand-edit modules with a live per-block "will it still scan" meter. Ships with the Hex silhouette preset; `cat-qr.png`/`.svg` are its output. Technique notes in [`qr-art-notes.md`](./qr-art-notes.md). |

## Playtesting

These are previewed via Claude Code artifact links during development
(published straight from the working session — no deploy pipeline needed).
They also run fine by opening the file in any browser, or:

```sh
npx serve prototypes
```

Note: the HTML files intentionally omit `<!doctype>`/`<html>`/`<head>`/`<body>`
wrapper tags because the artifact host injects its own document skeleton.
Browsers render them fine standalone regardless.
