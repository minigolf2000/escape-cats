/** `?pixels` — the resolution probe.
 *
 * "It looks blurry on my phone" is not a question this repo can close by
 * reading code, and we tried. The renderer is all vector, the backing store is
 * sized off devicePixelRatio, nothing is filtered, blitted or scaled between
 * the context and the glass, and it reads sharp on every machine we can open it
 * on. That is the same trap the Figma bridge fell into twice — reason about the
 * code, ship a fix that passes its own tests, be wrong — so this measures the
 * phone that is actually blurry instead of arguing about it a third time.
 *
 * Deliberately NOT behind `?debug`. That flag means exactly one thing (this
 * phone is in the cleared-room state) and CLAUDE.md is explicit that nothing
 * else may hide behind it.
 *
 * Three parts, because they answer three different questions:
 *
 *   STRIPES — blocks of alternating columns 1, 2 and 4 DEVICE pixels wide,
 *     drawn into a canvas built so one backing pixel is one device pixel (no
 *     transform, backing = CSS x dpr). Displayed 1:1 all three read as clean
 *     lines. Anything resampling the canvas on its way to the glass collapses
 *     them into flat grey or a moire, narrowest block first. This is the
 *     answer in a photograph, with nothing to read.
 *
 *   #c STRIPES — the same three widths, painted into the suspect canvas
 *     ITSELF, just under the panel so ONE photograph catches both racks. The
 *     blocks above are their own little canvases; this is the element being
 *     called blurry. A camera undersamples a 3x panel and mushes a 1px block by
 *     itself, so one rack proves nothing — but two racks in one frame are
 *     sampled identically, and a difference BETWEEN them cannot be the camera.
 *     Measured on an iPhone 15: a sharp load and a blurry one print the same
 *     numbers to the last digit, so this is the only part still able to see a
 *     difference at all.
 *
 *   NUMBERS — every quantity sitting between a world unit and a device pixel.
 *     The line that matters is `backing/box`: backing pixels per CSS pixel,
 *     measured off the canvas's REAL layout box rather than trusted from the
 *     value we passed in.
 *
 * Reading it:
 *   stripes clean AND backing/box == dpr
 *     -> the canvas has all the pixels it should. The softness is then in what
 *        we DRAW — stroke weights, antialiasing, the shapes themselves — and
 *        not in how many pixels we have to draw it on. A different bug, in a
 *        different file.
 *   stripes mush
 *     -> something is resampling. `scale` off 1 means the page is zoomed and
 *        the backing store was sized for a scale it is no longer at;
 *        `backing/box` below `dpr` means we under-sized it ourselves; both
 *        correct while it still looks soft means the compositor is doing it
 *        and the page cannot reach it.
 *
 * IMPORTANT: read the stripes ON THE PHONE. A screenshot that travels through
 * a chat app or an upload gets downscaled, which destroys the 1px block on its
 * own and would frame a healthy display as broken.
 */

const STRIPE_W = 168;   // CSS px per block
const STRIPE_H = 26;

/** Stamped in by `vite.config.ts` — commit and build time. `typeof` rather than
 * a bare read so this file stays safe outside a Vite build, where the define
 * never happens: `typeof` on an undeclared name is "undefined", not a throw. */
const BUILD = typeof __BUILD__ === "string" ? __BUILD__ : "unstamped";


/** One block of `n`-device-pixel columns, as a canvas that is 1:1 by
 *  construction: backing = CSS x dpr, and no transform on the context, so a
 *  fillRect of width `n` is exactly n device pixels wide if nothing resamples
 *  it downstream. */
function stripeBlock(n, dpr) {
  const el = document.createElement("canvas");
  el.width = Math.round(STRIPE_W * dpr);
  el.height = Math.round(STRIPE_H * dpr);
  el.style.width = STRIPE_W + "px";
  el.style.height = STRIPE_H + "px";
  el.style.display = "block";
  const g = el.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, el.width, el.height);
  g.fillStyle = "#fff";
  for (let x = 0; x < el.width; x += n * 2) g.fillRect(x, 0, n, el.height);
  return el;
}

const fmt = (v) => (Math.round(v * 100) / 100).toString();

/** The suspect element's own situation, reproduced.
 *
 * The little stripe blocks above are inline canvases; the canvas that is
 * reported blurry is a full-screen `position:fixed; inset:0` one, which is a
 * different compositing case entirely. So `?pixels=full` paints device-pixel
 * stripes into a canvas that is a COPY of #c's box and sizing math, laid over
 * it. If those mush while the inline blocks are clean, the fault is in how
 * that layer reaches the glass, not in the numbers. */
