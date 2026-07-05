// Wire protocol shared by clients, the proctor dashboard, and the PartyKit server.
// Everything is JSON over WebSocket. Server state is authoritative; clients
// only ever send intents (clicks, purchases, launches).

export interface PlayerInfo {
  id: string;
  name: string;
  connected: boolean;
}

// ---------------------------------------------------------------------------
// Hex Clicker
// ---------------------------------------------------------------------------

export interface HexState {
  /** Shared point pool for the whole team. */
  points: number;
  pointsPerSecond: number;
  clickPower: number;
  totalClicks: number;
  /** upgradeId -> number owned (shared, cooperative). */
  upgrades: Record<string, number>;
  /** Mouse toys collected so far; drives the code-word reveal animation. */
  toyCount: number;
  players: PlayerInfo[];
  /** 0..1 toward the code-word unlock. */
  progress: number;
  /** null until unlocked — the word never leaves the server before that. */
  codeword: string | null;
  /** Room seed: all phones render the identical deterministic toy animation. */
  seed: number;
  /** Server clock (ms epoch) so clients can sync the animation timeline. */
  serverTime: number;
}

export type HexClientMsg =
  | { type: "join"; name: string }
  | { type: "clicks"; count: number } // batched client-side
  | { type: "buy"; upgradeId: string }
  | { type: "reset" }; // proctor only

export type HexServerMsg = { type: "state"; state: HexState };

// ---------------------------------------------------------------------------
// Angry Goomba
// ---------------------------------------------------------------------------

export type BodyKind = "ground" | "block" | "target" | "projectile";

export interface BodySnapshot {
  id: number;
  kind: BodyKind;
  shape: "box" | "circle";
  x: number;
  y: number;
  angle: number;
  w: number;
  h: number;
  r: number;
}

export interface GoombaState {
  levelIndex: number;
  totalLevels: number;
  levelsCleared: number;
  targetsRemaining: number;
  players: PlayerInfo[];
  progress: number;
  codeword: string | null;
}

export type GoombaClientMsg =
  | { type: "join"; name: string }
  | { type: "launch"; angle: number; power: number } // radians, 0..1
  | { type: "reset" }; // proctor only

export type GoombaServerMsg =
  | { type: "state"; state: GoombaState }
  | { type: "snapshot"; t: number; bodies: BodySnapshot[] };
