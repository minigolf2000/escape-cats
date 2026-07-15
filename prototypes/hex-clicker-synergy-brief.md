# Hex Clicker — cross-building synergy upgrades

Implementation brief for two upgrades: **Assisted Pounce** and **Thesis Subjects**.
Self-contained — you don't need the thread this came from. Target file:
[`hex-clicker.html`](./hex-clicker.html) (single file, no build step, open it in a
browser).

## Context

`hex-clicker.html` has ~15 upgrades driven by a flat `UPGRADES` table and a typed
effect union (`buildingMult`, `globalPct`, `clickFlat`, `clickShare`, `clickMult`,
`goldenFreq`, `trail`, `night`), folded into a `mods` object by `recalc()`.

**Every effect that exists today is static** — it depends only on *which upgrades
you've bought*. These are the first two effects that depend on **how many buildings
you own**, which the current design does not anticipate. That's the main risk; see §1.

Both follow Cookie Clicker's `GrandmaSynergy` pattern (§2b), whose real design job is
**re-relevance**: the cheapest building dies as the `1.15^n` cost curve outruns its
output, and the synergy drags it back into play for a window. Our Robo-Cat (0.1 mps)
has exactly that problem, and is the subject of both upgrades.

Buildings, for reference (`BUILDINGS` in the file):

| id | name | base | mps |
|---|---|---|---|
| `robocat` | Robo-Cat | 15 | 0.1 |
| `farm` | Neon Mouse Farm | 100 | 1 |
| `quarry` | Mouse Quarry | 1,100 | 8 |
| `factory` | Mouse Factory | 12,000 | 47 |
| `lab` | Schrödinger Lab | 130,000 | 260 |

> **On the Cookie Clicker citations below:** they were read from the live game's
> `main.js` (v2.05x, unminified, via the unofficial `ozh/cookieclicker` mirror), not
> recalled. Cookie Clicker is **not** open source — no license, Orteil retains
> copyright. Mechanics aren't copyrightable but code and flavor text are, so we port
> the *math* and write our own words. Don't paste their names or descriptions in.

---

## 1. Read this first: the trap that fails silently

`buy()` (building purchase) does **not** call `recalc()`:

```js
function buy(i) {
  ...
  game.owned[b.id] += 1;
  refreshHud(); refreshShop(); refreshUpgrades(); save();   // <-- no recalc()
}
```

Correct today, because no effect reads `game.owned`. **Wrong the moment either new
effect exists**: the bonus freezes at its value when the upgrade was bought, and
buying more Robo-Cats does nothing. The game looks completely fine and the number is
just wrong. **Add `recalc()` to `buy()`.**

Rejected alternative: computing the cross terms dynamically inside `baseCps()` /
`clickGain()`. It avoids the recalc, but then `mods.building[id]` stops being the
whole multiplier for a building — the property that makes the current code easy to
reason about. `recalc()` over ~17 upgrades is trivially cheap; call it eagerly.

---

## 2. What Cookie Clicker actually does

There are exactly two cross-building patterns, and they're structurally different.
**We're copying the second.**

### 2a. `Game.SynergyUpgrade(name, desc, b1, b2, tier)` — `main.js:10167`

The generic one. Auto-swaps so `b1` is the cheaper building:

```js
if (b1.basePrice>b2.basePrice) {b1=Game.Objects[building2];b2=Game.Objects[building1];}
```

- **Price:** `(b1.basePrice*10 + b2.basePrice*1) * Game.Tiers[tier].price`
- **Effect — asymmetric by 50×** (`GetTieredCpsMult`, `main.js:10207-10214`):
  ```js
  if (syn.buildingTie1.name==me.name) mult*=(1+0.05*syn.buildingTie2.amount);      // cheaper: +5%   per pricier owned
  else if (syn.buildingTie2.name==me.name) mult*=(1+0.001*syn.buildingTie1.amount); // pricier: +0.1% per cheaper owned
  ```
  That asymmetry is the balancing trick: you own hundreds of the cheap thing and a
  handful of the pricey one, so both terms land in the same ballpark.
- **Unlock — 3-way conjunction** (`main.js:10225`): own the `Synergies Vol. I`
  upgrade **and** ≥15 of *each* building.
- Examples: `Future almanacs` (Farm×Time machine), `Quantum electronics`
  (Factory×Antimatter condenser).

**Not what we want:** a generic cross-product with a joke pasted on. No fiction of one
building *going to work in* another.

### 2b. `Game.GrandmaSynergy(name, desc, building)` — `main.js:10328` ← **this one**

