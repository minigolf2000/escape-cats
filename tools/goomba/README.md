# `tools/goomba/`

Commands for a Goomba Glider event. **None of them evaluates a level** — playing
it does that; [`DESIGNING.md`](./DESIGNING.md) is what was learned from doing so.

```sh
node seed.mjs --pull                   # what is this event running? (--host to pick one)
node seed.mjs --pull > pack.json       # save it (gitignored; levels-to-svg reads it)
node seed.mjs --push --file pack.json  # move a pack into another event
node test-codec.mjs                    # the save format: round-trips, and every older link still decodes
node bands.mjs                         # the room hands out MAX_BANDS and rations nobody
node draft.mjs                         # the draft bench (usage)
node figma/read-frame.mjs --nodes f.json   # a Figma frame in world units
```

- `lib.mjs` bundles `packages/shared/src/goomba/` with esbuild on the fly so no
  tool carries a second copy of the codec, the pack rules or the room sim.
- `figma/` is the way IN: the design kit, the naming contract, the clipboard
  reader's tests, `levels-to-svg.mjs` (a pack as one artboard per level) and
  `read-frame.mjs`. [Its README](./figma/README.md) is where a level starts.
- `draft/<name>.mjs` is a level whose numbers are still being swept: a params
  object `P` and `buildLevel(P)`, driven by `draft.mjs` (`run`, `from`, `sweep`,
  `audit`, `card`, `link`, `figma`). `draft/_sim.mjs` is its bridge to the shipped
  physics. Nothing in it prints a pass, a fail or a score; `link` hands you a
  `?solo#hash` URL to play.
- `bands.mjs` tests SHIPPED code: that "A may lay all four while B, C and D
  watch" is allowed. It is a product decision that should fail a test rather
  than surprise a party.
- `logo-outline.py` regenerates the gate logo's SVG outlines from the Titan One
  face; its docstring has the recipe.
