# Piece 3 — the animated code (every frame scans)

**The bend:** a QR code that visibly moves — static shimmers, tail swishes —
while any single frame a phone catches decodes the same URL. Works because the
noise tone is surrendered: re-solving with a different seed yields a
different-but-equivalent matrix, ~6ms per solve.

## Payload & symbol

- URL: `https://github.com/minigolf2000/cat-games`, version 6, level L.

## Art direction

A chunky solid-black sitting-cat silhouette (ink-cat energy, not line art):
head + ears + body mass occupying roughly the left/center 24×28 modules, two
white cutout eyes, alignment pattern at (34,34) left as furniture. The TAIL is
the animated part: a 2-module-thick curve rising from the body's right side,
drawn in a different pose per frame (e.g. 8 poses sweeping through ~40° like a
metronome, or a loop of curl/uncurl). Everything not cat and not tail:
surrendered noise, re-seeded per frame so the ground visibly shimmers.

Constancy rule: head/body/eye pins are IDENTICAL across frames (the figure
must not boil); only the tail pins and the noise seed change. Mask/EC may be
fixed across frames if letting them vary makes the furniture flicker — pick
whichever reads better and say so in the report.

## Build

- 10 frames, 100ms/frame, looping. Solve each frame independently
  (same restarts budget per frame), verifyMatrix each.
- Assemble an animated output: prefer APNG via the `upng-js` npm package (add
  it to hex/wild-qr deps); if it fights you, a GIF via `gifenc` is fine.
  Black/white only, scale 8, quiet 4.
- Round-trip check: decode the assembled animation's frames back out and
  assert each equals its source matrix render (no encoder quantization
  surprises), then jsQR each extracted frame.

## Acceptance

- All 10 frames pass verifyMatrix (scale 8 + scale 3); each frame ≥2
  codewords headroom per block.
- Tail actually reads as a tail in motion on the contact sheet (orchestrator
  eyeballs this — deliver `out/animated-contact.png`, a 5×2 grid of frames).
- Deliver: `out/animated.png` (APNG) or `out/animated.gif`, per-frame
  `out/animated-frames/f0..f9.png`, contact sheet, `out/animated-report.md`
  (per-frame meter + round-trip results). Expect one round of art notes.
