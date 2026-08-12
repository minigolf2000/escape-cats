# hex-clicker client — module map

The prototype (`hex/index.html`, since deleted — git history only) was one
5,400-line file. It is
split here so a change lands in one small file. Rendering is plain JS ported
verbatim where possible; the typed seams are TS.

| file        | owns                                                                  |
| ----------- | --------------------------------------------------------------------- |
| `main.js`   | boot, join gate, frame loop, and the snapshot→UI-beat wiring          |
| `state.js`  | the server-state mirror, snapshot EDGES, shared clock, optimistic pets |
| `net.ts`    | PartySocket transport + pet batching (typed)                          |
| `debug.ts`  | `?debug` mode — the shared HexSim running in-page, no server (typed)  |
| `shop.js`   | dock, building rows, upgrade rail, HUD, badge/seen, sold-out beat     |
| `wall.js`   | the night reveal: tracer, glyphs, moon scene, cast, canvas drawing    |
| `cat.js`    | Hex herself — blink, gaze, ears, purr, yawn, dream twitches           |
| `golden.js` | the golden mouse (server decides WHEN; each phone decides WHERE)      |
| `pet.js`    | tap handling, streaks, night pokes                                    |
| `fx.js`     | "+N" floats and mouse-pop particles                                   |
| `phase.js`  | day/night projection, starfield, the night cutscene                   |
| `art.js`    | the one mouse silhouette + palette every renderer builds from         |
| `format.js` | `fmt` — the one number formatter (night appends "M")                  |
| `dom.js`    | every element ref                                                     |

Game RULES live in `packages/shared/src/hex/` (data/rules/sim) — never here.
The markup + CSS are in `index.html`, ported verbatim from the prototype plus
the multiplayer shell (join gate, team strip, reconnect toast) at the bottom.

Debug: `window.__hex` exposes the mirror + `send()` for console/Playwright
driving. `?debug&speed=20` fast-forwards a debug run.
