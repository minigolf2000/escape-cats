// The Hex Clicker economy: every building, upgrade and dial. The ONE place
// balance lives — the server, the client and `?debug` all import it. A note
// beside a number says what pins it.

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
  | { type: "lantern" }
  | { type: "pace"; add: number }
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

// BALANCE. cost(n owned) = base * growth^n   |   income = mps * count.
// All OPEN for tuning (see DESIGN.md).
export const GROWTH = 1.15;
export const BUILDINGS: HexBuilding[] = [
  // The ONLY building with a blurb: it is first on the shelf, so its .fx line is
  // where a player learns what owning a building means. {every} is substituted
  // with the rate it ACTUALLY earns (mps x INCOME_SCALE, see everyText), so the
  // prose and the printed figure cannot disagree. Budget is 21 characters after
  // substitution: 22+ wraps, and the row grows from 61px to 97px.
  { id: "shopper", name: "Mouse Subscription", icon: "🚚", base: 10,     mps: 0.4,
    blurb: "A mouse every {every}" },
  { id: "farm",    name: "Mouse Farm",      icon: "🌾", base: 100,    mps: 1   },
  // base and mps are pinned together: cost-per-mps must sit close to the Farm's
  // so the Factory is what you graduate TO once farms get expensive. A NARROW
  // band on both dials — lower mps and nobody buys factories, higher and nobody
  // buys anything else.
  { id: "factory", name: "Mouse Factory",   icon: "🏭", base: 10000,  mps: 120 },
  // The one day building that keeps producing after the night reset (see
  // baseCpsWith), and the DOOR OUT OF PHASE 1: Catnap Hypnalysis unlocks on
  // owning one. 400 mps still loses the marginal comparison to an upgraded Farm
  // or Factory, and that is correct — you buy the Lab for what it OPENS — but it
  // must not be a straight penalty either. Day Labs keep earning at night and
  // bootstrap the dream harder than the free Hole does.
  { id: "lab",     name: "Schrödinger's Lab",  icon: "🔬", base: 130000, mps: 400 },
  // ---- Night buildings: DREAM is the mechanism, SPACE is the secret ----------
  // Dream-native names only: every space reference lives behind the reveal, so
  // nothing on the rail may leak the answer. Tiers reveal on lifetime >= base,
  // exactly as in the day.
  //
  // THE SPACING IS THE PACING. A tier is worth buying once the tier below has
  // climbed past the COST-PER-MPS ratio between them, so that ratio is the dial:
  // 4 -> 20 -> 50. It has to GROW — income compounds, so a constant ratio bunches
  // the arrivals into the night's first seconds instead of one per third of it.
  // Do not rebase a tier to buy income back: a tier n times dearer is bought
  // 1/n as often, and purchasing IS the action here.
  //
  // PURCHASING IS NIGHT'S MASHING ACTION (petting earns nothing asleep), which
  // the day curve would prevent. growth 1.035, not 1.15: cost climbs as
  // growth^n while income from copies climbs linearly in n, so a steep curve
  // makes the gap between purchases grow without bound (Cookie Clicker papers
  // over that with buy-10). base = 4x mps on the first tier, so the first copies
  // land a fraction of a second apart; a 33x base was 12 seconds of nothing.
  //
  // The `id`s are SAVE KEYS and do not match the names (`delta` is Dream Within
  // a Dream). Do not "fix" it: renaming an id wipes that building from every
  // existing save.
  { id: "portal",  name: "Hole in the Wall",       icon: "🕳️", base: 480,    mps: 120,  night: true, growth: 1.035, firstFree: 1 },
  { id: "spindle", name: "Ball of String Theory",  icon: "🧵", base: 9600,   mps: 480,  night: true, growth: 1.035 },
  { id: "delta",   name: "Dream Within a Dream",   icon: "🌀", base: 120000, mps: 2400, night: true, growth: 1.035 },
];
// The night opens on NOTHING but one Hole in the Wall priced at zero
// (firstFree). That free copy is the whole bootstrap — only buildings earn once
// Hex is asleep. Not a starting bank: a grant counts toward lifetime and reveals
// the Hole before the player has done anything. The 1.6s wait for the second
// Hole is the price of the wall being empty at 0:00.
export const CLICK_BASE = 1;           // mice per pet before bonuses
export const CLICK_CPS_SHARE = 0.02;   // + this fraction of mps per pet (keeps petting alive)
// Zoomies BASE values: upgrades raise both, so runtime reads mods.zoomMult /
// mods.zoomTime, never these two.
export const ZOOM_MULT = 6;            // Zoomies: pets x6...
export const ZOOM_S = 7;               // ...for 7s
// Global income compression: multiplies all passive income and, via clickShare,
// the pet-share term with it, so the click/idle balance is preserved. Applied in
// baseCpsWith. 2.5 makes the Mouse Subscription earn exactly 1.00/s, so its
// blurb reads "a mouse every second" (everyText derives it from this). Moves the
// DAY only — night income is buildings alone.
export const INCOME_SCALE = 2.5;