function fullOverlay(cv) {
  const el = document.createElement("canvas");
  el.style.cssText = "position:fixed;inset:0;z-index:150;pointer-events:none";
  document.body.appendChild(el);
  const paint = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = window.innerWidth, h = window.innerHeight;
    el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
    el.style.width = w + "px"; el.style.height = h + "px";
    const g = el.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, el.width, el.height);
    g.fillStyle = "#fff";
    // Three bands down the screen: 1, 2 and 4 device-pixel columns.
    const band = Math.floor(el.height / 3);
    [1, 2, 4].forEach((n, i) => {
      for (let x = 0; x < el.width; x += n * 2) g.fillRect(x, i * band, n, band - 2);
    });
  };
  paint();
  window.addEventListener("resize", paint);
  return paint;
}

/** `?pixels=c` — the same three blocks, painted into #c ITSELF.
 *
 * The blocks in the rack are little canvases of their own, and `full` makes a
 * COPY of #c's box. Neither one IS #c, and #c is the element being called
 * blurry — so if Safari hands it a smaller surface than the size we asked for
 * and scales up on composite, nothing above can tell: `SHARPNESS` divides
 * `cv.width` by the box, and `cv.width` is the number we ASSIGNED. It reads 1
 * whatever the hardware did with it. This is the blind spot, and this is the
 * instrument for it.
 *
 * It is a RELATIVE test: the inline rack above is small canvases of the same
 * make, a few centimetres away in the same frame, so anything that touches both
 * equally (a camera, a screenshot pipeline) cancels out, and a difference
 * between the racks belongs to #c. Measured on the iPhone 15 that prompted all
 * this: the inline canvases stay crisp on a blurry load while #c goes soft —
 * whatever Safari does, it does to the one BIG canvas, which reads like the
 * compositor downsampling a large layer under memory pressure, decided at
 * layer creation and held until reload. The 4px width is shared with the
 * inline rack for the head-to-head; 8 and 16 exist because the first version
 * of this rack used 1/2/4 and was destroyed by the very degradation it was
 * measuring — stripes, labels and all — and went unfound in six photographs.
 *
 * Drawn at device scale with the game's transform undone, at the END of every
 * frame via the `postFrame` hook main.js calls after the scene — NOT its own
 * rAF loop. It was its own loop once, on the claim that re-arming at the bottom
 * kept it behind frame() "forever". False: two self-re-arming rAF loops have
 * TWO stable interleavings, and whichever callback wins the race at boot runs
 * first every frame after. On the phone the race landed rack-then-game, and the
 * game erased the rack every frame while `painted` climbed past 800 — the
 * instrument reported itself healthy while never reaching the glass. A hook in
 * the one real loop has no race to lose. */
/** Where the rack put itself and how many times it has painted — printed in the
 * readout because five photographs of the phone came back without a visible
 * rack and there was no way to tell WHY: not running, running and painted over,
 * or running and off-screen all look identical from here. A number says which. */
let rackY = -1, rackN = 0;

function stripesIntoMain(cv, panel, onFrame) {
  const paint = () => {
    const g = cv.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(STRIPE_W * dpr), h = Math.round(STRIPE_H * dpr);
    const x = Math.round(14 * dpr);
    // MEASURED off the panel, never a fraction of the screen. The panel is
    // opaque and taller than it looks — on a phone it covers well over half the
    // viewport — so a guessed 42% painted this whole rack underneath it and the
    // one comparison it exists for was invisible. Ask the element.
    const step = h + Math.round(20 * dpr);
    let y = Math.round((panel.getBoundingClientRect().bottom + 14) * dpr);
    // Still has to fit. If the panel has eaten the screen, sit on the bottom
    // edge rather than off it — clipped stripes answer nothing.
    y = Math.min(y, Math.max(0, cv.height - 3 * step));
    const y0 = y;   // the loop below walks `y` down; the readout wants the top
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#0a0418";
    g.fillRect(0, y - Math.round(22 * dpr), cv.width, 3 * step + Math.round(14 * dpr));
    // The magenta frame is the "did you find it at all" signal. On the phone
    // this rack rendered as three featureless grey smudges — the degradation it
    // exists to measure ate its own stripes AND its own labels, and it went
    // unrecognised in six photographs. An instrument has to survive the fault
    // it measures; a border with no fine detail survives any blur.
    g.strokeStyle = "#ff5db1"; g.lineWidth = 3 * dpr;
    g.strokeRect(x - 6 * dpr, y - Math.round(20 * dpr) - 6 * dpr,
                 w + 12 * dpr, 3 * step + 12 * dpr);
    // 4 / 8 / 16, not 1 / 2 / 4 — an eye chart for the COMPOSITOR, so the
    // failure grades itself instead of vanishing. The small inline canvases
    // above stay crisp on the same blurry screen, so whatever Safari does, it
    // does to the one big canvas: if its layer is composited at half scale a
    // 4px block goes grey, 8px barely survives, 16px always survives. The first
    // striped block from the top IS the effective scale, readable by eye:
    // all three striped = healthy; only 8 and 16 = ~1.5x of 3x; only 16 =
    // ~0.75x or worse. 1 and 2px blocks graded the camera, not the layer.
    for (const n of [4, 8, 16]) {
      g.fillStyle = "#f2ecff";
      g.font = `700 ${Math.round(12 * dpr)}px ui-monospace,Menlo,monospace`;
      g.fillText(`#c — ${n}px columns`, x, y - Math.round(5 * dpr));
      g.fillStyle = "#000"; g.fillRect(x, y, w, h);
      g.fillStyle = "#fff";
      for (let i = 0; i < w; i += n * 2) g.fillRect(x + i, y, n, h);
      y += step;
    }
    g.restore();
    rackY = y0; rackN++;
  };
  onFrame(paint);
}

