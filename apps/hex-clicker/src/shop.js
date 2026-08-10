// THE SHOP — dock, building rows, upgrade rail, HUD numbers, the badge/seen
// system, and the sold-out closing beat. Ported from the prototype; the one
// structural change is that buy() / buyUpgrade() send intents to the server
// instead of mutating state — the purchase lands in the next snapshot, and
// main.js fires the UI beats off that snapshot's edges.

import {
  BUILDINGS,
  UPGRADES,
  INCOME_SCALE,
  CRUX_KEYS,
  WALL,
  WALL_EFFECTS,
  costOf,
  isRevealed,
  buildingMpsWith,
  onRail,
  allRailBought,
  effectsOf,
} from "@escape-cats/shared";
import {
  shopEl,
  upgradesEl,
  upgradeSecEl,
  shopScrollEl,
  newBadgeEl,
  buildingSecEl,
  dockEl,
  shopToggleEl,
  countEl,
  cpsEl,
} from "./dom.js";
import { game, mods, nightActive, baseCps, isUnlocked } from "./state.js";
import { fmt } from "./format.js";
import { currencyIconSVG } from "./art.js";
import { transport } from "./net";

// ---------------------------------------------------------------------------
// DOCK STATE
// ---------------------------------------------------------------------------
// Last touch anywhere in the shop, and how long a reveal will hold the list
// still afterwards (see the long note on refreshUpgrades). 700ms outlasts the
// gap between taps in a mash without keeping the list frozen once a player's
// hands are off it.
let lastShopTapAt = -Infinity;
const SHOP_HOLD_MS = 700;
shopScrollEl.addEventListener(
  "pointerdown",
  () => {
    lastShopTapAt = performance.now();
  },
  { capture: true, passive: true },
);
// The last time the player SCROLLED the shop themselves — separate from
// lastShopTapAt on purpose (tapping a building row is not evidence you read
// the upgrade list above it). See updSeen for what it gates.
let lastShopLookAt = -Infinity;
const SHOP_LOOK_MS = 1000;
// Raised across the hold's own write to scrollTop, cleared next frame.
let programmaticScroll = false;

// True once the opening render is done — tells the shop ARRIVING from the page
// merely being drawn, so a rejoin doesn't replay the slide-in.
let booted = false;
export function setBooted() {
  booted = true;
}

// Where the closing beat has got to: null while the shop is open and for sale,
// then "closing" -> "sign" -> "retired". Purely presentational.
export let shopClosePhase = null;

export function syncDock() {
  // NOTHING LEFT TO SELL — the beat plays once (runShopClose, fired off the
  // sold-out edge) and then the dock is gone for good.
  if (shopSoldOut()) {
    // Arrived this way rather than got here by buying: a rejoin lands on the
    // end state with no beat, the same rule the night cutscene follows.
    if (!shopClosePhase) retireShop();
    return;
  }
  // Not sold out, so any closure hanging off the dock is stale — only a
  // proctor reset reaches this (real play never un-buys an upgrade).
  if (shopClosePhase) reopenShop();
  const show =
    upgradeSecEl.classList.contains("show") ||
    buildingSecEl.classList.contains("show");
  // `.dock-in` carries the slide; .show only makes the dock displayed.
  if (show && !dockEl.classList.contains("show") && booted)
    dockEl.classList.add("dock-in");
  dockEl.classList.toggle("show", show);
}

// A tap on the titled SHOP rail collapses/reopens the dock as a whole.
function toggleShop() {
  if (shopClosePhase) return; // a sold-out shop does not reopen
  const expanded = !dockEl.classList.toggle("collapsed");
  shopToggleEl.setAttribute("aria-expanded", String(expanded));
}
shopToggleEl.addEventListener("click", toggleShop);

// Does this row belong on the rail in the CURRENT phase? The shared rule —
// the sim's wire guard and the sold-out test are the same predicate.
const onRailInPhase = (u) => onRail(u, game.bought);

