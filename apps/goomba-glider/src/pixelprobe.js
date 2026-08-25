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
 * Two halves, because they answer two different questions:
 *
 *   STRIPES — blocks of alternating columns 1, 2 and 4 DEVICE pixels wide,
 *     drawn into a canvas built so one backing pixel is one device pixel (no
 *     transform, backing = CSS x dpr). Displayed 1:1 all three read as clean
 *     lines. Anything resampling the canvas on its way to the glass collapses
 *     them into flat grey or a moire, narrowest block first. This is the
 *     answer in a photograph, with nothing to read.
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

let worst = 1, peakScale = 1;

export function startPixelProbe(cv) {
  const dpr = window.devicePixelRatio || 1;
  if (new URLSearchParams(location.search).get("pixels") === "full") fullOverlay(cv);

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