/** The round-trip self-test: paint stripes into #c, read them straight back.
 *
 * This exists because the two ways a canvas can go soft SPLIT on it, and no
 * number in the readout can tell them apart:
 *
 *   backing itself shrunk — Safari silently backs the 2D context with a
 *     smaller buffer than the width/height we set (its canvas-memory pressure
 *     behaviour). Every draw is downsampled INTO the buffer, so stripes die on
 *     the way in and getImageData returns the corpse: the test FAILS. The fix
 *     would be ours to make — ask for less (smaller backing) so Safari stops
 *     cutting it for us.
 *
 *   compositor sampling low — the buffer is full size and holds our pixels
 *     perfectly; only the layer's trip to the glass loses resolution. Readback
 *     is flawless while the screen is mush: the test PASSES on a blurry load.
 *     The fix would be layer-level, and no readback can measure it — only the
 *     magenta rack, by eye.
 *
 * Ascending periods, first that survives wins: 2px round-tripping intact means
 * the backing is true. Painted at the top-left corner, which sits UNDER the
 * opaque readout panel — the game repaints it next frame anyway, so nothing is
 * visible; the answer is a line of DOM text, which this bug leaves crisp. */
function selfTest(cv) {
  const g = cv.getContext("2d");
  const W = 120, H = 6;
  let finest = 0;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  for (const n of [2, 4, 8, 16, 32]) {
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#fff";
    for (let x = 0; x < W; x += n * 2) g.fillRect(x, 0, n, H);
    const d = g.getImageData(0, Math.floor(H / 2), W, 1).data;
    let mn = 255, mx = 0, flips = 0, prev = null;
    for (let i = 0; i < W; i++) {
      const v = d[i * 4 + 1];
      mn = Math.min(mn, v); mx = Math.max(mx, v);
      const bit = v > 127;
      if (prev !== null && bit !== prev) flips++;
      prev = bit;
    }
    if (mx - mn >= 200 && flips >= Math.round(W / n) - 3) { finest = n; break; }
  }
  g.restore();
  return finest;
}

let worst = 1, peakScale = 1;

