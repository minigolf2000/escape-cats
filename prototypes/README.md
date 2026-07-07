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
