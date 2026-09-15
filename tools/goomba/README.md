# `tools/goomba/`

Commands for Goomba Glider levels. **None of them evaluates a level** — playing
it does that; [`DESIGNING.md`](./DESIGNING.md) is what was learned from doing so.

```sh
node levels.mjs                        # what the game ships (--check for the build)
node test-library.mjs                  # progress surviving a changed level list
node test-codec.mjs                    # the save format: round-trips, and every older link still decodes
node bands.mjs                         # MAX_BANDS is handed out and rationed to nobody
node draft.mjs                         # the draft bench (usage)
node figma/read-frame.mjs --nodes f.json   # a Figma frame in world units
```

`seed.mjs` is gone with the lobby Durable Object it talked to. The shipped list
is [`levels.data.ts`](../../packages/shared/src/goomba/levels.data.ts) and a
level is published by committing a row.

- `lib.mjs` bundles `packages/shared/src/goomba/` with esbuild on the fly so no
  tool carries a second copy of the codec, the list rules or the sim.
- `figma/` is the way IN: the design kit, the naming contract, the clipboard
  reader's tests, `levels-to-svg.mjs` (a pack as one artboard per level) and
  `read-frame.mjs`. [Its README](./figma/README.md) is where a level starts.
- `draft/<name>.mjs` is a level whose numbers are still being swept: a params
  object `P` and `buildLevel(P)`, driven by `draft.mjs` (`run`, `from`, `sweep`,
  `audit`, `card`, `link`, `figma`). `draft/_sim.mjs` is its bridge to the shipped
  physics. Nothing in it prints a pass, a fail or a score; `link` hands you a
  `#hash` URL to play.
- `bands.mjs` tests SHIPPED code: that all four bands may be spent however the
  player likes. It outlived the party it was written for — the budget is still
  a product decision that should fail a test rather than surprise anyone.
- `logo-outline.py` regenerates the gate logo's SVG outlines from the Titan One
  face; its docstring has the recipe.
