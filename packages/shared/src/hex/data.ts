// The Hex Clicker economy: every building, upgrade, and dial, moved verbatim
// (tuning comments included — they are the balance documentation) from the
// single-player prototype at hex/index.html, which is now a frozen reference.
// This file is the ONE place balance lives: the PartyKit server, the
// multiplayer client, and the client's ?solo mode all import it.

export interface HexBuilding {
  id: string;
  name: string;
  icon: string;
  base: number;
  mps: number;
  blurb?: string;
  /** Night buildings exist only after the twist; day buildings only before. */
  night?: boolean;
  /** Per-building cost growth; defaults to the shared GROWTH. */
  growth?: number;
  /** Copies priced at zero — shifts the curve down, first PAID copy costs base. */
  firstFree?: number;
}

export type HexEffect =
  | { type: "buildingMult"; building: string; mult: number }
  | { type: "globalPct"; pct: number }
  | { type: "globalMult"; mult: number }
  | { type: "clickFlat"; add: number }
  | { type: "clickShare"; pct: number }
  | { type: "clickMult"; mult: number }
  | { type: "goldenFreq"; mult: number }
  | { type: "goldenLife"; add: number }
  | { type: "zoomMult"; add: number }
  | { type: "zoomTime"; add: number }
  | { type: "trail"; add: number }
  | { type: "neon" }
  | { type: "persist"; add: number }
  | { type: "speed"; add: number }
  | { type: "night" }
  | { type: "crossBuilding"; building: string; per: string; pct: number }
  | { type: "clickPerBuilding"; add: number; per: string };

export interface HexUnlock {
  /** One [buildingId, n] pair or an array of them (AND-ed). */
  owned?: [string, number] | [string, number][];
  total?: number;
  clicks?: number;
  golden?: number;
  requires?: string;
}

export interface HexUpgrade {
  key: string;
  name: string;
  icon: string;
  cost: number;
  unlock: HexUnlock;
  effect: HexEffect | HexEffect[];
}

