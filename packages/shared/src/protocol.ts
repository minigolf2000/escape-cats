// Wire protocol shared by clients, the proctor and the Worker. JSON over
// WebSocket; server state is authoritative, clients only send intents.

import type { HexSimState } from "./hex/sim";

export interface PlayerInfo {
  id: string;
  name: string;
  connected: boolean;
}

// ---- Hex Clicker ----

/** One teammate tap in server time, so every phone replays it at the same
 * offset. Slot (0..3) rather than pid: smaller, and already what picks a colour. */
export interface TapEvent {
  slot: number;
  at: number;
  /** Where on Hex the finger landed, as a fraction of her bounding box from
   * her left/top edge (0..1) — a different size per phone, the same aspect
   * ratio. Absent when the tap carried no spot; those replay scattered. */
  x?: number;
  y?: number;
}

/** Full authoritative snapshot, broadcast on every tick (~4Hz) and after every
 * intent. Clients extrapolate income between snapshots with the same shared
 * rules, so the counter stays smooth. */
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
  /** The PROCTOR's progress readout: null until the wall is legible. Player
   * clients don't read it — their win screen shows HEX_CODEWORD directly. */
  codeword: string | null;
}

export type HexClientMsg =
  | { type: "join"; name: string }
  | {
      type: "pets";
      count: number;
      seq: number;
      /** One per tap, ms BEFORE this message was sent (<= 0): the rhythm
       * inside a batch, which teammates' mice are replayed on. */
      offsets?: number[];
      /** Where each tap landed, in THOUSANDTHS of her box (0..1000),
       * index-aligned with `offsets`. Integers for the wire; the server
       * divides them back out. */
      xs?: number[];
      ys?: number[];
    } // batched client-side
  | { type: "buyBuilding"; id: string }
  | { type: "buyUpgrade"; key: string }
  | { type: "catchGold"; id: number }
  /** The proctor witnessing the win. Proctor only; a toggle, not a latch, so
   * a mis-press can be taken back without a reset (HexSim.setWon). */
  | { type: "won"; won: boolean }
  | { type: "reset" }; // proctor only


export type HexServerMsg =
  | { type: "state"; state: HexSnapshot }
  /** Highest `pets` seq from THIS connection the next snapshot includes; the
   * client drops its in-flight taps on it. */
  | { type: "petAck"; seq: number };
