// All game-economy tuning lives here so rebalancing never touches game code.
// Target: a team of ~4 unlocks the code word in about 10 minutes.

export interface HexUpgradeDef {
  id: string;
  name: string;
  emoji: string;
  baseCost: number;
  /** Each purchase multiplies the next cost by this. */
  costMult: number;
  /** Passive points/second granted per copy owned. */
  cps: number;
  /** Every purchase releases one mouse toy onto everyone's screen. */
  addsToy: boolean;
}

export const HEX_BALANCE = {
  targetMinutes: 10,
  clickPower: 1,
  /** Shared point total that unlocks the code word. Tune via playtests. */
  unlockPoints: 50_000,
  /** Toy count at which the word pattern becomes fully legible. */
  toysForLegibleWord: 25,
  upgrades: [
    { id: "yarn", name: "Ball of Yarn", emoji: "🧶", baseCost: 15, costMult: 1.15, cps: 0.5, addsToy: true },
    { id: "catnip", name: "Catnip Stash", emoji: "🌿", baseCost: 100, costMult: 1.15, cps: 4, addsToy: true },
    { id: "tower", name: "Cat Tower", emoji: "🗼", baseCost: 600, costMult: 1.15, cps: 20, addsToy: true },
    { id: "roomba", name: "Roomba Rodeo", emoji: "🤖", baseCost: 3_000, costMult: 1.15, cps: 80, addsToy: true },
    { id: "laser", name: "Laser Pointer Array", emoji: "🔴", baseCost: 12_000, costMult: 1.15, cps: 300, addsToy: true },
  ] as HexUpgradeDef[],
};

export function upgradeCost(def: HexUpgradeDef, owned: number): number {
  return Math.ceil(def.baseCost * Math.pow(def.costMult, owned));
}
