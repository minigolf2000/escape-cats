#!/usr/bin/env python3
"""Regenerate the sheet logo — GOOMBA GLIDER as SVG outlines, for index.html.

The mark is outlines, not text in Titan One, so no face can arrive late and
flash a fallback under a gate that has already painted. The cost is FROZEN
geometry: tracking, line spacing and the words are numbers here and a re-run,
never a hand-edit of path data.

    pip install fonttools brotli
    npm pack @fontsource/titan-one@5.3.0 && tar xzf fontsource-titan-one-5.3.0.tgz
    python3 tools/goomba/logo-outline.py package/files/titan-one-latin-400-normal.woff2

Prints the <svg> block to paste into apps/goomba-glider/index.html. The numbers
below are the CSS the mark replaced, so the outlines land where the text did;
CAP_EM is the one number sheet.js still needs (--cap-em in styles.css) and is
printed alongside.

Titan One is OFL-1.1, Copyright (c) 2011 Rodrigo Fuenzalida, Reserved Font Name
"Titan One" — see apps/goomba-glider/OFL-titan-one.txt. Outlines drawn into a
document are the font's OUTPUT, not the Font Software.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen

WORDS = ["GOOMBA", "GLIDER"]
TRACKING = -0.035    # letter-spacing, em — was on #gate h1
LINE = 1.04          # line-height, em — was on #gate h1
# The rainbow, per WORD: red on the first letter, blue on the last, both rows.
# Two of the game's own colours ride in the run (#ffd166, #57e6c9); the red and
# blue bookends are the ColecoVision mark's.
STOPS = [(0, "#ff4d4d"), (20, "#ff9445"), (40, "#ffd166"),
         (60, "#9fdd55"), (80, "#57e6c9"), (100, "#5aa9ff")]


def main(path):
    f = TTFont(path)
    upem = f["head"].unitsPerEm
    cmap, hmtx, gs = f.getBestCmap(), f["hmtx"], f.getGlyphSet()
    asc, desc = f["hhea"].ascent / upem, -f["hhea"].descent / upem
    cap = f["OS/2"].sCapHeight / upem

    # Where CSS put each baseline: half-leading + ascent, one LINE apart. The
    # h1's box was two line boxes tall, and staying exactly that tall is what
    # lets #title's margins and #scTitle's -.72em offsets keep their meaning.
    half = (LINE - (asc + desc)) / 2
    baselines = [half + asc + i * LINE for i in range(len(WORDS))]
    box_h = LINE * len(WORDS)
    cap_em = baselines[0] - cap          # the line the cat rides

    # Lay each word out at the origin first, to learn its ink width.
    laid = []
    for word in WORDS:
        pen_x, segs = 0.0, []
        for ch in word:
            g = cmap[ord(ch)]
            segs.append((g, pen_x))
            pen_x += hmtx[g][0] / upem + TRACKING
        bp = BoundsPen(gs)
        for g, x in segs:
            gs[g].draw(TransformPen(bp, Transform(1, 0, 0, 1, x * upem, 0)))
        x0, _, x1, _ = bp.bounds
        laid.append((segs, x0 / upem, x1 / upem))

    width = max(x1 - x0 for _, x0, x1 in laid)   # the widest word IS the box

    paths = []
    for (segs, x0, x1), base in zip(laid, baselines):
        # Centre each word on its INK, not on its advance width: the mark is a
        # picture now, and a picture is centred by what you can see.
        dx = (width - (x1 - x0)) / 2 - x0
        sp = SVGPathPen(gs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
        for g, x in segs:
            # Font space is Y-up and SVG is Y-down; the flip rides the same
            # transform as the pen position and the baseline.
            t = Transform(1, 0, 0, -1, (x + dx) * upem, base * upem)
            gs[g].draw(TransformPen(sp, t))
        paths.append(sp.getCommands())

    vb_w, vb_h = round(width * upem), round(box_h * upem)
    out = []
    out.append(f'<!-- viewBox is em/{upem}: {width:.4f}em wide, {box_h}em tall (two {LINE}em line boxes). -->')
    out.append(f'<svg id="mark" viewBox="0 0 {vb_w} {vb_h}" role="img" aria-label="Goomba Glider">')
    out.append('  <linearGradient id="markInk" x1="0" y1="0" x2="1" y2="0">')
    for off, col in STOPS:
        out.append(f'    <stop offset="{off}%" stop-color="{col}"/>')
    out.append('  </linearGradient>')
    for word, d in zip(WORDS, paths):
        out.append(f'  <path fill="url(#markInk)" d="{d}"/><!-- {word} -->')
    out.append('</svg>')
    print("\n".join(out))
    print(f"\n<!-- styles.css: width: {width:.4f}em; height: {box_h}em; --cap-em: {cap_em:.4f}; -->",
          file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1])
