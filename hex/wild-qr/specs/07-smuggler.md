# Piece 7 — the smuggler (a message in the bits no scanner reads)

**The bend:** pad codewords after the terminator are never surfaced by
decoders — phones show only the URL. This piece fixes some of those bytes to
ASCII, so anyone who dumps the raw de-interleaved bitstream finds a second
message woven through the picture. Steganography inside a fully valid code.

## Payload & symbol

- URL: `https://github.com/minigolf2000/cat-games`, version 6, level L
  (136 data bytes; the URL segment leaves ~90 pad bytes).
- Hidden message (exact bytes, uppercase ASCII):
  `PSST. YOU READ THE PADDING. GOOD CAT. -HEX & GOOMBA`
  (51 bytes). Place it in the pad region immediately after the pad-to-byte
  boundary, so a raw reader hits it right after the URL. The remaining ~39
  pad bytes + scheme/host case bits stay free for the art solve.

## Art direction

Freedom is roughly half the usual, so the art is a compact motif, not a
scene: a bold 12×12 paw print (four toe blobs + pad, solid dark) with a
2-module white halo, placed center-left; everything else surrendered noise.
If ≥95% of paw pins satisfy with headroom to spare, add a second smaller paw
step above-right (walking trail). Flips may clean the halo only — never spend
flips inside the fixed message's codewords if the meter is near the cap
(message integrity outranks art; flips are corrected by RS on read, so
message bytes survive regardless — but keep total ≥2 codewords headroom per
block as always).

## Extraction tool (part of the deliverable)

`hidden.mjs`: CLI `node hidden.mjs <png>` → uses jsQR to locate/normalize
the code OR (simpler and fine) re-reads the matrix from a scale-8 PNG
directly, then runs the engine's honest read path (readFormat → unmask →
de-interleave → rsCorrect per block), and prints: the URL segment, then the
pad region as ASCII with non-printables dotted. The hidden message must
appear verbatim. Document in the report how a stranger with a raw-bitstream
QR tool (not a phone) would find it, and note that standard padding is the
alternating 0xEC 0x11 pattern — which is exactly why ASCII there is a
detectable easter egg for QR nerds.

## Acceptance

- verifyMatrix passes (scale 8 + 3); phones/jsQR must see ONLY the URL.
- `hidden.mjs out/smuggler.png` prints the exact message.
- Byte-level assert: de-interleaved, RS-corrected data stream contains the
  51 message bytes at the chosen offset.
- ≥90% of paw pins satisfied; ≥2 codewords headroom per block.
- Deliver: `out/smuggler.png`, `out/smuggler.svg`, `hidden.mjs`,
  `out/smuggler-report.md` (offset, meter, extraction transcript).
