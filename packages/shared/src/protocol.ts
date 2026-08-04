// Wire protocol shared by clients, the proctor dashboard, and the PartyKit server.
// Everything is JSON over WebSocket. Server state is authoritative; clients
// only ever send intents (pets, purchases, launches).

import type { HexSimState } from "./hex/sim";

export interface PlayerInfo {
  id: string;
  name: string;
  connected: boolean;
}

// ---------------------------------------------------------------------------
// Hex Clicker
// ---------------------------------------------------------------------------

/** Full authoritative snapshot, broadcast on every tick (~4Hz) and after every
 * intent. Clients extrapolate income between snapshots with the same shared
 * rules, so the counter stays smooth. */
export interface HexSnapshot extends HexSimState {
  players: PlayerInfo[];
  /** Server clock (ms epoch) at send — clients sync the wall's shared timeline
   * (and Zoomies deadlines) to it. */
  serverTime: number;
  /** 0..1 for the proctor progress bar. */
  progress: number;
  /** null until the wall is legible — the word never leaves the server before
   * that. (The night wall's painted word is client art; this is the checkable
   * answer the proctor sees.) */
  codeword: string | null;
}

export type HexClientMsg =
  | { type: "join"; name: string }
  | { type: "pets"; count: number } // batched client-side
  | { type: "buyBuilding"; id: string }
  | { type: "buyUpgrade"; key: string }
  | { type: "catchGold"; id: number }
  | { type: "reset" } // proctor only
  | { type: "speed"; mult: number }; // proctor only — dev time-scale

export type HexServerMsg = { type: "state"; state: HexSnapshot };

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