// NOTHING LEFT TO SELL — every row this phase would ever show is bought.
// Derived from the table and the state, so a rejoin lands right for free.
export function shopSoldOut() {
  return allRailBought(game);
}

// How many unlocked, unbought upgrades you have never had on screen.
export function refreshBadge() {
  let n = 0;
  for (const u of UPGRADES)
    if (
      !game.bought[u.key] &&
      game.unlocked[u.key] &&
      !game.seen[u.key] &&
      onRailInPhase(u)
    )
      n++;
  if (n === badgeN) return;
  badgeN = n;
  if (n > 0) newBadgeEl.textContent = n;
  newBadgeEl.hidden = n === 0;
  // The rail's accessible name carries the count too — the badge itself is
  // aria-hidden. Rewritten on every change of n, not just visibility flips.
  shopToggleEl.setAttribute(
    "aria-label",
    n > 0 ? `Shop, ${n} new upgrades` : "Shop",
  );
}
let badgeN = -1;

// ---------------------------------------------------------------------------
// UPGRADE TEXT — every row's description is DERIVED from `effect`; the joke
// lives in the NAME (Cookie Clicker's split). No flavor-text field, by design.
// ---------------------------------------------------------------------------
const buildingName = (id) =>
  (BUILDINGS.find((b) => b.id === id) || { name: id }).name;

// `reveal` is for the ?debug content dump ONLY — an opaque effect column makes
// the debug table useless, and a tuning pass has to be able to read what a wall
// row actually does. The shop never passes it; see oneEffectText's ??? note.
export function effectText(u, reveal = false) {
  const parts = effectsOf(u)
    .map((e) => oneEffectText(e, reveal))
    .filter(Boolean);
  // DEDUPED, and only the wall rows can trigger it: every wall effect renders as
  // the same ??? on the rail, so a row carrying two of them (Paper Lantern's light
  // and pace; Lucid Dreaming I's trail and pace) would read "??? · ???" — which is
  // the exact flag the uniform ??? exists to avoid, a row announcing that it is
  // bigger than its neighbours. One row, one ???. The dev dump passes `reveal`, so
  // its strings differ and every effect still gets its own column entry there.
  return [...new Set(parts)].join(" · ");
}
// Word-form only reads naturally for small round multipliers — Cookie
// Clicker's own convention. Percentages skip it entirely.
const multWord = (m) =>
  ({ 2: "twice", 3: "thrice", 4: "four times", 5: "five times", 6: "six times" })[
    m
  ] || `×${m}`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const hl = (s) => `<b>${s}</b>`;