// THE ANSWER. wall.js's MOON_SCENE is hand-placed art for exactly this string:
// change them together or not at all. A plain constant, not a deploy secret —
// it ships in the bundle either way (?debug runs the sim in-page); the puzzle is
// protected by the legibility gate in HexSim.snapshot.
export const HEX_CODEWORD = "TO THE MOON";

// ---------------------------------------------------------------------------
// UPGRADES — a flat authored list, in SHOP ORDER (refreshUpgrades renders the
// array as-is), so keep costs ascending within a ladder.
//
//   unlock: what makes it appear. Sticky once met. Kinds, all AND-ed:
//     owned: [buildingId, n]   total: n (lifetime mice)
//     clicks: n                golden: n (golden mice caught)
//     requires: "key"          (must own that upgrade)
//   effect: what it does. Folded into `mods` by foldMods():
//     buildingMult  building, mult   — that building only
//     globalPct     pct              — all buildings, additive with each other
//     globalMult    mult             — all buildings, multiplicative (Lucky 6)
//     crossBuilding building, per, pct — +pct% to `building` per `per` owned
//     clickFlat     add              — flat mice per pet
//     clickPerBuilding add, per      — flat mice per pet, per `per` owned
//     clickShare    pct              — + % of your /s per pet
//     clickMult     mult             — multiplies the whole pet
//     goldenFreq    mult             — golden mice spawn this much sooner
//     goldenLife    add              — golden mice stay on screen this many more seconds
//     zoomMult      add              — Zoomies multiplies pets by this much more
//     zoomTime      add              — Zoomies lasts this many more seconds
//     trail         add              — night wall trail segments (the reveal ink)
//     persist       add              — night ink half-life (Scent Trail)
//     neon          (no fields)      — the specks resolve into mice
//     lantern       (no fields)      — the night is LIT (Paper Lantern)
//     pace          add              — instalments of the wall's speed paid back
//     speed         add              — adds to the wall's base speed (no row
//                                      sells it; kept for the machinery)
//     night         (no fields)      — THE phase flip; handled in buyUpgrade
//
// There is NO flavor-text field: every description is derived from `effect`
// (see effectText) and states the mechanical effect only; the NAME carries the
// joke. If a row isn't funny, rename it. The Lab has no upgrades of its own on
// purpose.
// ---------------------------------------------------------------------------
export const UPGRADES: HexUpgrade[] = [
  // --- Mouse Subscription ---
  { key: "shopper1", name: "2-Day Shipping", icon: "🚚",
    cost: 200, unlock: { owned: ["shopper", 5] },
    effect: { type: "buildingMult", building: "shopper", mult: 2 } },
  // AN EMPTY RAIL IS SET BY REVEAL GATES, NOT BY COSTS: `unlock` decides when a
  // row arrives, cost decides when it LEAVES. Tune coverage with the former and
  // pacing with the latter. This row must stay a wait at every tap rate — the
  // bank at a 3500 lifetime is three figures, so it would have to go several
  // times cheaper to be bought on sight (see Cat Brush for why that is a hole).
  { key: "shopper2", name: "Subscribe & Save", icon: "🔁",
    cost: 1000, unlock: { total: 3500, owned: ["shopper", 10] },
    effect: { type: "buildingMult", building: "shopper", mult: 2 } },
  // Later tiers escalate ×3 then ×4: each cuts deeper into the supply chain.
  { key: "shopper3", name: "Wholesale Liquidation Pallets", icon: "🏷️",
    cost: 8000, unlock: { total: 15000, owned: ["shopper", 15] },
    effect: { type: "buildingMult", building: "shopper", mult: 3 } },
  { key: "shopper4", name: "Import Direct from Manufacturer", icon: "🚢",
    cost: 27000, unlock: { total: 50000, owned: ["shopper", 21] },
    effect: { type: "buildingMult", building: "shopper", mult: 4 } },

  // --- Mouse Farm ---
  // The day workhorse: a long ladder carrying the 100 -> 10000 gap between Farm
  // and Factory on upgrades. Multipliers escalate ×2 -> ×3 -> ×4 with costs
  // ascending, so they reveal in sequence. Owned thresholds are priced against
  // what a day ACTUALLY ends holding (~16-17 Farms), not a wish: re-measure them
  // whenever building mps moves, or the top rungs never reveal.
  // ONE Farm, and `total: 800` is what places the row: a day spends its opening
  // on Mouse Subscriptions, so any larger farm count binds late (~1500 lifetime)
  // and the row lands already affordable. Not zero Farms, because a Farm
  // multiplier with no Farms does nothing.
  { key: "farmplow", name: "Sisal Scratching Plows", icon: "🧶",
    cost: 400, unlock: { total: 800, owned: ["farm", 1] },
    effect: { type: "buildingMult", building: "farm", mult: 2 } },
  // Keeps the Farm ladder's step near ×4.5 (400 -> 1800 -> 7200). Total and farm
  // count bind together — lower one alone and the other still places the row. A
  // slow burn BY DESIGN: revealed while pets still carry income, it sits
  // unbought and holds the rail until Subscribe & Save's 3500. Do not price or
  // gate this to be bought on sight.
  { key: "farmfeliway", name: "Feliway Sprinklers", icon: "💨",
    cost: 1800, unlock: { total: 2000, owned: ["farm", 2] },
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
  // Three rungs, ×3/×4/×5. A day ends holding 11-15 Factories, so the ladder
  // tops out at 6 and every rung is reachable at every tap rate. Cost steps stay
  // near 3x even though the gains are larger: once Factories carry the day's
  // income, a ×3 to Factories is a ×3 to EVERYTHING, and rungs closer than that
  // buy each other in a cascade.
  { key: "factory1", name: "Sisal Conveyor Tracks", icon: "🧵",
    cost: 9000, unlock: { owned: ["factory", 2] },
    effect: { type: "buildingMult", building: "factory", mult: 3 } },
  { key: "factory3", name: "LED Weaving Looms", icon: "💡",
    cost: 22000, unlock: { owned: ["factory", 4] },
    effect: { type: "buildingMult", building: "factory", mult: 4 } },
  { key: "factory4", name: "Pneumatic Crinkle Packagers", icon: "🎁",
    cost: 72000, unlock: { owned: ["factory", 6] },
    effect: { type: "buildingMult", building: "factory", mult: 5 } },

  // --- Schrödinger's Lab — cross-building tier ---
  // The Lab gets NO upgrades that boost itself; owning one unlocks one row per
  // OTHER day building, AND-gated on a modest count of its target. Priced under
  // Catnap Hypnalysis (the capstone stays the capstone) and above every other
  // day ladder, so buying a Lab reads as an escalation.
  { key: "farm2", name: "Mice from Theory", icon: "🧬",
    cost: 36000, unlock: { owned: [["farm", 9], ["lab", 1]] },
    effect: { type: "buildingMult", building: "farm", mult: 3 } },
  { key: "labparcels", name: "2 Second Shipping", icon: "🚀",
    cost: 36000, unlock: { owned: [["shopper", 15], ["lab", 1]] },
    effect: { type: "buildingMult", building: "shopper", mult: 3 } },
  // A SELF-synergy (crossBuilding with per == building): total factory output
  // goes ~quadratic in count. The only crossBuilding in the game; buyBuilding's
  // recalc keeps its owned-dependent term live. 8% is ×1.9-2.2 at the 11-15
  // Factories a day ends with; 12% pulled the day in by ~40s.
  { key: "factoryfactory", name: "Factory Factory", icon: "🪆",
    cost: 68000, unlock: { owned: [["factory", 8], ["lab", 1]] },
    effect: { type: "crossBuilding", building: "factory", per: "factory", pct: 8 } },
  // --- Petting ---
  // EVERY row here belongs to phase 1: petting earns nothing once Hex is asleep
  // (pets()'s night gate), so a petting upgrade not affordable before Catnap
  // Hypnalysis is one nobody can ever use. The ladder finishes at half the
  // capstone and its click gates top out at 1200 pets, which a slow solo run
  // clears inside the day.
  //
  // Only FOUR ×2 rungs. A rung's cost step has to beat the income it grants or
  // the rungs buy each other in a cascade, and under a fixed ceiling that leaves
  // room for four doublings. The rest of the ladder uses effects that CANNOT
  // compound: per-building (additive rungs), golden-mouse (bounded by the buff's
  // uptime however many stack), and flat / share for the opening.
  //
  // ASCENDING COST is also shop order — keep it monotonic, or a row shows up
  // above things cheaper than it.
  // Gated on OWNING a Subscription, not on lifetime: the opening is one rung per
  // idea — pet, a building appears, buy it, and buying it hands you your first
  // upgrade. Ungated it is clutter on the first frame; a lifetime gate had it
  // appear already affordable and taught nothing about saving.
  { key: "whiskers", name: "Cat Tree", icon: "🌳",
    cost: 50, unlock: { owned: ["shopper", 1] },
    effect: { type: "clickFlat", add: 1 } },
  { key: "scratchpost", name: "Scratching Post", icon: "🪵",
    cost: 250, unlock: { clicks: 60 },
    effect: { type: "clickMult", mult: 2 } },
  // THE OPENING'S REVEAL SCHEDULE. Every cheap opening row (Cat Tree 50, 2-Day
  // Shipping 200, Scratching Post 250, Plows 400) costs LESS than the bank at
  // its gate, so each is bought on the frame it appears and the rail drops back
  // to empty. This row is the savings target that fills the ~650-3500 band: 2200
  // revealed on a 700 lifetime, when the bank is two figures. The schedule:
  //
  //   ~12    Cat Tree                 50    bought on sight
  //   ~73    Scratching Post          250   bought on sight
  //   ~382   2-Day Shipping           200   bought on sight
  //   700    Cat Brush                2200  <- SAVED FOR
  //   800    Sisal Scratching Plows   400   bought on sight
  //   2000   Feliway Sprinklers       1800  <- saved for
  //   3500   Subscribe & Save         1000
  //
  // The trade: a solo player sees this sit unaffordable for minutes. If playtest
  // says the rail reads as STUCK, add a row revealing in the 1000-2000 band —
  // making this one cheaper just returns it to the bought-on-sight pile.
  // `clicks: 110` is not load-bearing; the total places the row.
  { key: "clawsharp", name: "Cat Brush", icon: "🪮",
    cost: 2200, unlock: { total: 700, clicks: 110 },
    effect: { type: "clickFlat", add: 5 } },
  // The Cardboard line is this game's Thousand Fingers: pets per Mouse FACTORY
  // owned, in three ADDITIVE rungs (10 -> 35 -> 100) that cannot compound. Per
  // Factory, never the cheapest building: subscriptions cost 10 and make pets
  // better, which is a feedback loop with no brake. Gated on factory counts
  // (3/5/7), NOT `requires` links: every row here is a petting upgrade, so at a
  // low tap rate it is genuinely not worth buying, and a `requires` turns
  // "skipped" into "never revealed" for the rows behind it. The counts order the
  // sequence on their own.
  { key: "cardboardbox", name: "Cardboard Box", icon: "📦",
    cost: 4500, unlock: { owned: ["factory", 3] },
    effect: { type: "clickPerBuilding", add: 10, per: "factory" } },
  { key: "scratchpost2", name: "Reinforced Scratching Post", icon: "🪢",
    cost: 3600, unlock: { total: 7000, requires: "scratchpost", clicks: 160 },
    effect: { type: "clickMult", mult: 2 } },
  // Pounce Reflex and Chin Scritch are the Zoomies pair — bounded by the buff's
  // own uptime whatever is stacked, which is why they are not two more doublings.
  { key: "pounce", name: "Pounce Reflex", icon: "🐾",
    cost: 11000, unlock: { total: 20000, clicks: 220 },
    effect: { type: "zoomMult", add: 3 } },
  // Window Perch #1 of three (the golden-mouse line). Stays bare "Window Perch"
  // on purpose: it is the setup the other two count off from. `milk` is its
  // save key; leave it.
  { key: "milk", name: "Window Perch", icon: "🪟",
    cost: 5400, unlock: { total: 12000 },
    effect: { type: "goldenFreq", mult: 1.5 } },
  // Window Perch #2 and #3, two effects each. goldenLife is PAIRED with
  // goldenFreq, never sold alone: the spawn timer only runs while nothing is on
  // screen and a caught golden despawns instantly, so linger is pure insurance
  // against a MISS and worth zero to a room that catches everything. No
  // `requires` between them, for the cardboard line's reason — the pets gates
  // already order them. The titles carry the gag (three perches, two windows);
  // never collapse them back to a bare "Window Perch".
  { key: "cattree", name: "Window Perch, Second Window", icon: "🪟",
    cost: 27000, unlock: { total: 50000, clicks: 340 },
    effect: [{ type: "goldenFreq", mult: 1.4 }, { type: "goldenLife", add: 3 }] },
  { key: "cardboardcastle", name: "Cardboard Castle", icon: "🏰",
    cost: 16000, unlock: { owned: ["factory", 5] },
    effect: { type: "clickPerBuilding", add: 35, per: "factory" } },
  { key: "chinscritch", name: "Chin Scritch", icon: "😌",
    cost: 36000, unlock: { total: 65000, clicks: 280 },
    effect: { type: "zoomTime", add: 4 } },
  { key: "windowperch", name: "Third Window Perch, Second Window", icon: "🪟",
    cost: 99000, unlock: { total: 180000, clicks: 460 },
    effect: [{ type: "goldenFreq", mult: 1.4 }, { type: "goldenLife", add: 4 }] },
  // The anticlimax is the joke: keep the effect the most ordinary thing in the
  // shop.
  { key: "dryfood", name: "Dry Food, Same As Yesterday", icon: "🥣",
    cost: 58000, unlock: { total: 105000, clicks: 300 },
    effect: { type: "clickMult", mult: 2 } },
  // The ladder's only share-of-your-/s rung, not a fifth doubling. The floor is
  // CLICK_CPS_SHARE whether or not this is bought.
  { key: "ovenmitts", name: "Bite-Proof Oven Mitts", icon: "🧤",
    cost: 72000, unlock: { total: 130000, clicks: 400 },
    effect: { type: "clickShare", pct: 2 } },
  { key: "jailgoomba", name: "Lock Goomba in Cardboard Castle", icon: "🚔",
    cost: 81000, unlock: { owned: ["factory", 7] },
    effect: { type: "clickPerBuilding", add: 100, per: "factory" } },
  // Sequel to Cat Tree; the title carries it, since a second plain "Cat Tree"
  // is indistinguishable in the shop. The ladder's last doubling.
  { key: "cattreetable", name: "Cat Tree, On the Table", icon: "🌳",
    cost: 144000, unlock: { total: 260000, requires: "whiskers", clicks: 520 },
    effect: { type: "clickMult", mult: 2 } },
  // Reads two ways on purpose — fresh air, and the real Hex's daily asthma puff —
  // so don't "fix" the wording toward either. The last petting upgrade anyone
  // can buy. A globalPct, not a pet multiplier: the one shape that cannot set
  // off a cascade this late in the day.
  { key: "freshair", name: "A Breath of Fresh Air", icon: "💨",
    cost: 189000, unlock: { total: 340000, clicks: 560 },
    effect: { type: "globalPct", pct: 25 } },

  // Two kinds of row deliberately NOT here: a cross-building synergy (the
  // machinery — clickPerBuilding, crossBuilding — survives; a subject must be a
  // cheap, low-mps building, never the Factory) and a bespoke row with a bare
  // number and no ladder to belong to. A row needs a line to belong to.

  // --- THE TWIST + night chain ---
  // Catnap Hypnalysis is the END OF PHASE 1. 1M is more than five times the
  // dearest day row, so no day ladder is mistaken for the capstone and every day
  // upgrade — petting most of all — is affordable before it. Unlock is OWNING a
  // Lab: the Lab causes the dream, phase 1 ends when a team decides to open the
  // door, and a 1M row never sits unaffordable on screen for minutes. Night
  // derives from `bought`, so saves restore it for free. A team that never buys
  // a Lab never sees the twist; the fix for that is a nudge toward the Lab, not
  // a second unlock condition here.
  { key: "catnap", name: "Catnap Hypnalysis", icon: "💤",
    cost: 1e6, unlock: { owned: [["lab", 1]] },
    effect: { type: "night" } },
  // THE FIRST RUNG OF THE NIGHT. The night opens UNLIT — a quarter of the wall's
  // pace and a third of its brightness (WALL.unlitSpeed / unlitGlow) — and this
  // hands the baseline back as a BEAT, eased over WALL.rampMs from the
  // purchase's own timestamp. ALL of the light, HALF of the pace: Lucid
  // Dreaming I pays the other instalment (WALL.paceSteps), so the night runs
  // 2.4 -> 6.0 -> 9.6 units/sec across its first two purchases.
  //
  // `key` is `lantern`, NOT `paperlantern` — that is Lucid Dreaming I's save
  // key. Do not tidy it.
  //
  // COST: 10,000, and the window is narrow on both sides. The floor is the
  // cutscene: the twist's beat runs ~5.6s before the rail is touchable, and a
  // price under ~5k is bought seconds later, so the unlit wall is never seen as
  // a state. The ceiling is Lucid Dreaming I at 50k: the opening bank curve is
  // exponential off the free Hole, so 25k+ lands within seconds of the hinge and
  // stacks two 1.4s hand-overs into one long acceleration. 10k leaves 12-25s of
  // lit, trail-less wall between them and costs the night's length nothing. If
  // the dark drags, move to 5,000; if it never registers, 15,000 is the last
  // price that still clears the hinge by ~10s.
  { key: "lantern", name: "Paper Lantern", icon: "🏮",
    cost: 10000, unlock: { requires: "catnap" },
    effect: [{ type: "lantern" }, { type: "pace", add: 1 }] },
  // ---- The night ladder ------------------------------------------------------
  // EVERY change to the wall is a purchase. Not thresholds: if the wall changes
  // because a counter silently crossed a number, the player cannot tell they
  // caused it and the phase reads as weather. Every rung is VISIBILITY — nothing
  // sells permission to buy a thing; buildings reveal on lifetime.
  //
  //   Lucid Dreaming I      THE STARS START TO HAVE TRAILS  <- the hinge
  //   Lucid Dreaming II     longer trails
  //   Counting Mice         THE STARS TURN OUT TO BE MICE   <- the twist inside the twist
  //   Lucid Dreaming III    longer trails
  //   Lucky Number 6        x6 income
  //   Lucid Dreaming IV     longer trails
  //   Scent Trail           INK STOPS FADING, WORD READABLE <- the finale
  //
  // Wall rows show ??? for their effect (WALL_EFFECTS, oneEffectText). The
  // numerals exist because the four trail rungs ARE the same purchase four times
  // and ??? cannot say so. The singular wall rows get gold names (CRUX_KEYS);
  // Lucky Number 6 is the economy row, states its effect, and stays plain.
  //
  // No speed rung: 9.6 is the pace the wall wants, and coverage is linear in
  // speed (see the trail budget below). Counting Mice is LATE on purpose — the
  // wall spends over a minute as a starfield drawing something, and the trails
  // are white until it fires (drawWall inks WALL_POINT_COLOR while `neon` is
  // off), so the reveal recolours the whole drawing at once.
  //
  // Costs are large because night income is: on the 1.035 curve a player ends
  // the night owning ~96 Holes.

  // FOUR NUMBERED RUNGS, and I is the hinge: before it the lights leave nothing
  // behind and the wall is unreadable in principle. 34/50/68/84, escalating so
  // numeral and size agree.
  //
  // THE TOTAL (236) IS SET BY LEGIBILITY, not taste: at speed 9.6 the four rungs
  // alone reach 1.53 coverage — just under LEGIBLE_COV 1.6 — and Scent Trail's
  // persistence tips it to 1.81. The word must not become readable until the
  // last purchase, and must become readable ON it; the window is [204, 247).
  // COVERAGE IS LINEAR IN SPEED: change WALL.speedBase and refit this total by
  // the same ratio, then the persistence term around it. Raising LEGIBLE_COV
  // instead is the wrong half of the inequality (see its note).
  //
  // The budget costs FRAMETIME: the tail is SAMPLED, not recorded
  // (wallGrowTrail), so it is 33 mice x 236 lookups per frame — the heaviest
  // frame in the game. If it bites on a phone, sample the faded end coarsely.
  //
  // IT ALSO FINISHES THE PACE (`pace`, WALL.paceSteps): this row owns the first
  // unit of trail AND the last pace instalment, so every trail rung inks at the
  // full 9.6. Sell a trail rung ahead of the last pace instalment and the ladder
  // lands at ~0.45 against 1.6 and the word can never be read. `requires:
  // "lantern"` is the other half of that guarantee.
  //
  // `key` stays `paperlantern`: a SAVE KEY, so renaming it strands every
  // persisted purchase.
  { key: "paperlantern", name: "Lucid Dreaming I", icon: "🛌",
    cost: 50000, unlock: { requires: "lantern" },
    effect: [{ type: "trail", add: 34 }, { type: "pace", add: 1 }] },
  // 1M puts this at ~0:50. The jump from I's 50k is the point: the first stretch
  // of night is buildings only, with the one row on the rail out of reach.
  { key: "luciddreaming", name: "Lucid Dreaming II", icon: "🌀",
    cost: 1e6, unlock: { requires: "paperlantern" },
    effect: { type: "trail", add: 50 } },
  // Resolves the anonymous specks into creatures — counting is what you cannot
  // do until they are things. Sits BEFORE Lucid Dreaming III: the reveal lands
  // ~1:12 on a lightly-drawn wall, and the very next purchase doubles what the
  // mice are drawing with. To reorder night rows, swap the `requires` chain WITH
  // the prices: the chain pins the order, so a cheaper row behind a dearer one
  // is simply affordable the instant it lands and the two bunch.
  { key: "countingmice", name: "Counting Mice", icon: "💭",
    cost: 1.15e6, unlock: { requires: "luciddreaming" },
    effect: { type: "neon" } },
  { key: "deepsleep", name: "Lucid Dreaming III", icon: "😴",
    cost: 1.4e6, unlock: { requires: "countingmice" },
    effect: { type: "trail", add: 68 } },
  // The night's one economy row, gated on six HOLES rather than the stage above
  // it; parked here by cost because array order is rail order. globalMult so it
  // multiplies the whole stack. Six Holes, not six goldens: goldens arrive on a
  // wall clock, so a fast team's night ended before the sixth — exactly
  // backwards. The price is what lands it mid-night, after Counting Mice.
  { key: "lucky6", name: "Lucky Number 6", icon: "🎲",
    cost: 1.8e6, unlock: { requires: "countingmice", owned: [["portal", 6]] },
    effect: { type: "globalMult", mult: 6 } },
  // NO ownership gate, here or on Scent Trail: an owned-count gate on a night
  // building turns the stretch before the rung into a hoard for that building.
  // Price alone paces it (~2:14 into the night).
  { key: "remsleep", name: "Lucid Dreaming IV", icon: "👀",
    cost: 7e6, unlock: { requires: "deepsleep" },
    effect: { type: "trail", add: 84 } },
  // THE FINALE, and the only rung that is not more of something: ink stops being
  // a rolling window and accumulates, so the wall holds a drawing. Persist is
  // LOAD-BEARING — the four trail rungs alone fall short of LEGIBLE_COV — so it
  // is the step that makes the word readable, on the purchase that ends the
  // night. Delete this row rather than move it and the word can never be read.
  //
  // Paced by PRICE, no owned gate (see Lucid Dreaming IV). 60e6 puts it at the
  // end of a ~2:45 night whose worst wait (~22s) is the hoard for the top tier,
  // not this row; push the price up to buy clock and this row's hoard becomes
  // the worst wait instead (100e6: a 31s gap).
  //
  // `key` stays `hypnagogia` — a save key. Footprints, and NOT a moon: the
  // answer is TO THE MOON, and every icon on a night row has to pass that test.
  { key: "hypnagogia", name: "Scent Trail", icon: "👣",
    cost: 60e6, unlock: { requires: "remsleep" },
    effect: { type: "persist", add: 60 } },
];

