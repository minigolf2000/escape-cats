# Goomba Glider prop art — SVG exports

Design copies of the props, for Figma and anything else that wants vectors.

| file | what |
| --- | --- |
| `watering-can.svg` | the collectible, mid-pour, with its three drips |
| `spider-plant-thirsty.svg` | the goal plant with cans outstanding — blades sagging, dulled |
| `spider-plant-watered.svg` | the goal plant with the last can in — fountain arched up, bright |
| `goomba.svg` | Goomba herself, idle |
| `party-popper.svg` | the popper, with its aim arrow |
| `bumper.svg` | the piñata bumper |
| `cushion.svg` | a cushion segment |

**The game does not load these.** `apps/goomba-glider/src/render.js` draws every
prop procedurally on canvas (`drawCan`, `drawGoalPlant` and friends), and that is
the only copy the game runs — editing an SVG here changes nothing on screen.

`export-svg.mjs` is where these come from, and it mirrors that canvas geometry
by hand. So the two can drift: **retune the art in `render.js`, then re-run the
export and commit the result.**

```sh
cd apps/goomba-glider/art && node export-svg.mjs
```

Both plant states are frozen at t=0 — no idle sway, no runner swing, no drip
animation phase beyond the three the export picks. Everything is emitted at
u = 10 (one canvas unit = 10 SVG units) in named `<g>` layers, so Figma gets
`pot`, `blades`, `runner`, `drips` and friends as named groups rather than one
flattened path soup.

## No splash picture

Goomba's `splash` phase is drawn black (`drawSplash` in `src/render.js`), and
this app loads **no image asset at all**. hex-clicker's win screen has a picture
of its own at `apps/hex-clicker/public/art/hex-splash.webp`; the two games always
kept separate files rather than sharing one, which is why this one could go
without touching that one.