// ---------------------------------------------------------------------------
// BALANCE — the whole economy lives here. Base cost & mps mirror Cookie
// Clicker's first five buildings (Cursor/Grandma/Farm/Mine/Factory) so the
// pacing is a known-good starting point. All OPEN for tuning (see design doc).
// cost(n owned) = baseCost * 1.15^n   |   income = mps * count
// ---------------------------------------------------------------------------
export const GROWTH = 1.15;
export const BUILDINGS: HexBuilding[] = [
  // The ONLY building with a blurb, and deliberately so: it's the first thing on
  // the shelf, so its .fx line is where a new player learns what "owning a
  // building" even means. Every other building inherits that lesson and gets by
  // on its name — see the .item .titleRow note for why the rest stay bare.
  //
  // {every} is substituted with the rate this building ACTUALLY earns, and the
  // token is the whole point. The blurb used to hand-write "every 2.5 seconds",
  // which is 1/mps straight off this column, and it was wrong from the moment
  // INCOME_SCALE arrived — the real rate is mps x INCOME_SCALE, and the row
  // printed that correct figure right beside the incorrect prose. Deriving it
  // (see everyText) means the two cannot disagree again whichever dial moves.
  //
  // Budget is 21 characters AFTER substitution, measured: .fx has the quoted
  // rate beside it, so 22+ wraps and the row grows to 97px against its
  // neighbours' 61px. "A mouse every second" is 20 and stays one line at an 80px
  // row. The old wrapping text is why this row used to be the tall one.
  { id: "shopper", name: "Mouse Subscription", icon: "🚚", base: 10,     mps: 0.4,
    blurb: "A mouse every {every}" },
  { id: "farm",    name: "Mouse Farm",      icon: "🌾", base: 100,    mps: 1   },
  // base 10000 and 85 mps, both tuned against the same failure. The mps column
  // mirrors Cookie Clicker's first
  // buildings, but the COST column doesn't: CC steps 15 → 100 → 1,100 → 12,000,
  // roughly ten-fold each, and ours steps 10 → 100 → 12,000 because the rung
  // between Farm and Factory (the old Quarry) was cut. That leaves the Farm a
  // hundred times cheaper than CC's at the same mps, so a Farm stays a better
  // buy than a Factory essentially forever: at CC's 47 the sim's bot bought 35
  // farms and ZERO factories, taking the whole Factory ladder and the Cardboard
  // line down with it. 85 restores the intended shape — cost-per-mps 141 against
  // the Farm's 100, close enough that the Factory is what you graduate TO once
  // farms get expensive, which is the job the missing rung used to do. It is a
  // The BASE came down from 12000 for the same reason, once the Factory ladder
  // lost two of its five rungs: a shorter ladder tops out lower, so the building
  // has to be cheaper to stock or the bot goes back to buying farms forever. At
  // 8000 it overshot the other way — factories crowded farms out and the Farm's
  // top rungs went unreachable instead. 10000 is the measured middle.
  //
  // It is a NARROW band, so re-measure if it moves: at 70 the bot still bought zero
  // factories, at 130 it bought almost nothing else.
  { id: "factory", name: "Mouse Factory",   icon: "🏭", base: 10000,  mps: 120 },
  // The one day building that keeps producing after the night reset (see
  // baseCpsWith) — the design's "the Lab is still present" in the dream.
  //
  // It is also, now, the DOOR OUT OF PHASE 1: Catnap Hypnalysis unlocks on owning
  // one. That makes its old numbers untenable. At 260 mps it was the worst
  // cost-per-mps on the rail by a factor of two and had no upgrades of its own to
  // fix that, so buying one was a straight penalty — fine when it was scenery,
  // hostile when it's the gate. 400 mps still loses the marginal comparison to a
  // Factory or a Farm carrying its upgrade stack, and that is correct: you buy
  // the Lab for what it OPENS — four cross-building upgrades, and the twist —
  // not because the arithmetic says to. It just shouldn't punish you for it.
  // Knock-on: Labs keep earning at night, so day Labs now bootstrap the dream
  // harder than the seed holes below. Watch that in the sim if this moves again.
  { id: "lab",     name: "Schrödinger's Lab",  icon: "🔬", base: 130000, mps: 400 },
  // ---- Night buildings: DREAM is the mechanism, SPACE is the secret ----------
  // The old set was Dimensional Mouse Hole / Chrono Cattelite Courier /
  // Constellation Cattery / Singularity Scratcher, which handed the answer away for
  // free: a team reads "constellation" and "singularity" off the shop rail before
  // earning anything, and the wall's whole job is to make that space imagery an
  // EARNED clue. So the buildings are dream-native now and every space reference
  // lives behind the reveal.
  //
  // They also escalate rather than just scaling: a place -> a device -> a
  // phenomenon -> a recursion, which is how dreams actually get stranger.
  //
  // Tiers reveal on lifetime >= base, exactly as they do in the day. They used to be
  // gated behind research that unlocked nothing but the right to buy them, which is
  // buying a recipe rather than buying a thing — not a mechanic this game has.
  //
  // THE SPACING IS THE PACING, now that nothing gates these. What decides when a tier
  // is worth buying is not its price but its COST PER MPS against the tier below: tier
  // n+1 only wins the marginal comparison once tier n's own curve has climbed past the
  // ratio between them. So that ratio is the dial, and it is 4 → 20 → 50 → 200.
  //
  // The ratio has to GROW, not just be large, or the arrivals bunch up rather than
  // spreading out. Income compounds, so a constant ratio buys less and less waiting each
  // time: at a flat x8 per tier the measured arrivals were 0:00, 0:14, 1:34, 2:21 — gaps
  // of 14s, 80s, then 47s, the last one SHORTER than the one before. Escalating the
  // ratio (x5, x2.5, x4 here) turns that into 0:00, 0:23, 1:11, 1:52 — a tier for every
  // third of the night instead of three of them inside the first forty seconds.
  //
  // The last gap does not keep growing, and that is a ceiling rather than a miss: Dream
  // Within a Dream is chased by Scent Trail's ownership gate the moment it is REVEALED, so
  // its arrival is set by `total >= base` and not by the marginal comparison at all.
  // Pushing its base from 2.88M to 8.64M moved the arrival by twelve seconds and added
  // two and a half minutes of dead night behind it (cadence fell to 8 purchases per 30s
  // from 25). 2.88M is where the tier arrives late without the tail going quiet.
  //
  // Equal spacing was what the research gates had been hiding. At the same cost per mps
  // for all four, the curves interleave into an aggregate growing about 1% per purchase
  // and the bank refills faster than anyone can spend it: 96 purchases in the first 30
  // seconds and 2 per 30 seconds thereafter. The gates were staggering the tiers by
  // hand; the price ladder does it honestly.
  //
  // The cost of escalation is that the stretch BEFORE each arrival goes quiet — the
  // tier you own has priced itself out and the next is not affordable yet. That is what
  // `growth` below is holding open.
  //
  // PURCHASING IS NIGHT'S MASHING ACTION. Petting earns nothing once Hex is asleep,
  // so the repeated physical thing a player does has to become buying — which the
  // day curve actively prevents. Two numbers do that work, and both are deliberate:
  //
  //   growth 1.035, not 1.15. Cost climbs as growth^n while income from copies climbs
  //   linearly in n, so a steep curve means the gap between affordable purchases
  //   grows without bound. This is exactly what Cookie Clicker papers over with
  //   buy-10, which we do not want: the answer here is to flatten the curve so the
  //   next copy stays reachable instead of batching the taps.
  //
  //   It is also what keeps the escalating tier spacing above from costing cadence.
  //   Measured on the same ladder, 1.05 → 1.035 moves the purchase rate from 0.84/s
  //   to 1.25/s and the worst gap from 21.7s down: a shallower curve means the tier you
  //   already own is still buyable while you wait for the next one. The trade is that a
  //   player ends the night owning ~96 Holes rather than ~68.
  //
  //   base = 4x mps on the first tier. The ratio IS the gap between copies: one Hole
  //   earns mps * INCOME_SCALE, so a base of 33x meant 12 seconds of nothing before
  //   the second Hole. At 4x the first few land a fraction of a second apart.
  //
  // mps is 2x what it was before this pass. Measured against the pacing bot at 16
  // pets/s, night from the twist to a readable wall: 4:21 and 156 purchases before,
  // 3:07 and 233 after — the run is shorter AND has half again as much in it, which is
  // the whole point. Purchase rate 0.60/s to 1.25/s; worst gap 30.3s to 21.9s.
  //
  // The `id`s are save keys (see load()), so `spindle` and `delta` still carry the
  // names these rows used to have (Sleep Spindle, Delta Wave — dropped for being
  // accurate jargon that never joked). Do not "fix" the mismatch: renaming an id
  // silently wipes that building from every existing save.
  { id: "portal",  name: "Hole in the Wall",      icon: "🕳️", base: 480,     mps: 120,   night: true, growth: 1.035, firstFree: 1 },
  { id: "spindle", name: "Ball of String Theory", icon: "🧵", base: 9600,    mps: 480,   night: true, growth: 1.035 },
  { id: "delta",   name: "Slow Wave",             icon: "🌊", base: 120000,  mps: 2400,  night: true, growth: 1.035 },
  { id: "nested",  name: "Dream Within a Dream",  icon: "🌀", base: 2880000, mps: 14400, night: true, growth: 1.035 },
];
// The night opens on NOTHING: an empty bank, an empty wall, and one Hole in the Wall
// priced at zero. That free copy is the entire bootstrap — nothing but buildings earns
// once Hex is asleep, so something has to break a 0-income start, and the two candidates
// were a handful of mice up front or a copy that costs nothing.
//
// The bank was tried and gives the phase away: it opened on 1,600 mice already counted,
// which reads as a handout rather than a start, and lifetime counting the grant put the
// Hole past its reveal threshold before the player did anything. Zero is the honest
// version — the player opens the dream's first hole themselves, and every mouse on the
// wall after that is one they earned.
//
// Cost: the second Hole is 480 against the first one's 300/s, so 1.6s of waiting before
// the mashing starts. That is the same opening gap two free Holes used to buy at half
// the mps, and it is the price of the wall being empty at 0:00.
export const CLICK_BASE = 1;           // mice per pet before bonuses
export const CLICK_CPS_SHARE = 0.02;   // + this fraction of mps per pet (keeps petting alive)
// Zoomies, the golden-mouse buff (the mechanic itself lives with the golden
// mouse code further down). BASE values: upgrades raise both, so everything at
// runtime reads mods.zoomMult / mods.zoomTime, never these two directly.
export const ZOOM_MULT = 6;            // Zoomies: pets x6...
export const ZOOM_S = 7;               // ...for 7s
// Global income compression. The BUILDINGS mps column mirrors Cookie Clicker's
// first buildings, whose pacing targets a weeks-long IDLE game; this is a
// frantic ~7-min co-op for a team of 4. INCOME_SCALE multiplies all passive
// income (and, via clickShare, the pet-share term with it — so the click/idle
// balance is preserved). One dial, tune against playtests. Applied in
// baseCpsWith so the pacing simulator sees it for free.
//
// 2.5 rather than 2.7 for a reason that is about READING, not pacing: it makes
// the Mouse Subscription earn exactly 1.00/s (0.4 x 2.5), so the first thing on
// the shelf is "a mouse every second" and the shop opens on a round number
// instead of 1.08. Changing this therefore changes that row's blurb, which is
// derived from the same arithmetic — see everyText.
//
// Measured against the in-file sim at 2.5, whole run to the last night upgrade:
// 16 pets/s (a team of four mashing) 5:30, 10/s 6:14, 8/s 6:39, 3/s (solo) 8:19.
// This dial only moves the DAY: night's income is buildings alone, so its 3:07 is
// the same at every rate — the spread above is entirely how long the day takes to
// reach the twist. Read as ±20s, and do not chase a few seconds by moving this.
export const INCOME_SCALE = 2.5;

