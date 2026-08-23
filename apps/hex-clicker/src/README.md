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
| `cat.js`    | Hex herself — blink, gaze, lean, purr, yawn, dream twitches, squash   |
| `golden.js` | the golden mouse (server decides WHEN; each phone decides WHERE)      |
| `pet.js`    | tap handling, streaks, night pokes                                    |
| `fx.js`     | "+N" floats and mouse-pop particles                                   |
| `phase.js`  | day/night projection, starfield, the night cutscene                   |
| `art.js`    | the one mouse silhouette + palette every renderer builds from         |
| `mouse-geom.js` | GENERATED — the mouse traced from the art file; art.js's input    |
| `format.js` | `fmt` — the one number formatter (night appends "M")                  |
| `dom.js`    | every element ref                                                     |

Art comes from the Figma file "Hexxxygon" (page Hex, node 22-3) and lands in two
shapes. Anything that has to be RECOLOURED or drawn to canvas is traced to
vector — the mouse (`mouse-geom.js`, consumed by `art.js`) and the shop icon
(inline in `index.html`) — because the mouse keeps the game's own five colours
and the night wall draws it with canvas path calls. Anything that only has to be
DISPLAYED ships as PNG in `public/art/`: the background and Hex's five head
poses. The heads are exported onto one shared 828x652 canvas registered by eye
position, with the eyes painted out, so `#hexCat` can swap them freely under a
single rigged pair of eyes.

The DAY heads in `public/art/` are not the raw export. Hex is a black cat with
white whiskers; the artist's day sheet draws her grey-brown (`#665B59`) with a
dark line (`#302B2A`). `node tools/hex/reink-day.mjs` gives it the night sheet's
two inks — coat to `#0C0B0A`, and the whole drawn line (outline, ear rims, nose
dashes, whiskers) to white — leaving the inner-ear pink alone. Run it after any
fresh day export: it reads each frame's current inks, so it converts a raw export
and a half-converted one alike, and `--check` exits 1 on a frame it has not been
run over. One consequence to know about: the two sheets are now near-identical, so
the day->night coat cross-fade in `index.html` no longer shows a change of coat.

That rigged pair is three nested transform channels, one job each, because a
blink, a glance and a dilation all happen at once and one transform can only say
one of them: `#eyeLeft/#eyeRight` are the lids (scaleY), the `.look` groups
inside them are the look (translate), `#pupilLeft/#pupilRight` inside those are
the dilation (scale). The socket itself does not move — it is the eye's outline
— and it clips the pupil, so the pupil can open right out and a glance presses
it against the rim instead of through it. (There are four `.look` groups, not
two: the sleeping lash arc drifts with the same look but is drawn wider than the
socket, so it has to sit outside the clip.)

One socket ships, and there is no longer a choice: the artist's outline filled
edge to edge, with the pupil inked in the drawing's own line colour. The hollow
ring she drew (coat showing through, yellow pupil inside) shipped alongside it
behind `?eyes=` for a while and lost — filled is far more legible at the size
Hex renders at on a phone, and the dark pupil can dilate right out to a saucer
where the ring's yellow-on-yellow one merged into a smear if it grew. Don't
reintroduce the switch; see the eye blocks in `index.html` and `cat.js`.

Game RULES live in `packages/shared/src/hex/` (data/rules/sim) — never here.
The markup + CSS are in `index.html`, ported verbatim from the prototype plus
the multiplayer shell (join gate, team strip, reconnect toast) at the bottom.

Debug: `window.__hex` exposes the mirror + `send()` for console/Playwright
driving. `?debug&speed=20` fast-forwards a debug run. The 🛠 panel's `spawn
golden` puts a golden mouse up immediately (day only — greyed out at night,
where a golden pays nothing), and its `eyes` row flips the socket variant in
place so the two can be judged against each other without a reload.