The story-beat pattern. Grandmas take a *job* in another building and the name is the
punchline (`Farmer grandmas`, `Worker grandmas` — "A nice worker to manufacture more
cookies").

- **Price:** `building.basePrice * Game.Tiers[2].price` = **basePrice × 50**.
- **Effect — dual:**
  1. **Grandmas ×2** (`Grandma.cps`, `main.js:9046`):
     `for (var i in Game.GrandmaSynergies) { if (Game.Has(...)) mult*=2; }` — all 7
     stack → ×128.
  2. **Host gains per grandma** (`main.js:10217`):
     ```js
     if (me.grandma && Game.Has(me.grandma.name)) mult*=(1+Game.Objects['Grandma'].amount*0.01*(1/(me.id-1)));
     ```
     i.e. **+1%/(id−1) per grandma** — Farm +1%, Mine +0.5%, Factory +0.333%. The
     divisor weakens the bonus further up the ladder, normalising against the fact
     that higher buildings already produce far more.
- **Unlock — asymmetric** (`main.js:9111`, `SpecialGrandmaUnlock=15` at `main.js:9022`):
  own **15 of the host** and merely **≥1 grandma**.

### 2c. Why only Robo-Cat and Farm can be synergy subjects

A synergy only changes behavior when the synergy term dwarfs the subject's **own
mps** — otherwise you'd buy the subject anyway and the bonus is a garnish. Measured
at `pct: 1`, host count 10:

| subject → host | host/subject cost | synergy gain vs own gain |
|---|---|---|
| robocat → lab | 8,667× | **65×** |
| robocat → factory | 800× | **23.5×** |
| farm → lab | 1,300× | 6.5× |
| farm → factory | 120× | 2.4× |
| quarry → factory | 11× | **0.3×** (garnish) |
| factory → lab | 11× | 0.1× (garnish) |

Quarry (8 mps) and Factory (47 mps) are too productive to be revived by a cross-boost,
and raising `pct` doesn't rescue them — Quarry→Factory needs ~+10% per quarry to fork,
which would make Factory ×3.5 and distort everything else. **Future synergies should
use `robocat` or `farm` as the subject**, or be authored knowingly as flavor.

---

## 3. Changes — all in `hex-clicker.html`

**a. `buy()`** — add `recalc()` before the refresh calls. (§1)

**b. Allow `effect` to be an array.** Thesis Subjects is inherently dual (Robo-Cats ×2
**and** Lab +1%/Robo-Cat), and rows carry one `effect`. Normalise with
`[].concat(u.effect)` — backward compatible, no existing row changes. **Three sites,
two easy to miss:**

1. `recalc()` — the fold: `for (const e of [].concat(u.effect)) { ... }`
2. **`effectText()`** — currently `const e = u.effect; switch (e.type)`. With an array
   `e.type` is `undefined` and it returns `""`, so **Thesis Subjects renders with
   blank effect text**. Map over the array and join (e.g. `" · "`).
3. `buyUpgrade()` — has `if (u.effect.type === "night") enterNight();`. Night upgrades
   stay singular so it won't break today, but it's a latent trap. Normalise
   defensively.

**c. New effect type `crossBuilding`** in `recalc()`:

```js
else if (e.type === "crossBuilding") mods.building[e.building] *= (1 + (e.pct / 100) * game.owned[e.per]);
```

One-directional by design — that's `GrandmaSynergy` (§2b). The ×2 half reuses the
existing `buildingMult`; no new machinery.

**d. New effect type `clickPerBuilding`** in `recalc()`:

```js
else if (e.type === "clickPerBuilding") mods.clickFlat += e.add * game.owned[e.per];
```

This is Cookie Clicker's `Thousand fingers` (`add += 0.1` per non-cursor building,
`main.js:8979`). `mods.clickFlat` is seeded from `CLICK_BASE`, so this adds on top of
the existing flat-click upgrades — order within `recalc()` doesn't matter, they're all
additive.

**e. `effectText()`** — cases for both:
- `crossBuilding` → `"Schrödinger Lab gains +1% per Robo-Cat"`
- `clickPerBuilding` → `"+0.5 per pet for every Robo-Cat"`

**f. `isUnlocked()`** — accept a conjunction of `owned` pairs (currently one pair).
Backward compatible:

```js
if (c.owned) {
  const pairs = typeof c.owned[0] === "string" ? [c.owned] : c.owned;
  for (const [id, n] of pairs) if (game.owned[id] < n) return false;
}
```

---

## 4. The rows

```js
{ key: "assistedpounce", name: "Assisted Pounce", icon: "🎯",
  cost: 25000,
  unlock: { owned: ["robocat", 25] },
  effect: { type: "clickPerBuilding", per: "robocat", add: 0.5 } },
```
Blurb: *"The Robo-Cats line up the shot. You just supply the enthusiasm."*

```js
{ key: "thesissubjects", name: "Thesis Subjects", icon: "📦",
  cost: 300000,
  unlock: { owned: [["lab", 1], ["robocat", 25]] },
  effect: [
    { type: "buildingMult",  building: "robocat", mult: 2 },
    { type: "crossBuilding", building: "lab", per: "robocat", pct: 1 },
  ] },
```
Blurb: *"The Robo-Cats volunteered for the box. They are now simultaneously employed
and unemployed."*