// The wall rows are the MYSTERY, so they do not describe themselves — every
// effect that touches the wall renders as ??? and the player finds out by
// buying it and looking up. Uniform on purpose: one bespoke row among eight
// ???s is a flag saying "this is the important one".
function oneEffectText(e, reveal = false) {
  if (WALL_EFFECTS.has(e.type) && !reveal) return hl("???");
  switch (e.type) {
    case "buildingMult":
      return `${buildingName(e.building)} is ${hl(multWord(e.mult))} as good`;
    case "globalPct":
      return `+${hl(e.pct + "%")} mice per second`;
    case "globalMult":
      return `${hl(cap(multWord(e.mult)))} as many mice per second`;
    case "clickFlat":
      return `+${hl(fmt(e.add))} per pet`;
    case "clickShare":
      return `+${hl(e.pct + "%")} of your /s per pet`;
    case "clickMult":
      return `Petting is ${hl(multWord(e.mult))} as strong`;
    case "goldenFreq":
      return Number.isInteger(e.mult)
        ? `Golden mice appear ${hl(multWord(e.mult))} as often`
        : `Golden mice appear ${hl(Math.round((e.mult - 1) * 100) + "%")} more often`;
    case "goldenLife":
      return `Golden mice linger +${hl(e.add + "s")} longer`;
    case "zoomMult":
      return `Zoomies pet ${hl("+×" + e.add)} harder`;
    case "zoomTime":
      return `Zoomies lasts +${hl(e.add + "s")} longer`;
    // Everything below this line is reachable only with `reveal` — the dev dump.
    // Written out rather than left to the ??? because it is the authoritative
    // statement of what each wall row does, and the debug table is where that
    // gets checked.
    //
    // Must print e.add: the sleep stages differ ONLY in trail length, so a
    // constant string renders all four Lucid Dreaming rungs identically.
    case "trail":
      return `Wall mice leave ${hl("+" + e.add)} more trail`;
    case "neon":
      return `The lights on the wall turn out to be mice`;
    case "persist":
      return `The trails stop fading`;
    case "speed":
      return `Wall mice move quicker`;
    case "lantern":
      return `The wall lights up`;
    case "pace":
      return `The wall mice pick up ${hl(e.add + "/" + WALL.paceSteps)} of their pace`;
    // THE twist: the one row whose description is a QUESTION — naming the
    // mechanic would spend the reveal a purchase early.
    case "night":
      return `What is Hex dreaming about?`;
    case "crossBuilding":
      return `${buildingName(e.building)} gains +${hl(e.pct + "%")} per ${buildingName(e.per)}`;
    case "clickPerBuilding":
      return `+${hl(fmt(e.add))} per pet for every ${buildingName(e.per)}`;
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// SHOP RENDER
// ---------------------------------------------------------------------------
// How often one of these earns a mouse, in words, from the rate the engine
// will actually pay: mps x INCOME_SCALE. "second" rather than "1 second" when
// it lands on the nose.
function everyText(b) {
  const secs = 1 / (b.mps * INCOME_SCALE);
  return Math.abs(secs - 1) < 0.005 ? "second" : `${fmt(secs)} seconds`;
}

let shopRows = [];
export function buildShop() {
  shopEl.innerHTML = "";
  shopRows = BUILDINGS.map((b, i) => {
    const el = document.createElement("button");
    el.className = "item";
    // Both the ??? and the real name live in the DOM permanently; the row's
    // `locked` class picks which one shows. Price is deliberately NOT masked —
    // it's the tease.
    el.innerHTML = `<div class="icon"><span class="ic">${b.icon}</span><span class="icLocked">?</span></div>
       <div class="body">
         <div class="lockedNm">???</div>
         <div class="titleRow">
           <div class="nm">${b.name}</div>
         </div>
         ${b.blurb ? `<div class="fx">${b.blurb.replace("{every}", everyText(b))}</div>` : ""}
         <div class="cost">${currencyIconSVG()}<span class="costNum"></span></div>
       </div>
       <div class="right"><div class="rate"></div><div class="own">0</div></div>`;
    el.addEventListener("click", () => buy(i));
    shopEl.appendChild(el);
    return {
      el,
      can: null,
      locked: null,
      gone: null,
      ownN: null,
      bought: null,
      rateEach: null,
      rate: el.querySelector(".rate"),
      cost: el.querySelector(".cost"),
      costNum: el.querySelector(".costNum"),
      own: el.querySelector(".own"),
    };
  });
}

// Cookie Clicker shows 2 teasers past your frontier; we show 1 — with five
// buildings, 2 would put a permanent ??? on the lab for most of a run.
const TEASE_WINDOW = 1;

export function refreshShop() {
  let lockedRun = 0,
    anyRevealed = false;
  for (let i = 0; i < BUILDINGS.length; i++) {
    const b = BUILDINGS[i],
      r = shopRows[i],
      owned = game.owned[b.id];

    // Night buildings don't exist during the day, and vice versa — no row, no
    // tease, and no effect on the phase's lockedRun counting.
    if ((b.night && !nightActive()) || (!b.night && nightActive())) {
      if (r.gone !== true) {
        r.el.classList.add("gone");
        r.gone = true;
      }
      continue;
    }

    const revealed = isRevealed(b, game);

    if (revealed) {
      anyRevealed = true;
      lockedRun = 0;
    } else lockedRun++;
    const gone = lockedRun > TEASE_WINDOW;

    const price = costOf(b, owned);
    const affordable = revealed && game.mice >= price;

    const locked = !revealed;
    // The quoted rate moves when nothing else about the row does: buying an
    // UPGRADE leaves both `owned` and `locked` alone.
    const rateEach = buildingMpsWith(mods, b);
    const textStale =
      r.ownN !== owned || r.locked !== locked || r.rateEach !== rateEach;

    if (r.gone !== gone) {
      r.el.classList.toggle("gone", gone);
      r.gone = gone;
    }
    if (gone) continue;
    if (r.locked !== locked) {
      r.el.classList.toggle("locked", locked);
      r.locked = locked;
    }
    if (r.can !== affordable) {
      r.el.classList.toggle("can", affordable);
      r.can = affordable;
    }
    const bought = owned > 0;
    if (r.bought !== bought) {
      r.el.classList.toggle("bought", bought);
      r.bought = bought;
    }

    // Every string below is a pure function of (owned, revealed) — written on
    // change, never on the 12fps tick (these rows sit inside a backdrop-
    // filter'd #dock, where invalidating content forces the blur to
    // re-composite).
    if (textStale) {
      r.ownN = owned;
      r.rateEach = rateEach;
      // A zero price renders as the word — the free first Hole is a beat.
      r.costNum.textContent = price === 0 ? "free" : fmt(price);
      if (revealed) {
        r.own.textContent = owned;
        // Cookie Clicker's two tooltip lines, split by whether you own any:
        // both quote the post-research rate, so the rows sum to the HUD.
        r.rate.innerHTML =
          owned > 0
            ? `${currencyIconSVG()}${fmt(rateEach * owned)}/s`
            : `+${currencyIconSVG()}${fmt(rateEach)}/s each`;
      }
    }
    r.cost.classList.toggle("no", !affordable);
  }

  // Revealed is keyed to lifetime mice, which only grows — flips on and stays.
  buildingSecEl.classList.toggle("show", anyRevealed);
  syncDock();
}

function buy(i) {
  const b = BUILDINGS[i];
  if (!isRevealed(b, game)) return;
  const price = costOf(b, game.owned[b.id]);
  if (game.mice < price) return;
  // Intent only — the purchase lands in the next snapshot (a LAN round-trip,
  // under a frame at 60fps), and refreshShop redraws from it.
  transport.send({ type: "buyBuilding", id: b.id });
}

// ---------------------------------------------------------------------------
// UPGRADE SHOP — rows are rebuilt only when the visible SET changes (an unlock
// or a purchase), not per frame; affordability restyles in place.
// ---------------------------------------------------------------------------
let upRows = new Map(); // key -> {el, cost}
let upSig = "";
export function refreshUpgrades() {
  // FROZEN WHILE THE SHOP IS SHUTTING: the purchase that sells out the shop
  // also empties this list, and the two happen in the same frame — held here,
  // the row you just bought stays put and the whole thing shuts as one piece.
  if (shopClosePhase === "closing") return;
  // At night the day research is off the rail entirely (see onRailInPhase).
  const shown = UPGRADES.filter(
    (u) => !game.bought[u.key] && isUnlocked(u) && onRailInPhase(u),
  );
  const sig = shown.map((u) => u.key).join(",");

  if (sig !== upSig) {
    // While a purchase burst is in flight, hold the shop's scroll position
    // against the BOTTOM of its content across this rebuild, so the building
    // rows never move under a tapping thumb. ONLY during a tap burst — an
    // always-on hold walks the scroller to the end on idle reveals. (See the
    // prototype's long note for the full reasoning.)
    const hold = performance.now() - lastShopTapAt < SHOP_HOLD_MS;
    const fromBottom = hold
      ? shopScrollEl.scrollHeight - shopScrollEl.scrollTop
      : 0;
    upSig = sig;
    upgradesEl.innerHTML = "";
    upRows = new Map();
    for (const u of shown) {
      const el = document.createElement("button");
      el.className = CRUX_KEYS.has(u.key) ? "item up crux" : "item up";
      el.innerHTML = `<div class="icon">${u.icon}</div>
         <div class="body">
           <div class="nm">${u.name}</div>
           <div class="fx">${effectText(u)}</div>
           <div class="cost">${currencyIconSVG()}<span class="costNum">${fmt(u.cost)}</span></div>
         </div>`;
      el.addEventListener("click", () => buyUpgrade(u.key));
      upgradesEl.appendChild(el);
      upRows.set(u.key, { el, cost: el.querySelector(".cost") });
    }
    upgradeSecEl.classList.toggle("show", shown.length > 0);
    syncDock();
    if (hold) {
      programmaticScroll = true;
      shopScrollEl.scrollTop = shopScrollEl.scrollHeight - fromBottom;
      requestAnimationFrame(() => {
        programmaticScroll = false;
      });
    }
    refreshBadge();
  }

  for (const u of shown) {
    const r = upRows.get(u.key);
    const affordable = game.mice >= u.cost;
    r.el.classList.toggle("can", affordable);
    r.cost.classList.toggle("no", !affordable);
  }
}

function buyUpgrade(key) {
  const u = UPGRADES.find((x) => x.key === key);
  if (!u || game.bought[u.key] || !isUnlocked(u) || game.mice < u.cost) return;
  // Intent only. The beats a purchase can fire — the night cutscene, the neon
  // flip, the shop close — ride the snapshot's edges (see main.js), so they
  // play on every phone in the room, not just the one that pressed the button.
  transport.send({ type: "buyUpgrade", key });
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const cpsValEl = cpsEl.querySelector("b");
export function refreshHud() {
  // The bank is a whole number of mice: Math.floor, not fmt(n, 0) — toFixed
  // ROUNDS, and you must never claim a bank you cannot spend.
  countEl.textContent = fmt(Math.floor(game.mice));
  // The headline rate is a whole number; fmt keeps decimals for prices and
  // per-building rates everywhere else.
  cpsValEl.textContent = fmt(baseCps(), 0);
}

// ---------------------------------------------------------------------------
// CLOSING THE SHOP, once and for the rest of the run — fired off the sold-out
// edge. Three beats: the tray eases shut, the rail relabels SOLD OUT and
// holds, then the dock leaves (the night's finale is reading the wall, and
// #dock is a blurred band across the bottom of it).
// ---------------------------------------------------------------------------
// #shopScroll's max-height transition — must equal --tap-ms in index.html, which
// the tray shares with the caret. The sold-out beat hands off to the sign only
// once the tray has finished shutting, so a mismatch here either relabels the
// rail over a tray still in motion or leaves a dead beat after it lands.
const SHOP_CLOSE_MS = 220;
const SHOP_SIGN_MS = 1800; // how long the closed sign holds before the dock leaves
const SHOP_OUT_MS = 500; // the dockOut animation
// Bumped by every start and every abandonment of the beat, so an orphaned
// stage can't land on a shop that has moved on (a proctor reset mid-beat).
let shopCloseGen = 0;
// The rail stops being an expandable region and becomes a sign — shared by
// the closing beat's first frame and the rejoin path's instant retire.
function disableRail() {
  shopToggleEl.disabled = true;
  shopToggleEl.removeAttribute("aria-expanded");
  shopToggleEl.removeAttribute("aria-controls");
  shopToggleEl.setAttribute("aria-label", "Shop sold out — nothing left to buy");
}

export function runShopClose() {
  if (shopClosePhase) return;
  shopClosePhase = "closing";
  const gen = ++shopCloseGen;
  // Disabled from the first frame: the rail is a live control right up to
  // here, and a tap landing during the close would collapse the dock out from
  // under its own animation.
  disableRail();
  // `.dock-in` is a spent one-shot and would win the cascade over .dock-out.
  dockEl.classList.remove("dock-in");
  dockEl.classList.add("closing");
  setTimeout(() => {
    if (gen !== shopCloseGen) return;
    shopClosePhase = "sign";
    dockEl.classList.remove("closing");
    dockEl.classList.add("sold-out");
    // The list has been frozen through the collapse; flush it now.
    refreshUpgrades();
    setTimeout(() => {
      if (gen !== shopCloseGen) return;
      dockEl.classList.add("dock-out");
      setTimeout(() => {
        if (gen === shopCloseGen) retireShop();
      }, SHOP_OUT_MS);
    }, SHOP_SIGN_MS);
  }, SHOP_CLOSE_MS);
}

// The terminal state, and the one syncDock jumps straight to for a rejoin that
// was already sold out when it landed. Idempotent.
export function retireShop() {
  shopClosePhase = "retired";
  shopCloseGen++;
  dockEl.classList.remove("closing", "dock-out", "collapsed", "dock-in", "show");
  dockEl.classList.add("sold-out", "retired");
  disableRail();
}

// Un-closing, reached only by a proctor reset (real play never un-buys).
export function reopenShop() {
  shopClosePhase = null;
  shopCloseGen++; // orphans any stage of the beat still queued
  dockEl.classList.remove("closing", "sold-out", "dock-out", "retired");
  shopToggleEl.disabled = false;
  shopToggleEl.setAttribute(
    "aria-expanded",
    String(!dockEl.classList.contains("collapsed")),
  );
  shopToggleEl.setAttribute("aria-controls", "shopScroll");
  shopToggleEl.setAttribute("aria-label", "Shop");
}

// ---------------------------------------------------------------------------
// SHOP SKIN RUNTIME — scroll shadows + the seen/badge poll.
// ---------------------------------------------------------------------------
export function initShopSkin() {
  const scrollers = [shopScrollEl];
  function updAff(el) {
    el.classList.toggle("can-up", el.scrollTop > 1);
    el.classList.toggle(
      "can-down",
      el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    );
  }
  // Mark upgrade rows seen: the row's MIDPOINT is inside the visible box, AND
  // the player has SCROLLED the shop in the last second. A row that scrolls
  // into view has been looked at; a row that appears under your eyes while
  // they are on the cat has not. (See the prototype's long note.)
  function updSeen() {
    // A shop that fits needs no scrolling — every row is in front of you.
    const fits = shopScrollEl.scrollHeight <= shopScrollEl.clientHeight + 1;
    if (!fits && performance.now() - lastShopLookAt > SHOP_LOOK_MS) return;
    const box = shopScrollEl.getBoundingClientRect();
    let changed = false;
    for (const [key, r] of upRows) {
      if (game.seen[key]) continue;
      const b = r.el.getBoundingClientRect();
      if (b.height <= 0) continue;
      const mid = b.top + b.height / 2;
      if (mid >= box.top && mid <= box.bottom) {
        game.seen[key] = 1;
        changed = true;
      }
    }
    if (changed) refreshBadge();
  }
  function tick() {
    scrollers.forEach(updAff);
    updSeen();
  }
  scrollers.forEach((el) =>
    el.addEventListener(
      "scroll",
      () => {
        // A scroll the player performed is the "looking at it" signal; the
        // hold's own write is not.
        if (!programmaticScroll) lastShopLookAt = performance.now();
        updAff(el);
        updSeen();
      },
      { passive: true },
    ),
  );
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(tick);
    ro.observe(dockEl);
  }
  addEventListener("resize", tick);
  setInterval(tick, 300);
  tick();
}