export function startPixelProbe(cv, onFrame) {
  const dpr = window.devicePixelRatio || 1;
  const mode = new URLSearchParams(location.search).get("pixels");
  if (mode === "full") fullOverlay(cv);

  const panel = document.createElement("div");
  // pointer-events:none and no cursor of its own — the two-cursor rule counts
  // every declaration in this app, and a readout is not a tap target.
  panel.style.cssText = [
    "position:fixed", "left:0", "right:0", "top:0", "z-index:200",
    "pointer-events:none", "padding:7px 9px", "white-space:pre",
    "font:600 15px ui-monospace,SFMono-Regular,Menlo,monospace",
    "color:#f2ecff", "background:rgba(10,4,24,.9)", "line-height:1.45",
  ].join(";");

  const out = document.createElement("div");
  panel.appendChild(out);

  const rack = document.createElement("div");
  rack.style.cssText = "display:flex;gap:6px;margin-top:6px;flex-wrap:wrap";
  for (const n of [1, 2, 4]) {
    const cell = document.createElement("div");
    const cap = document.createElement("div");
    cap.textContent = n + "px columns";
    cap.style.cssText = "font:600 9px ui-monospace,monospace;color:#c9bdf0;margin-bottom:2px";
    cell.appendChild(cap);
    cell.appendChild(stripeBlock(n, dpr));
    rack.appendChild(cell);
  }
  panel.appendChild(rack);
  document.body.appendChild(panel);
  // After the panel is in the document, because it places itself by MEASURING
  // it — the whole point of this rack is to sit beside the one above, visible.
  //
  // ALWAYS, not behind `pixels=c`. It was a mode for two rounds and four
  // photographs of the phone came back without it, because the query string is
  // the part of a URL a phone hides and a person retypes. The rack costs three
  // blocks of screen on a page that is already nothing but instrumentation, and
  // it answers the question the numbers above cannot: a sharp load and a blurry
  // one on the same phone print IDENTICAL readouts — dpr, inner, backing, box,
  // ratio, transform, all of it — so whatever differs is below JavaScript, and
  // the only way left to see it is to look at pixels we drew into the suspect
  // element itself. A diagnostic nobody remembers to switch on is not one.
  stripesIntoMain(cv, panel, onFrame);

  const read = () => {
    const vv = window.visualViewport;
    const r = cv.getBoundingClientRect();
    const live = window.devicePixelRatio || 1;
    const ratio = r.width > 0 ? cv.width / r.width : 0;
    // Both signals, side by side: which of them a browser actually moves under
    // a pinch is the thing this readout exists to settle.
    const byWidth = vv && vv.width > 0 ? window.innerWidth / vv.width : 1;
    const scale = Math.max(vv && vv.scale > 0 ? vv.scale : 1, byWidth > 1 ? byWidth : 1);
    // 1 = every device pixel behind this canvas is one we painted. Below 1 the
    // compositor is stretching our bitmap, which is blur with a number on it.
    const have = ratio / Math.min(live * scale, 4);
    if (have < worst) worst = have;
    if (scale > peakScale) peakScale = scale;
    let tf = "—";
    const g = cv.getContext("2d");
    if (g.getTransform) {
      const t = g.getTransform();
      tf = `a=${fmt(t.a)} d=${fmt(t.d)}`;
    }
    const others = [...document.querySelectorAll("canvas")]
      .filter((el) => el !== cv && el.clientWidth)
      .map((el) => {
        const b = el.getBoundingClientRect();
        return `  #${el.id || "?"} ${el.width}x${el.height} / ${fmt(b.width)}x${fmt(b.height)}` +
               ` = ${fmt(el.width / b.width)}, ${fmt(el.height / b.height)}`;
      });
    out.textContent = [
      // FIRST, because it is the line that says whether the rest is worth
      // reading. A phone caches the HTML shell and hides the query string, so
      // two rounds of this investigation were spent photographing a build that
      // did not contain the instrument being asked about. Stamped by
      // vite.config.ts; `local` outside a checkout.
      `build       ${BUILD}`,
      `dpr         ${live}`,
      `inner       ${window.innerWidth} x ${window.innerHeight}`,
      `vviewport   ${vv ? `${fmt(vv.width)} x ${fmt(vv.height)}  scale ${fmt(vv.scale)}` : "unsupported"}`,
      `pagescale   ${fmt(scale)}   (.scale ${vv ? fmt(vv.scale) : "-"}, byWidth ${fmt(byWidth)})`,
      `screen      ${screen.width} x ${screen.height}`,
      `backing     ${cv.width} x ${cv.height}`,
      `box         ${fmt(r.width)} x ${fmt(r.height)}`,
      `backing/box ${fmt(ratio)}   want ${fmt(Math.min(live * scale, 4))}`,
      `SHARPNESS   ${fmt(have)}   worst ${fmt(worst)}`,
      // What this same moment would have read before the fix, exactly: the
      // backing store was always dpr per CSS px, so the deficit WAS 1/scale.
      `was        ${fmt(1 / scale)}   worst ${fmt(1 / peakScale)}`,
      `transform   ${tf}`,
      // Not cosmetic. Five photographs came back with no visible rack and no
      // way to tell whether it never ran, ran and was painted over, or ran
      // off-screen. `n` climbing means it is painting; `y` says where to look,
      // in DEVICE px down the backing store, against `backing` two lines up.
      `#c rack     y ${rackY}  of ${cv.height}   painted ${rackN}`,
      // Read this line FIRST on a blurry load. "2px round-trips" with a soft
      // screen convicts the COMPOSITOR (our buffer is fine, the loss is on the
      // way to the glass); a bigger number, or FAIL, convicts the BACKING
      // (Safari shrank the buffer under us, and every draw dies on the way in).
      (() => { const st = selfTest(cv); return `selftest    ${st ? st + "px round-trips  (2 = backing true)" : "FAIL — nothing round-trips"}`; })(),
      ...others,
    ].join("\n");
  };

  read();
  // Events AND a slow poll: the whole premise is that something is changing
  // the picture without telling us, so the poll is the part that has to work.
  for (const ev of ["resize", "orientationchange", "pageshow"]) {
    window.addEventListener(ev, read);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", read);
    window.visualViewport.addEventListener("scroll", read);
  }
  setInterval(read, 500);
}