`assistedpounce` needs neither the effect-array nor the unlock-conjunction work — it's
the simpler of the two and a good first landing.

---

## 5. Where the numbers came from (computed, not guessed)

**Thesis Subjects, `pct: 1`.** The fork survives on a single Lab — which is why the
unlock is `lab >= 1` and not Cookie Clicker's `>= 15`:

| Labs owned | synergy gain | vs Robo-Cat's own 0.2/s | Lab bonus at 40 Robo-Cats |
|---|---|---|---|
| 1 | 2.60/s | **13× dominant** | +40% (+104/s) |
| 2 | 5.20/s | 26× | +40% (+208/s) |
| 3 | 7.80/s | 39× | +40% (+312/s) |

"Dominant" = the synergy term is 13× the Robo-Cat's own output, i.e. you buy Robo-Cats
*for the synergy*. At `pct: 0.5` it collapses toward a flat bonus you never act on —
and note `0.5` is exactly what Cookie Clicker's `1/(id-1)` divisor would give, because
that divisor is tuned for a 20-building, weeks-long game.

**Thesis Subjects, `cost: 300000` — deliberately breaks Cookie Clicker's rule.** CC
prices GrandmaSynergy at `host.basePrice × 50`, which for the Lab is **6.5M**, versus
our priciest existing upgrade at 1.4M. That rule assumes you already own ~15 of the
host; we unlock at 1. 300k is a guess anchored to "you just spent 130k on a Lab" —
**tune it.**

**Assisted Pounce, `add: 0.5`.** Baseline flat click is 7 (1 base + 1 whiskers + 5
clawsharp):

| Robo-Cats | bonus | flat click becomes |
|---|---|---|
| 25 (at unlock) | +12.5/pet | 19.5 |
| 40 | +20/pet | 27 |
| 80 | +40/pet | 47 |

**It does not fork, and shouldn't.** At 3 pets/sec a Robo-Cat is worth ~1.6/s → ~2,500 s
payback, worse than just buying buildings. Its job is different: keep petting (the
thing the player physically does) from dying out. Judge it on feel, not payback.

> ⚠️ **Everything in §4–§5 is unplaytested.** Biggest risk: **does a ~10-minute run
> reach a Lab at all** (base 130,000)? If not, Thesis Subjects is dead content no
> matter how good the joke is — fallback is re-hosting it on the Factory (base
> 12,000), which still forks at 23.5×. Answer that from a real playthrough before
> tuning anything else. The file has a `?debug` dev panel.

---

## 6. Verification

Drive the real game in the browser; don't trust §5.

1. Open the file in the browser pane. Console must be clean.
2. **The §1 regression, explicitly** — the one that looks correct while being wrong:
   ```js
   game.owned.robocat = 25; game.owned.lab = 1; game.mice = 1e9;
   recalc(); refreshUpgrades(); buyUpgrade("thesissubjects");
   const before = mods.building.lab;   // expect 1.25
   buy(0);                             // one more robocat
   [before, mods.building.lab]         // MUST differ (1.25 -> 1.26)
   ```
   Same shape for `assistedpounce`: `mods.clickFlat` must move when a Robo-Cat is bought.
3. Formulas at several counts: 25 rc → lab ×1.25, 40 → ×1.40, 100 → ×2.00. And
   `clickFlat` = 7 + 0.5×rc with the standard click upgrades owned.
4. `buildingMult` ×2 composes: robocat effective mps 0.1 → 0.2 with Thesis Subjects.
5. **Effect text is not blank** for Thesis Subjects — the §3b(2) trap.
6. Unlock conjunction: 25 rc + 0 lab must **not** unlock; 24 rc + 1 lab must not;
   25 rc + 1 lab must.
7. Save round-trip: `save()`, clear in-memory state, `load(); recalc()` — both
   modifiers must re-derive identically (computed from `owned`, never persisted).
8. Regression on existing rows (the `[].concat` touches every row's path): re-check one
   `buildingMult`, one `globalPct`, and a `night` upgrade if present.

**Test hygiene:** the 8-second autosave rewrites stale state back to localStorage and
will contaminate a reload — it burned an earlier session. Reset in memory and call
`save()` rather than clearing localStorage and reloading.

**Screenshots:** `computer {action:"screenshot"}` has been unreliable against this
`file://` page (repeated timeouts). Verify via `read_page` / computed styles /
`javascript_tool` instead — it's stronger evidence for math anyway.

---

## 7. Open questions

1. **Does a 10-minute run reach one Lab?** Decides whether Thesis Subjects ships as
   written or re-hosts onto the Factory. Highest priority.
2. Live bonus text on the Lab's shop row (`"+40% from Robo-Cats"`) — the number
   climbing *is* the mechanic, but is it noise on a 375px screen? Ship static first.
3. Is `×2 Robo-Cat` meaningful or pure flavor? At 0.1→0.2 mps it's small; it's in
   because it's the `GrandmaSynergy` pattern and it feeds the fork slightly.
