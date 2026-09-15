# goomba-glider client — module map

Single player, no server. The shared `GoombaSim` runs in the tab, behind the
same intent/snapshot seam the room server used to sit behind: everything the
player does is an intent, everything the game knows arrives as a snapshot.
Game RULES live in `packages/shared/src/goomba/` (levels/physics/sim/codec) —
never here.

**Nothing calls a sim method directly.** The phase-edge handling in
`onSnapshot` is the spine of this app; a shortcut past `transport` is how it
comes apart.

| file | owns |
| --- | --- |
| `main.js` | boot, the frame loop, and the snapshot→UI wiring |
| `state.js` | the snapshot mirror (`S`) + the local presentation hanging off it |
| `transport.ts` | the seam: intents out, nothing else. Was `net.ts` and a socket |
| `backend.js` | the sim, answering those intents, saving to localStorage |
| `library.js` | the three level layers, and progress that survives them changing |
| `debug.js` | `?debug` — open the levels grid without having earned it |
| `render.js` | the drawing surface, everything drawn on it, and the finale's picture |
| `selector.js` | the levels grid, which on a laptop is the level editor |
| `input.js` | three ways to lay a band, one way to take it back |
| `sheet.js` | the how-to-play pictures |
| `pixelprobe.js` | `?pixels` — the resolution probe, for "it looks blurry on my phone" |
| `dom.js` | every element ref |
| `figma/` | reading a Figma frame off the clipboard (`paste`, `clipboard`, `shapes`, `stitch`) |

## The three layers

`GOOMBA_LEVELS` is composed at boot from, in order:

1. **shipped** — `packages/shared/src/goomba/levels.data.ts`. Source. It cannot
   be deleted, reordered or pasted over from inside the game; the way to change
   it is a commit.
2. **your overlay** — localStorage. Ctrl+V lands here, ⌫ and drag act here, and
   nobody else can see it. Laptop only (`editorOn`). `export` in the grid copies
   it as `levels.data.ts` rows — that is the whole publishing pipeline.
3. **`#hash`** — one level from the URL, read ONCE at boot (a fragment change is
   a same-document navigation and deliberately does nothing). Scratch: no id,
   never remembered. `node tools/goomba/draft.mjs link` prints these.

## Progress

Keyed by a level's **id**, never its index — `goomba/library.ts`. Reorder the
list, rename a level, or retune its geometry and re-paste it, and a cleared
level stays cleared; change the **id** and it reads as new and un-clears. The
room keyed `completed` by index (`GoombaSim.reconcile` still does, and still
should — it fits a list that moved), so the id projection is written *before*
reconcile runs. `tools/goomba/test-library.mjs` is that rule, case by case.

**Debug**: `window.__goomba` exposes the mirror + `send()`. `?debug` or `\`
opens the levels grid without clearing the game first; its editing controls are
the SURFACE's business, not the key's (`editorOn`).
