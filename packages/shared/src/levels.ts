// Angry Goomba level definitions. World units are pixels in a fixed
// 1280x720 world; the client scales to fit the phone screen.
// Players' slingshots sit on the left; fortresses are built on the right.

export interface BlockDef {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TargetDef {
  x: number;
  y: number;
  r: number;
}

export interface LevelDef {
  name: string;
  blocks: BlockDef[];
  targets: TargetDef[];
}

export const WORLD = {
  width: 1280,
  height: 720,
  groundY: 680,
  /** Slingshot anchor x-positions for player slots 0..3. */
  slingshotX: [80, 160, 240, 320],
  slingshotY: 640,
  projectileRadius: 18,
  maxLaunchSpeed: 28,
};

// Positions are computed so every body spawns exactly at rest — a floor is
// posts (h=100) + crossbeam (h=20), so floor f stands on g - f*120.
function tower(x: number, floors: number): { blocks: BlockDef[]; targets: TargetDef[] } {
  const blocks: BlockDef[] = [];
  const g = WORLD.groundY;
  for (let f = 0; f < floors; f++) {
    const base = g - f * 120;
    blocks.push({ x: x - 60, y: base - 50, w: 20, h: 100 });
    blocks.push({ x: x + 60, y: base - 50, w: 20, h: 100 });
    blocks.push({ x, y: base - 110, w: 160, h: 20 });
  }
  // The goomba shelters inside the ground floor: smash the tower to reach it.
  return { blocks, targets: [{ x, y: g - 24, r: 24 }] };
}

function fortress(parts: Array<{ x: number; floors: number }>): LevelDef["blocks"] {
  return parts.flatMap((p) => tower(p.x, p.floors).blocks);
}

export const LEVELS: LevelDef[] = [
  {
    name: "Garden Wall",
    ...tower(950, 1),
  },
  {
    name: "Two Towers",
    blocks: fortress([{ x: 850, floors: 1 }, { x: 1100, floors: 1 }]),
    targets: [tower(850, 1).targets[0], tower(1100, 1).targets[0]],
  },
  {
    name: "Double Decker",
    ...tower(1000, 2),
  },
  {
    name: "Plant Nursery",
    blocks: fortress([{ x: 800, floors: 2 }, { x: 1080, floors: 1 }]),
    targets: [tower(800, 2).targets[0], tower(1080, 1).targets[0]],
  },
  {
    name: "The Final Fortress",
    blocks: fortress([{ x: 780, floors: 1 }, { x: 980, floors: 3 }, { x: 1180, floors: 1 }]),
    targets: [tower(780, 1).targets[0], tower(980, 3).targets[0], tower(1180, 1).targets[0]],
  },
];