// ---------------------------------------------------------------------------
// UPGRADES — a flat authored list, no tier table. Cookie Clicker's tier system
// exists to compress a 20-buildings x 15-tiers cross-product; ours is 4x2, so
// there's nothing to compress and every field is written out longhand.
//
//   unlock: what makes it appear. Sticky once met. Kinds, all AND-ed:
//     owned: [buildingId, n]   total: n (lifetime mice)
//     clicks: n                golden: n (golden mice caught)
//     requires: "key"          (must own that upgrade)
//   effect: what it does. Folded into `mods` by recalc():
//     buildingMult  building, mult   — that building only
//     globalPct     pct              — all buildings, additive with each other
//     clickFlat     add              — flat mice per pet
//     clickShare    pct              — + % of your /s per pet
//     clickMult     mult             — multiplies the whole pet
//     goldenFreq    mult             — golden mice spawn this much sooner
//     goldenLife    add              — golden mice stay on screen this many more seconds
//     zoomMult      add              — Zoomies multiplies pets by this much more
//     zoomTime      add              — Zoomies lasts this many more seconds
//     trail         add              — night wall trail segments (the reveal ink)
//     night         (no fields)      — THE phase flip; handled in buyUpgrade
//
// There is NO flavor-text field, by design. Every description is derived from
// `effect` (see effectText) and states the mechanical effect and nothing else —
// Cookie Clicker's split, where the row tells you what you're buying and the
// NAME carries the joke. An `fx:` override used to exist and it replaced the
// derived line rather than joining it, so 27 of 45 rows showed no numbers at
// all. If a row isn't funny, rename it; don't add a field back.
//
// Thresholds and costs below are GUESSES — nothing here is playtested, and a
// 10-minute run is short enough that a threshold set too high is dead content
// you never see. Tune against a real playthrough. The lab has no upgrades on
// purpose: you don't own enough of it, late enough, for one to land.
// ---------------------------------------------------------------------------
export const UPGRADES: HexUpgrade[] = [
  // --- Mouse Subscription ---
  { key: "shopper1", name: "2-Day Shipping", icon: "🚚",
    cost: 200, unlock: { owned: ["shopper", 5] },
    effect: { type: "buildingMult", building: "shopper", mult: 2 } },
  { key: "shopper2", name: "Subscribe & Save", icon: "🔁",
    cost: 1800, unlock: { total: 3500, owned: ["shopper", 10] },
    effect: { type: "buildingMult", building: "shopper", mult: 2 } },
  // The subscription line's later tiers break from the flat ×2: each one cuts
  // deeper into the supply chain, so the mice-per-dollar gain grows. Liquidation
  // pallets (bulk, still through a middleman) → ×3; importing straight from the
  // factory (no middleman at all) → ×4, the deepest cut in the line.
  { key: "shopper3", name: "Wholesale Liquidation Pallets", icon: "🏷️",
    cost: 8000, unlock: { total: 15000, owned: ["shopper", 15] },
    effect: { type: "buildingMult", building: "shopper", mult: 3 } },
  { key: "shopper4", name: "Import Direct from Manufacturer", icon: "🚢",
    cost: 27000, unlock: { total: 50000, owned: ["shopper", 21] },
    effect: { type: "buildingMult", building: "shopper", mult: 4 } },

  // --- Mouse Farm ---
  // The day-game workhorse now that the Quarry is gone: a long ladder (base 100
  // to the Factory's 12000 is a wide gap with no building between them) so the
  // Farm carries that whole stretch on upgrades instead. Multipliers escalate
  // as the tech gets sillier — ×2 mechanical tweaks, ×3 precision/premium, ×4
  // full automation. Ascending so they reveal in sequence rather than all at
  // once. Five rungs, not six — Zoomie Tractors was a second flat ×2 sitting
  // between two others, so the rungs below it slid up into its slot rather than
  // leaving a hole at 16k. (Splice-Grown Mice used to live here too; it moved to
  // the lab tier below and is now Mice from Theory.)
  //
  // Owned thresholds are priced against what the day ACTUALLY buys, not a wish.
  // The old ladder asked for 75 and 100 Farms; the geometric curve puts 50 Farms
  // at ~722k mice, several times the entire day's spend, so its top three rungs
  // could never be revealed at all. A day now ends holding ~16-17 Farms (sim,
  // across 3-16 pets/s), so that is where the ladder tops out. These gates are
  // measured, not chosen — re-measure them whenever building mps moves.
  { key: "farmplow", name: "Sisal Scratching Plows", icon: "🧶",
    cost: 400, unlock: { total: 800, owned: ["farm", 3] },
    effect: { type: "buildingMult", building: "farm", mult: 2 } },
  { key: "farmfeliway", name: "Feliway Sprinklers", icon: "💨",
    cost: 2200, unlock: { total: 4000, owned: ["farm", 5] },
    effect: { type: "buildingMult", building: "farm", mult: 2 } },
  { key: "farmlaser", name: "Laser-Guided Planters", icon: "🎯",
    cost: 7200, unlock: { total: 13000, owned: ["farm", 7] },
    effect: { type: "buildingMult", building: "farm", mult: 3 } },
  { key: "farmchuru", name: "Churu Hydroponics", icon: "🍦",
    cost: 20000, unlock: { total: 37000, owned: ["farm", 9] },
    effect: { type: "buildingMult", building: "farm", mult: 3 } },
  { key: "farmdrone", name: "Autonomous Bug-Batting Drones", icon: "🚁",
    cost: 90000, unlock: { total: 165000, owned: ["farm", 11] },
    effect: { type: "buildingMult", building: "farm", mult: 4 } },

  // --- Mouse Factory ---
  // Same escalating ladder as the Farm (×2 mechanical → ×3 fancier → ×4 finale),
  // all cat-toy-flavoured factory kit. THREE rungs now, down from five: Laser
  // Chaser Assembly Belt was a duplicate flat ×2 and Bioluminescent Dip Vats sat
  // at 600k, past anything a day reaches. The survivors slid down into the
  // vacated slots and their multipliers grew to ×3/×4/×5, because a 3-rung ladder
  // multiplying to 60 cannot do the job the old 5-rung ×432 did — that collapse
  // is why the base cost had to come down with it (see the BUILDINGS note).
  //
  // Same measured-threshold rule as the Farm: a day ends holding 11-15
  // Factories, so the ladder tops out at 6 and every rung is reachable at every
  // tap rate.
  //
  // Cost steps stay near 3x even though the gains are ×2/×3, for the reason the
  // petting ladder is built the way it is: by the time Factories carry the day's
  // income, a ×3 to Factories is a ×3 to EVERYTHING, and rungs less than that
  // apart buy each other. At 200k/400k for the top two the sim fired the last
  // eight rows of the whole game inside three seconds.
  { key: "factory1", name: "Sisal Conveyor Tracks", icon: "🧵",
    cost: 9000, unlock: { owned: ["factory", 2] },
    effect: { type: "buildingMult", building: "factory", mult: 3 } },
  { key: "factory3", name: "LED Weaving Looms", icon: "💡",
    cost: 22000, unlock: { owned: ["factory", 4] },
    effect: { type: "buildingMult", building: "factory", mult: 4 } },
  { key: "factory4", name: "Pneumatic Crinkle Packagers", icon: "🎁",
    cost: 72000, unlock: { owned: ["factory", 6] },
    effect: { type: "buildingMult", building: "factory", mult: 5 } },

  // --- Schrödinger's Lab — fantastical cross-building tier ---
  // The Lab gets NO upgrades that boost itself. Instead, owning it unlocks a
  // tier of theory-powered boosts to the OTHER day buildings — "synthesizes
  // mice from theory" made literal. Each is AND-gated on owning the Lab plus a
  // modest count of its target building, so it reveals as a late-day power
  // spike once you've committed to the Lab. This tier is the last rung of phase
  // 1: it sits under Catnap Hypnalysis on cost so the capstone is still the
  // capstone, but above every other day ladder so buying a Lab reads as an
  // escalation. Fantastical flavour, ×3 where it is a plain multiplier.
  //
  // Exactly one row per day building now, which is the tier's whole shape: the
  // Farm gets Mice from Theory, the Subscription gets 2 Second Shipping, and the
  // Factory gets Factory Factory's synergy. Superposition Assembly Line was a
  // second, redundant Factory ×3 and came out. The Observer Effect closed the
  // tier with a flat +15% global before that — the only row pointing at nothing
  // in particular, and the only one gated on a second Lab, so it read as a tax.
  //
  // "Mice from Theory" is the Lab's own description, promoted to a row title.
  // The building's blurb said "synthesizes mice from theory" until blurbs were
  // trimmed to the one row that teaches, and the phrase was too good to lose.
  { key: "farm2", name: "Mice from Theory", icon: "🧬",
    cost: 36000, unlock: { owned: [["farm", 9], ["lab", 1]] },
    effect: { type: "buildingMult", building: "farm", mult: 3 } },
  { key: "labparcels", name: "2 Second Shipping", icon: "🚀",
    cost: 36000, unlock: { owned: [["shopper", 15], ["lab", 1]] },
    effect: { type: "buildingMult", building: "shopper", mult: 3 } },
  // A factory that makes factories: a SELF-synergy (crossBuilding with per ==
  // building), so each Mouse Factory you own makes every Mouse Factory +8%
  // better. Total factory output becomes ~quadratic in count — a snowball that
  // rewards going wide. The only crossBuilding in the game; buy()'s recalc keeps
  // its owned-dependent term live. 8% rather than 5% because this row is now the
  // Lab tier's whole contribution to Factories; at the 11-15 a day ends with that
  // is ×1.9-2.2. Watch it in the pacing sim if factory counts drift — 12% was
  // measurably too much, pulling the day in by ~40s.
  { key: "factoryfactory", name: "Factory Factory", icon: "🪆",
    cost: 68000, unlock: { owned: [["factory", 8], ["lab", 1]] },
    effect: { type: "crossBuilding", building: "factory", per: "factory", pct: 8 } },
  // --- Petting ---
  // EVERY row here belongs to phase 1 — petting earns nothing once Hex is asleep
  // (see pet()'s night gate), so a petting upgrade that isn't affordable before
  // Catnap Hypnalysis is an upgrade nobody can ever use. The ladder is priced to
  // finish at half the capstone, and its click gates top out at 1200 pets, which
  // even a slow solo run (3 pets/s) clears inside the day.
  //
  // WHY THIS ISN'T FOURTEEN ×2s. It used to be, spread from 3k to 180M, and it
  // paced fine only because most of it sat past the twist and was never bought.
  // Pull the same fourteen doublings under a 1M ceiling and they detonate: once
  // petting is the bulk of income, each ×2 more than pays for the next rung, so
  // the last eight rows all fire inside five seconds and the whole day ends at
  // 1:09. A rung's cost step has to beat the income it grants, which against a
  // fixed ceiling leaves room for four doublings and no more. The rest of the
  // ladder earns its keep with effects that CAN'T cascade, in Cookie Clicker's
  // own idiom:
  //
  //   ×2 pets       — 4 rungs, widely spaced; the only shape that compounds
  //   per-building  — Thousand Fingers: pets scale with Mouse Factories owned.
  //                   Additive rungs, so stacking them can't compound.
  //   golden mice   — Lucky Day / Get Lucky: goldens spawn sooner and linger
  //                   longer, and Zoomies itself hits harder and lasts longer.
  //                   All bounded by the buff's uptime however many you stack.
  //   flat / share  — the opening rungs, irrelevant by the end, exactly as in CC.
  //
  // Each mechanic is assigned to the running gag that already fit it, not
  // sprinkled at random: the perches are where Hex WATCHES (goldens), cardboard
  // is what a Mouse Factory ships in (per-building), and a pounce and a chin
  // scritch are what Zoomies is made of (buff power and length).
  //
  // ASCENDING COST, which is also shop order — refreshUpgrades renders UPGRADES
  // in array order, so the rail reads as one ladder. Keep it monotonic: a row
  // out of sequence shows up in the shop above things cheaper than it.
  // Gated on OWNING a Mouse Subscription, not on lifetime mice, so the opening is
  // a ladder with one rung per idea: pet Hex until a building appears, buy the
  // building, and buying it hands you your first upgrade. Each step is caused by
  // the last.
  //
  // It was briefly ungated entirely (unlock: {}), which put it on the rail in the
  // very first frame — before a single pet, with nothing yet explaining what a
  // shop is. Reads as clutter rather than as an opening. The lifetime-total gate
  // it had before that was worse in the other direction: at 200 lifetime against
  // a 50 cost it only ever appeared already affordable, so it taught nothing
  // about saving up.
  { key: "whiskers", name: "Cat Tree", icon: "🌳",
    cost: 50, unlock: { owned: ["shopper", 1] },
    effect: { type: "clickFlat", add: 1 } },
  { key: "scratchpost", name: "Scratching Post", icon: "🪵",
    cost: 250, unlock: { clicks: 60 },
    effect: { type: "clickMult", mult: 2 } },
  { key: "clawsharp", name: "Cat Brush", icon: "🪮",
    cost: 2200, unlock: { total: 4000, clicks: 110 },
    effect: { type: "clickFlat", add: 5 } },
  // The Cardboard line is this game's Thousand Fingers: pets get better the more
  // Mouse Factories you own, because a factory is what the boxes ship in. Three
  // additive rungs (10 → 35 → 100 per factory) rather than Cookie Clicker's
  // multiplied ones — additive can't compound, which is the whole reason this
  // line exists instead of three more doublings.
  //
  // Per FACTORY and not per Mouse Subscription, for the same reason Thousand
  // Fingers counts every building EXCEPT cursors. Hung off the cheapest building
  // it was a feedback loop with no brake — subscriptions cost 10 and make pets
  // better, better pets buy more subscriptions — and the sim's bot duly bought
  // 53 subscriptions, 13 farms and ZERO factories, taking the Farm ladder and
  // the entire Factory ladder down with it. The Factory's 12000 base is the
  // brake, and aiming the line at the building nobody was stocking is the point.
  // Gated on owning factories as well: bought with none, these rows do nothing.
  // The Box is the classic ambush spot, the Castle is its upgrade, and locking
  // Goomba in it leaves Hex the whole fort — so they read as a sequence, but the
  // gates are factory counts (3/5/7) and NOT `requires` links any more. That
  // chain broke the line twice. Every row here is a PETTING upgrade, so at a low
  // tap rate it is genuinely not worth buying — and a `requires` on a purchase
  // turns "not worth buying" into "never revealed", taking the two rows behind it
  // down as well. A visible row you choose to skip is fine; an invisible one is
  // dead content. The counts alone keep the sequence in practice, since you pass
  // 3 factories before 5 and 5 before 7.
  { key: "cardboardbox", name: "Cardboard Box", icon: "📦",
    cost: 4500, unlock: { owned: ["factory", 3] },
    effect: { type: "clickPerBuilding", add: 10, per: "factory" } },
  { key: "scratchpost2", name: "Reinforced Scratching Post", icon: "🪢",
    cost: 3600, unlock: { total: 7000, requires: "scratchpost", clicks: 160 },
    effect: { type: "clickMult", mult: 2 } },
  // Pounce Reflex and Chin Scritch are the Zoomies pair — the two rows that make
  // CATCHING a golden mouse matter more, rather than making every pet matter
  // more. A pounce is what the zoomies burst IS, so it hits harder; a chin
  // scritch is what keeps a cat in that state, so it lasts longer. Both are
  // bounded by the buff's own uptime no matter what else is stacked, which is
  // exactly why they're here rather than being two more doublings.
  { key: "pounce", name: "Pounce Reflex", icon: "🐾",
    cost: 11000, unlock: { total: 20000, clicks: 220 },
    effect: { type: "zoomMult", add: 3 } },
  // Window Perch #1 of the running gag (see #2/#3 below). A perch is where Hex
  // sits and WATCHES the window, so the three perches are the golden-mouse line:
  // she spots them sooner, and from the second window on they hang around longer
  // before escaping. This title stays bare "Window Perch" on purpose — it's the
  // setup the other two count off from, so it's the ONE perch that shouldn't
  // name a window. (It used to be the Saucer of Milk; hence the key.)
  { key: "milk", name: "Window Perch", icon: "🪟",
    cost: 5400, unlock: { total: 12000 },
    effect: { type: "goldenFreq", mult: 1.5 } },
  // Window Perch #2 and #3. Two effects each, Cookie Clicker's grandma-synergy
  // shape: another window is both a better lookout (sooner) and a longer watch
  // (linger). goldenLife is PAIRED rather than sold alone on purpose — the spawn
  // timer only runs while nothing is on screen and a caught golden despawns
  // instantly, so linger is pure insurance against a MISS and is worth exactly
  // zero to a room that catches everything. Alone it would read as a dead row,
  // and the pacing sim (which assumes every golden is caught) would score it at
  // zero gain and never buy it.
  //
  // Spaced 12k / 60k / 220k rather than the old 40k / 50k / 110k, where the first
  // two were a quarter of a step apart and read as the same purchase twice. The
  // third no longer `requires` the second, for the reason the cardboard line
  // doesn't either: the pets gates (620 then 820) already order them, and a
  // purchase-gate turns a skipped row into an invisible one.
  //
  // Rungs are 1.5 / 1.4 / 1.4 = ×2.94 across the line, up from 1.3 / 1.25 / 1.25
  // = ×2.03, absorbing the ×1.5 that Mouse Magnet used to contribute. That row is
  // gone and its strength had to land somewhere: golden frequency is not just a
  // day bonus, it is the clock on Lucky Number 6's six-goldens gate, so deleting
  // a third of the game's goldenFreq pushed the night's one economy spike ~1:30
  // later. It also flattened the perches themselves — the marginal value of a
  // frequency multiplier scales with the frequency you already have, so with the
  // Magnet gone the pacing bot stopped buying the line at all and the third
  // perch went unreachable at three of four tap rates.
  //
  // All three perches are one gag, so the NAME has to carry it — it used to live
  // in flavor text, which meant three rows titled "Window Perch" with only the
  // flavor telling them apart. The arithmetic is in the titles now: three
  // perches, two windows. Never collapse these back to a bare "Window Perch".
  { key: "cattree", name: "Window Perch, Second Window", icon: "🪟",
    cost: 27000, unlock: { total: 50000, clicks: 340 },
    effect: [{ type: "goldenFreq", mult: 1.4 }, { type: "goldenLife", add: 3 }] },
  // 35k, down from 60k, from back when Lock Goomba `required` this row BOUGHT and
  // a run that skipped the Castle never revealed the jail. The requires links are
  // gone (see the Box's note), so the price is no longer load-bearing for
  // anything downstream — but it stays at 35k, because the reason it was skipped
  // still holds: a 3-pets/s run reaches this point already banking for Catnap and
  // only taking fast-payback rows.
  { key: "cardboardcastle", name: "Cardboard Castle", icon: "🏰",
    cost: 16000, unlock: { owned: ["factory", 5] },
    effect: { type: "clickPerBuilding", add: 35, per: "factory" } },
  { key: "chinscritch", name: "Chin Scritch", icon: "😌",
    cost: 36000, unlock: { total: 65000, clicks: 280 },
    effect: { type: "zoomTime", add: 4 } },
  { key: "windowperch", name: "Third Window Perch, Second Window", icon: "🪟",
    cost: 99000, unlock: { total: 180000, clicks: 460 },
    effect: [{ type: "goldenFreq", mult: 1.4 }, { type: "goldenLife", add: 4 }] },
  // The anticlimax is the joke: bought after churu hydroponics and a quantum
  // lab, and what it buys is the same kibble as yesterday. The title has to land
  // that — "Dry Food" alone reads as a straight item — so the effect stays the
  // most ordinary thing in the shop.
  { key: "dryfood", name: "Dry Food, Same As Yesterday", icon: "🥣",
    cost: 58000, unlock: { total: 105000, clicks: 300 },
    effect: { type: "clickMult", mult: 2 } },
  // The ladder's only share-of-your-/s rung, and not a fifth doubling — four ×2s
  // is all the cost ceiling can space far enough apart. The mitts let you keep
  // both hands in it however fast the operation is running, which is what a
  // share of your /s per pet actually means. (Static Fur was the other one and
  // sat at 20k; the two together were the same purchase twice, once at a price
  // where +2% of a tiny /s bought nothing.) The floor is still CLICK_CPS_SHARE,
  // so pets keep their share of income whether or not this is bought.
  { key: "ovenmitts", name: "Bite-Proof Oven Mitts", icon: "🧤",
    cost: 72000, unlock: { total: 130000, clicks: 400 },
    effect: { type: "clickShare", pct: 2 } },
  { key: "jailgoomba", name: "Lock Goomba in Cardboard Castle", icon: "🚔",
    cost: 81000, unlock: { owned: ["factory", 7] },
    effect: { type: "clickPerBuilding", add: 100, per: "factory" } },
  // Sequel to the original Cat Tree (whiskers) — same running-gag pattern as the
  // Window Perch trio, and the same rule: the title carries it, because a second
  // row titled plain "Cat Tree" is indistinguishable from the first in the shop.
  // The ladder's last doubling.
  { key: "cattreetable", name: "Cat Tree, On the Table", icon: "🌳",
    cost: 144000, unlock: { total: 260000, requires: "whiskers", clicks: 520 },
    effect: { type: "clickMult", mult: 2 } },
  // Reads two ways on purpose: a breath of fresh air to anyone playing, and the
  // daily asthma puff to anyone who knows the real Hex. Don't "fix" the wording
  // toward either reading — it has to stay plain enough to carry both. The
  // ambiguity lives in the TITLE, which is why dropping the flavor line cost
  // nothing here. The ladder's last rung, and the last petting upgrade anyone
  // can ever buy — Hex falls asleep shortly after. It lifts the WHOLE operation
  // rather than pets alone, which is both the plainest reading of the name and
  // the one shape that can't set off another cascade this late in the day.
  { key: "freshair", name: "A Breath of Fresh Air", icon: "💨",
    cost: 189000, unlock: { total: 340000, clicks: 560 },
    effect: { type: "globalPct", pct: 25 } },

  // --- Cross-building synergies ---
  // (None right now.) Assisted Pounce and Thesis Subjects lived here — both used
  // Robo-Cat as the synergy subject (Cookie Clicker's GrandmaSynergy pattern:
  // the cheapest building takes a job elsewhere and the name is the punchline).
  // They were removed with Robo-Cat. The machinery survives for a future
  // re-authoring against a new subject: the `clickPerBuilding` and
  // `crossBuilding` effect types (see foldMods/effectText), and buy()'s recalc()
  // that keeps their game.owned-dependent multipliers live. A synergy only
  // changes behavior when its term dwarfs the subject's own mps, so the subject
  // must be a cheap, low-mps building (Mouse Subscription 0.4 or Mouse Farm 1),
  // never the Factory. See hex-clicker-synergy-brief.md (now historical).

  // --- Bespoke ---
  // Empty, and worth keeping as a warning. Three rows have been retired from
  // here — Hex's Undivided Focus (+10% global), The Observer Effect (+15%
  // global), and Mouse Magnet (goldens 50% sooner) — and they had the same
  // problem: a bare number with no joke in the title, sitting outside every
  // ladder, so nothing about the shop told you why you'd want it. A row needs a
  // line to belong to. The effect types they used are all still live and owned
  // elsewhere: globalPct by A Breath of Fresh Air, goldenFreq by all three
  // Window Perches, so nothing here freed any plumbing.

  // --- THE TWIST + night chain ---
  // Catnap Hypnalysis is the END OF PHASE 1, and it is priced to say so: at 1M
  // it costs more than three times the dearest thing under it (the Lab tier's
  // Observer Effect at 300k), so no day ladder can be mistaken for the capstone
  // and none of them is left stranded behind it. Every other day upgrade —
  // building AND petting — is tuned to be affordable well before this one, which
  // matters most for the petting ladder: pets earn nothing at night, so a
  // petting row you can't buy in daylight is a row you can never use.
  //
  // Unlock is OWNING a Schrödinger's Lab, not the old "total >= the Lab's base"
  // pairing. Same idea told properly: the Lab is what causes the dream, so the
  // twist appears when you actually build one rather than when you could have.
  // It also hands the pacing to the room — the Lab is the door, and phase 1 ends
  // when a team decides to open it, not when a lifetime counter ticks over. And
  // it avoids the failure mode a plain total gate has at this price: a 1M row
  // sitting unaffordable on screen for minutes, loudest thing in the shop and
  // the one thing you can't press. Buying it flips the night phase permanently
  // (it derives from game.bought, so saves restore it for free).
  //
  // The cost of that gate is that a team who never buys a Lab never sees the
  // twist. Two things pay for it: the Lab is the last, strangest, most expensive
  // building on the rail (the thing groups buy on sight), and buying one lights
  // up FOUR upgrade rows at once — its cross-building tier is priced inside
  // phase 1 now, so the reward for opening the door is immediate and visible.
  // If playtests still show teams stalling out in daylight, the fix is a nudge
  // toward the Lab, not a second unlock condition here.
  { key: "catnap", name: "Catnap Hypnalysis", icon: "💤",
    cost: 1e6, unlock: { owned: [["lab", 1]] },
    effect: { type: "night" } },
  // ---- The night ladder ------------------------------------------------------
  // EVERY change to the wall is a purchase. Thresholds were tried on paper and
  // rejected: if the wall changes because lifetime mice silently crossed a number,
  // the player cannot tell they caused it, and the whole phase reads as random
  // weather. Trails especially — that is the single biggest visual beat in the game
  // and it must be something someone bought.
  //
  // Every rung is VISIBILITY. It used to alternate with rows whose only effect was to
  // reveal the next building, and those are gone: paying for permission to buy a thing
  // is a different game's mechanic, and the buildings reveal themselves on lifetime
  // now, the same way the day's do. What is left is a single clean line from anonymous
  // specks to a readable wall:
  //
  //   Lucid Dreaming I      THE STARS START TO HAVE TRAILS  <- the hinge
  //   Lucid Dreaming II     longer trails
  //   Counting Mice         THE STARS TURN OUT TO BE MICE   <- the twist inside the twist
  //   Lucid Dreaming III    longer trails
  //   Lucky Number 6        x6 income
  //   Lucid Dreaming IV     longer trails
  //   Scent Trail           INK STOPS FADING, WORD READABLE <- the finale
  //
  // Four numbered rungs, and three rows that each happen once. The numerals exist because
  // the four ARE the same purchase four times and the ??? descriptions cannot say so; see
  // the block on them below. Two of the three singular rows get gold names for the same
  // reason, derived from the same count (CRUX_KEYS) — Lucky Number 6 is the third and
  // stays plain, because it is the economy row and states its own effect in words.
  //
  // There was a speed rung here (Running in Her Sleep, +8, between II and III). Deleted,
  // and the speed it used to buy is NOT absorbed into WALL.speedBase: 12 is the pace the
  // wall wants. The coverage it was quietly providing is paid for by the trail rungs
  // instead — see the note on speedBase, and the 98 -> 180 budget below.
  //
  // Counting Mice is LATE on purpose, and it changes what the whole phase is about. It
  // used to land at 0:13, which meant the player spent 95% of the night watching mice
  // they already knew were mice. Parked just before Lucky Number 6 instead, the wall
  // spends a minute and a half as a drifting starfield that slowly draws something — and
  // the trails are white until this fires, because drawWall inks in WALL_POINT_COLOR
  // while `neon` is off, so the reveal recolours the whole drawing at once as well as
  // resolving the sprites. None of these rows say what they do in any case; see
  // WALL_EFFECTS by oneEffectText.
  //
  // Costs are large because night's income is: the shallow 1.05 building curve means a
  // player owns ~60 Holes rather than ~40, so the whole curve sits far higher than it
  // did.
  //
  // The first six rungs are HALVED from the pass before this one — the other half of
  // running the night twice as fast, since doubling mps alone brings every rung forward
  // without changing how many purchases fit between them. The last two (Lucid Dreaming IV
  // and Scent Trail) are deliberately NOT halved: by the time they are live, Lucky
  // Number 6's x6 has landed and income is running away, and halving them collapsed the
  // final four rungs into ten seconds. Their ownership gates do the real pacing there —
  // see the note on them below. They want playtesting, not more arithmetic.

  // FOUR NUMBERED RUNGS, and the numbering is the point. These are the only rows that
  // repeat — one effect, `trail`, sold four times — and every wall row shows ??? for its
  // effect, so without the numerals a team has no way to tell "this is more of what you
  // just bought" from "this is a new thing". I, II, III, IV says it in one glyph.
  //
  // It costs three bespoke names to say it: Paper Lantern, Deep Sleep and REM Sleep were
  // all better NAMES than "Lucid Dreaming III", and all three were lying about being
  // different from each other. Paper Lantern in particular earned its place — a lantern
  // is a light you release and then watch go, which is exactly this mechanic — and it is
  // still the best candidate if the numbering ever comes off.
  //
  // I is the hinge of the whole night regardless of what it is called: before it the
  // lights leave nothing behind and the wall is unreadable in principle, not just in
  // practice. After it the dream starts recording itself. The other three only deepen it.
  //
  // 26/38/52/64, escalating so the numeral and the size agree. The TOTAL (180) is set by
  // legibility rather than taste: at speed 12 the wall needs trail x 80 + persist x 57.7 ms
  // of visible ink to cross 1.6 coverage, and 180 puts the four rungs alone at 1.46 — just
  // under — with Scent Trail's persistence tipping it to 1.81. That ordering is the point:
  // the word must not become readable until the last purchase, and it must become readable
  // ON it. 197 would break the first half of that, 160 the second.
  //
  // It was 98 while a speed rung carried 8 of the 20 units/sec; with speed held at 12 the
  // same readability has to come from length. In DRAWN terms the tail only grows a tenth,
  // 157 scene units to 173, because a slower mouse covers less ground per sample.
  { key: "paperlantern", name: "Lucid Dreaming I", icon: "🏮",
    cost: 50000, unlock: { requires: "catnap" },
    effect: { type: "trail", add: 26 } },
  // 1M, not the 115k it was, to put this at 0:50. It is a big jump from I's 50k and that is
  // the point: the first stretch of night is meant to be buildings only while the one thing
  // on the rail sits out of reach. The cost of hitting 0:50 is a dip to ~10 purchases in
  // the 0:30-1:00 window while the bank fills; 700k lands it at 0:44 with ~17 instead.
  { key: "luciddreaming", name: "Lucid Dreaming II", icon: "🌀",
    cost: 1e6, unlock: { requires: "paperlantern" },
    effect: { type: "trail", add: 38 } },
  // Night opens with the wall ALREADY populated — anonymous points of light, colourless
  // and shapeless, indistinguishable from the starfield behind them. By the time this
  // lands they have been drawing for over a minute. Counting Mice is what resolves them
  // into creatures, and the name earns its keep twice: counting sheep is what you do
  // falling asleep, and counting is exactly what you cannot do until the specks become
  // things distinct enough to count.
  //
  // It is also just accurate cat vision. Cats are dichromatic and read motion before
  // form and form before colour, so a dream that starts as bare moving specks is what
  // Hex would really see; every upgrade around this is her dreaming BETTER than she can
  // see awake.
  //
  // TRADED WITH Lucid Dreaming III — this row took its 1.15M and its slot in the chain,
  // and III took the 1.4M. Swapping the PRICES alone could not do it: `requires` pins the
  // order whatever the cost, so the cheaper row simply became affordable the instant the
  // dearer one landed and the two bunched to eleven seconds apart. The chain had to swap
  // with them.
  //
  // The reveal lands at 1:12 instead of 1:40, on a wall drawn to 0.52 coverage rather than
  // 0.94 — less ink to recolour, so a smaller bang, bought for 28 more seconds of colour
  // afterwards and a one-two the old order could not make: the lights turn out to be mice,
  // and then the very next purchase doubles what they are drawing with.
  { key: "countingmice", name: "Counting Mice", icon: "💭",
    cost: 1.15e6, unlock: { requires: "luciddreaming" },
    effect: { type: "neon" } },
  // There was a Word of Mouse row here — a research that put the nine golden
  // letter-mice on the wall. Deleted, because it could not do the job it was
  // written for. Its comment promised "the nine letters then arrive one at a time
  // in REVEAL_ORDER as the wall fills", but it gated the golden crews out of the
  // CAST, and the cast is drawn as a prefix: buying it rebuilt the cast from 24 to
  // 33 while the ramp had long since counted past 33, so all nine letters popped on
  // in a single frame. Measured with the pacing sim, that frame was 8:09 of a night
  // that opens at 5:12 and ends legible at 9:39 — the mice the whole phase is about
  // arriving 86% of the way through it, all at once, which is exactly the "they
  // appear at the end" the reveal order was designed to avoid.
  //
  // So the golden mice now follow the same rule as every other colour: they are on
  // the wall from the moment night starts, arriving on their own rungs of the shared
  // ramp, interleaved with the scenery (see rebuildWallCast — yellow lands in cast
  // slots 1, 7, 10, 14, 17, 22, 24, 29 and 32, roughly one letter per four mice).
  // REVEAL_ORDER finally means something: it is the live letter staging, not a
  // constant the game read once and then overrode.
  //
  // This does NOT give the word away early. A golden mouse with no trail behind it
  // is a moving dot, so the word stays unreadable until Lucid Dreaming — which the
  // ladder already calls its hinge. The mystery beat moves onto the row that was
  // always doing the work, instead of sitting on a row that only changed a headcount.
  { key: "deepsleep", name: "Lucid Dreaming III", icon: "😴",
    cost: 1.4e6, unlock: { requires: "countingmice" },
    effect: { type: "trail", add: 52 } },
  // Not part of the sleep-stage chain — it's the night's one economy row, gated on the
  // phase plus six HOLES rather than on the stage above it. Parked here by cost
  // (between Counting Mice and Lucid Dreaming IV) because that's where the shop and the dev dump
  // both render it: they walk UPGRADES in array order, so a row's position in this
  // table IS its position on the rail.
  //
  // A clean ×6 to ALL mouse generation (globalMult, so it multiplies the whole stack
  // rather than blending into the +% sum). Triple-six theme carried by the name, the
  // ×6, and the six-holes gate. It used to be six GOLDENS, and that gate broke when the
  // night got faster: goldens arrive on a wall clock (first at ~1:50, then every ~65s),
  // so the sixth lands past the end of a 2-minute night and the row went unbuyable —
  // for a mashing team, while a slow solo player still got it. Exactly backwards. Six
  // Holes is earned by the night's own action instead, and the price is what makes it land
  // mid-night (1:56), right after Counting Mice, rather than in the opening seconds.
  { key: "lucky6", name: "Lucky Number 6", icon: "🎲",
    cost: 1.8e6, unlock: { requires: "countingmice", owned: [["portal", 6]] },
    effect: { type: "globalMult", mult: 6 } },
  // ONE ownership gate at the very end, not two. This rung used to carry `nested 28` as
  // well, which was fine while it sat behind a 7.5M Scent Trail at 2:35 — but with that
  // row gone it hangs straight off Counting Mice, and the gate started the bot hoarding
  // for 2.88M buildings at 1:40 instead of 2:35. Measured: a 30-second window with TWO
  // purchases in it, in the middle of the mashing phase. Price alone paces this one now
  // (7M lands it at 2:35, exactly where the deleted row used to sit) and the gate is the
  // finale's alone.
  { key: "remsleep", name: "Lucid Dreaming IV", icon: "👀",
    cost: 7e6, unlock: { requires: "deepsleep" },
    effect: { type: "trail", add: 64 } },
  // THE FINALE, and the only rung that is not more of something. Cats track by scent and
  // scent lingers, which is exactly the mechanic: ink stops being a rolling window and
  // starts accumulating, so the wall holds a drawing instead of shimmering like a
  // screensaver. Worth roughly as much coverage as tripling the trail.
  //
  // It used to sit mid-ladder at 7.5M, which put the single largest legibility jump in the
  // game in the middle of the night and left two `trail` rungs after it to finish the job.
  // Measured: coverage ran 1.18 after it, 1.58 after the next rung, and only crossed the
  // 1.6 threshold on the last one — so the reveal was arriving in three instalments with
  // the smallest one last. Here it is the step that makes the word readable, on the
  // purchase that ends the night.
  //
  // Persist is LOAD-BEARING, not a garnish, and this is the number that proves it: all
  // four trail rungs with no persistence reach 1.32 against a 1.6 threshold. Delete this
  // row rather than move it and the word can never be read at all.
  //
  // Paced by OWNERSHIP, not price. Once Dream Within a Dream is online night income runs
  // away and cost stops being a brake: multiplying the tail costs by FOUR once bought
  // fifteen extra seconds. An owned-count gate rides the building cost curve instead,
  // which compounding cannot outrun. 58 rather than the 14 it started at, because the
  // shallower 1.035 curve means a player who reaches the top tier keeps buying it.
  //
  // `key` stays `hypnagogia` — it is a save key, so renaming it would silently un-buy this
  // row for anyone mid-run. Footprints, and NOT the crescent moon this row used to carry:
  // the answer is TO THE MOON, so a moon on the shop rail leaks it the same way
  // Constellation Cattery did. Every icon on a night row has to pass that test.
  { key: "hypnagogia", name: "Scent Trail", icon: "👣",
    cost: 27e6, unlock: { requires: "remsleep", owned: [["nested", 58]] },
    effect: { type: "persist", add: 60 } },
];

