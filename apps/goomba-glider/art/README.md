# Goomba Glider prop art — SVG exports

Design copies of the two props, for Figma and anything else that wants vectors.

| file | what |
| --- | --- |
| `watering-can.svg` | the collectible, mid-pour, with its three drips |
| `spider-plant-thirsty.svg` | the goal plant with cans outstanding — blades sagging, dulled |
| `spider-plant-watered.svg` | the goal plant with the last can in — fountain arched up, bright |
| `goomba.svg` | Goomba herself, idle |
| `party-popper.svg` | the popper, with its aim arrow |
| `bumper.svg` | the piñata bumper |
| `cushion.svg` | a cushion segment |

**The game does not load these.** `apps/goomba-glider/src/main.js` draws both
props procedurally on canvas (`drawCan`, `drawGoalPlant`), and that is still
the only copy the game runs — editing an SVG here changes nothing on screen.

`export-svg.mjs` is where these come from, and it mirrors that canvas geometry
by hand. So the two can drift: **retune the art in `main.js`, then re-run the
export and commit the result.**

```sh
cd apps/goomba-glider/art && node export-svg.mjs
```

Both plant states are frozen at t=0 — no idle sway, no runner swing, no drip
animation phase beyond the three the export picks. Everything is emitted at
u = 10 (one canvas unit = 10 SVG units) in named `<g>` layers, so Figma gets
`pot`, `blades`, `runner`, `drips` and friends as named groups rather than one
flattened path soup.

## There is no splash picture

The `splash` phase (the screen a cleared room lands on) is drawn by `drawSplash`
in `main.js` and is **black** — CONGRATULATIONS, one line under it, and the way
into the levels grid. It used to be `public/art/splash.webp`, the only loaded
asset this app had; that file is gone, and so is the sampler that continued its
sky past the ends of a tall phone.

hex-clicker's win screen still has a picture of its own
(`apps/hex-clicker/public/art/hex-splash.webp`). The two games always kept
separate files rather than sharing one, which is exactly why this one could go
without touching that one.
