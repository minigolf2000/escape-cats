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
/** One teammate tap, stamped in server time so every phone can replay it at
 * the same offset on its own synced clock. Slot (0..3) rather than pid: it is
 * smaller, and it is already what decides a player's colour. */
export interface TapEvent {
  slot: number;
  at: number;
}

export interface HexSnapshot extends HexSimState {
  /** Taps applied since the previous snapshot. Presentation only — the sim
   * never reads these; the bank already counted them. */
  taps: TapEvent[];
  players: PlayerInfo[];
  /** Server clock (ms epoch) at send — clients sync the wall's shared timeline
   * (and Zoomies deadlines) to it. */
  serverTime: number;
  /** 0..1 for the proctor progress bar. */
  progress: number;
  /** Mice/second the bank is actually accruing (base rate × dev speed) —
   * stamped by the authority so dashboards don't re-run the economy fold. */
  cps: number;
  /** null until the wall is legible — the word never leaves the server before
   * that. (The night wall's painted word is client art; this is the checkable
   * answer the proctor sees.) */
  codeword: string | null;
}

export type HexClientMsg =
  | { type: "join"; name: string }
  | {
      type: "pets";
      count: number;
      seq: number;
      /** One entry per tap, ms BEFORE this message was sent (so <= 0). Carries
       * the rhythm of the taps inside a batch, which a bare count throws away —
       * teammates' mice are replayed on it. */
      offsets?: number[];
    } // batched client-side
  | { type: "buyBuilding"; id: string }
  | { type: "buyUpgrade"; key: string }
  | { type: "catchGold"; id: number }
  | { type: "reset" } // proctor only
  | { type: "speed"; mult: number }; // proctor only — dev time-scale


export type HexServerMsg =
  | { type: "state"; state: HexSnapshot }
  /** Highest `pets` batch seq from THIS connection that the next snapshot
   * already includes. The client drops its in-flight taps on this rather than
   * guessing a round-trip window. */
  | { type: "petAck"; seq: number };
