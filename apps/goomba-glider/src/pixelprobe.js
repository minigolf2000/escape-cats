/** `?pixels` — the resolution probe. "It looks blurry on my phone" cannot be
 * closed by reading code (the renderer is vector, the backing store is sized
 * off dpr, and it reads sharp on every machine we can open); this measures the
 * phone that is actually blurry. NOT behind `?debug`, which means one thing.
 *
 * Three parts, three questions:
 *   STRIPES — blocks of 1, 2 and 4 DEVICE-pixel columns in canvases built 1:1
 *     (backing = CSS x dpr, no transform). Anything resampling on the way to
 *     the glass collapses them into grey or moire, narrowest first.
 *   #c STRIPES — the same idea painted into the suspect canvas ITSELF, under
 *     the panel, so ONE photograph holds both racks. A camera mushes a 1px
 *     block by itself, but a difference BETWEEN the racks cannot be the camera;
 *     this is the only part that still sees a difference on a blurry load.
 *   NUMBERS — every quantity between a world unit and a device pixel.
 *     `backing/box` is the one that matters: backing px per CSS px, measured
 *     off the canvas's REAL box.
 *
 * Reading it: stripes clean AND backing/box == dpr -> the softness is in what
 * we DRAW, a different bug. Stripes mush -> something resamples: `scale` off 1
 * is a zoomed page, `backing/box` under `dpr` is our own under-sizing, both
 * right and still soft is the compositor, which the page cannot reach.
 *
 * READ THE STRIPES ON THE PHONE: a screenshot through a chat app is downscaled
 * and would frame a healthy display as broken.
 */

const STRIPE_W = 168;   // CSS px per block
const STRIPE_H = 26;

/** Stamped in by `vite.config.ts`. `typeof`, not a bare read, so this stays
 * safe outside a Vite build where the define never happens. */
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

/** `?pixels=full`: device-pixel stripes in a canvas that is a COPY of #c's
 * box and sizing (a full-screen fixed layer is a different compositing case
 * from the inline blocks). Mush here with clean inline blocks = the layer. */
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

/** The rack painted into #c ITSELF. Neither the inline blocks nor `full` IS
 * #c, and `SHARPNESS` divides by the `cv.width` we ASSIGNED, so a smaller
 * surface Safari hands back reads 1 regardless — this is the instrument for
 * that blind spot. A RELATIVE test against the inline rack centimetres away:
 * whatever touches both cancels, a difference belongs to #c. Drawn at device
 * scale with the game's transform undone, from the `postFrame` hook — NEVER
 * its own rAF loop (render.js says why). */
/** Where the rack put itself and how many times it has painted, printed so a
 * photograph with no visible rack says whether it never ran, was painted over,
 * or is off-screen. */
let rackY = -1, rackN = 0;

function stripesIntoMain(cv, panel, onFrame) {
  const paint = () => {
    const g = cv.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(STRIPE_W * dpr), h = Math.round(STRIPE_H * dpr);
    const x = Math.round(14 * dpr);
    // MEASURED off the panel, never a fraction of the screen: on a phone the
    // opaque panel covers well over half the viewport.
    const step = h + Math.round(20 * dpr);
    let y = Math.round((panel.getBoundingClientRect().bottom + 14) * dpr);
    // If the panel has eaten the screen, sit on the bottom edge, not off it.
    y = Math.min(y, Math.max(0, cv.height - 3 * step));
    const y0 = y;   // the loop below walks `y` down; the readout wants the top
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#0a0418";
    g.fillRect(0, y - Math.round(22 * dpr), cv.width, 3 * step + Math.round(14 * dpr));
    // The magenta frame is the "did you find it at all" signal: the
    // degradation this measures can eat its own stripes AND labels, and a
    // border with no fine detail survives any blur.
    g.strokeStyle = "#ff5db1"; g.lineWidth = 3 * dpr;
    g.strokeRect(x - 6 * dpr, y - Math.round(20 * dpr) - 6 * dpr,
                 w + 12 * dpr, 3 * step + 12 * dpr);
    // 4 / 8 / 16, not 1 / 2 / 4: an eye chart for the COMPOSITOR, so the
    // failure grades itself instead of vanishing. All three striped =
    // healthy; only 8 and 16 = ~1.5x of 3x; only 16 = ~0.75x or worse. 1 and
    // 2px blocks grade the camera, not the layer.
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
 * The two ways a canvas goes soft SPLIT on it: a backing Safari silently
 * SHRANK downsamples every draw on the way in, so the test FAILS (fix: ask for
 * less); a compositor sampling a true buffer low PASSES on a blurry load (fix
 * is layer-level; only the magenta rack sees it). Ascending periods, first
 * that survives wins: 2px = backing true. Painted under the opaque panel. */
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
  // pointer-events:none and no cursor of its own (check-cursors.mjs counts
  // every declaration in this app).
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
  // After the panel is in the document: it places itself by MEASURING it.
  // ALWAYS on, never behind a mode: a phone hides the query string, and this
  // rack answers the one question the numbers cannot (a sharp load and a
  // blurry one print IDENTICAL readouts).
  stripesIntoMain(cv, panel, onFrame);

  const read = () => {
    const vv = window.visualViewport;
    const r = cv.getBoundingClientRect();
    const live = window.devicePixelRatio || 1;
    const ratio = r.width > 0 ? cv.width / r.width : 0;
    // Both signals: which one a browser moves under a pinch is unsettled.
    const byWidth = vv && vv.width > 0 ? window.innerWidth / vv.width : 1;
    const scale = Math.max(vv && vv.scale > 0 ? vv.scale : 1, byWidth > 1 ? byWidth : 1);
    // 1 = every device pixel behind this canvas is one we painted; below 1
    // the compositor is stretching our bitmap.
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
      // FIRST: a phone caches the HTML shell, so this line says whether the
      // rest is even the build being asked about. Stamped by vite.config.ts.
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
      // What a backing store of plain dpr per CSS px would read: 1/scale.
      `was        ${fmt(1 / scale)}   worst ${fmt(1 / peakScale)}`,
      `transform   ${tf}`,
      // `n` climbing means the rack is painting; `y` says where to look, in
      // DEVICE px down the backing store.
      `#c rack     y ${rackY}  of ${cv.height}   painted ${rackN}`,
      // Read FIRST on a blurry load: "2px round-trips" with a soft screen
      // convicts the COMPOSITOR; a bigger number or FAIL convicts the BACKING.
      (() => { const st = selfTest(cv); return `selftest    ${st ? st + "px round-trips  (2 = backing true)" : "FAIL — nothing round-trips"}`; })(),
      ...others,
    ].join("\n");
  };

  read();
  // Events AND a slow poll: something is changing the picture without
  // telling us, so the poll is the part that has to work.
  for (const ev of ["resize", "orientationchange", "pageshow"]) {
    window.addEventListener(ev, read);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", read);
    window.visualViewport.addEventListener("scroll", read);
  }
  setInterval(read, 500);
}
