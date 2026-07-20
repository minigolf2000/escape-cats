# Piece 5 — the picross code (solve the puzzle, scan your drawing)

**The bend:** a printed nonogram (picross) puzzle whose unique solution IS a
working QR code. The solver hand-pencils a grid for twenty minutes, points
their phone at their own drawing, and it opens the repo.

## Payload & symbol

- URL: `https://github.com/minigolf2000/cat-games` → needs v3-L (29×29,
  single block, 55 data bytes, 15 EC). 29×29 is a serious-but-real puzzle
  size. Art freedom is small (~12 free pad bytes + case bits) — this piece
  spends freedom on *puzzle quality*, not picture. No art target needed; a
  3×3 heart in a corner is optional garnish if it costs nothing.

## Puzzle-quality constraint (the real work)

A fair nonogram must be uniquely solvable — ideally line-solvable (solvable
by row/column propagation alone, no bifurcation), which is what human
technique achieves.

1. Implement a standard nonogram line solver (per-line constraint
   propagation to fixpoint over the 29 rows + 29 columns).
2. Search: iterate over masks × free-bit randomizations (the ~100 free bits
   + 7 remainder bits give a large family of valid matrices, all encoding the
   same URL). Score each candidate by propagation completeness (% of cells
   determined at fixpoint).
3. If no candidate reaches 100% line-solvable (likely), take the best and add
   GIVENS: greedily pre-fill the cell that unlocks the most propagation,
   repeat until line-solvable. Real published nonograms use givens; ≤25
   givens on 841 cells is respectable — minimize them and report the count.
4. Sanity: run the line solver on the final clue set + givens from scratch
   and confirm it reproduces the exact matrix.

## Presentation

`out/picross-sheet.svg` + `.png`: a clean printable puzzle page — 29×29 grid
with 5-cell guide lines, row clues left, column clues top, givens as filled
cells, and a one-line rubric: "Solve it. Then scan what you drew." Include
quiet-zone margin around the grid so a completed sheet scans as-is. Clue
digits must be legible at A4 print size.

## Acceptance

- The engine matrix passes verifyMatrix (it's a plain valid QR).
- Line solver, from clues+givens alone, reproduces the matrix exactly.
- Simulated player test: render the *reconstructed* grid (not the original)
  as a PNG in "pencil style" (imperfect: 0.5-module random offsets on cell
  fill, 90% fill coverage) and jsQR must still decode it — proof that a human
  solve scans.
- Deliver: sheet SVG/PNG, `out/picross-solution.png`,
  `out/picross-report.md` (givens count, propagation stats, pencil-sim scan
  result).
