# Piece 12 — the snake: one unbroken line through the whole code

**The bend:** the entire artwork is a single continuous 1-module dark line
that snakes through the whole symbol — enter at one corner region, wander
every zone, emerge at another. A QR code drawn without lifting the pen.

## Symbol & payload

- Default: v10-L (57×57), URL `https://hexxygon.com` (the short-URL freedom
  is what makes this feasible: ~2024 free basis bits), urlCase schemehost.
  Also attempt v6-L/41px at coarser pitch (chunkier, poster-grade) and
  report both; ship whichever reads better, or both if both pass.

## The route (phenotype)

`build-11-snake.mjs` — genome → route → solve → verify:

Route generator: a boustrophedon (scan-line) serpentine over the free-cell
grid with clean detours around all function patterns (finders+separators,
timing, all six v10 alignment blocks, format/version areas), parameterized
by genome:
- `pitch` (row spacing, 4–6), `orient` (rows | cols), `detourStyle`
  (hug | wide), `startCorner`, `spiralMix` (0 = pure serpentine, 1 = spiral
  inward), `seed`.
- The route must be a single 4-connected path, 1 module wide, no
  self-touching (no two path cells 4-adjacent unless consecutive on the
  path — otherwise it reads as blobs, not a line). Endpoints: flare each
  into a small 2×2 dot (pen-down / pen-up), or an arrowhead — builder's
  taste, must not break the no-self-touch rule.

## Solve strategy (priority order)

1. Line cells dark — MUST end 100% satisfied; spend flips (≥2 codewords
   headroom per block preserved) to repair any contested line cell. If a
   line cell is unrepairable, REROUTE (perturb genome seed/detours) and
   retry — a broken line is a failed piece, there is no partial credit.
2. A 1-module white halo on both sides of the line — best-effort priority
   pinning (this is the "breathing room" that makes the line read).
3. Everything else surrendered; render three-tone (line pure black, halo
   white, residue gray #3a3a3a). Also emit a BW fallback.

## Gates

- Connectivity: programmatic check on the SOLVED matrix — the set of pinned
  line cells is one 4-connected component, exactly 2 endpoints (cells with
  1 path-neighbor), all others 2. Assert, don't eyeball.
- Line satisfaction 100%; report halo satisfaction % and speck count
  adjacent to the line.
- Coverage: the line visits ≥90% of rows and ≥80% of columns — it must
  read as spanning the WHOLE code.
- jsQR scans (allowSchemeHostCase) at scale 8 and 3, toned and BW;
  ≥2 codewords headroom per block; deterministic.

## Deliverables

`out/snake-v10.png/.svg` (+`-bw.png`), `out/snake-v6.png` if it passes,
`out/snake-report.md` (route stats: length, coverage, halo %, specks,
per-block meter, which genome params won), and `out/snake-contact.png`
(2–4 route-style variants side by side for the orchestrator's judging
round — e.g. serpentine-rows, serpentine-cols, spiral, hybrid).
