// Per-team chat. The room id IS the team id, as in the game rooms. No shared
// sim: this file is the whole contract — the server owns history and
// ordering, clients send a line of text.

import type { PlayerInfo } from "./protocol";
import type { RenameMsg } from "./lobby";

/** Longest message kept. Past this is TRUNCATED, not rejected. */
export const CHAT_MAX_TEXT = 240;

/** Messages a room remembers; older ones leave storage and are never replayed.
 * Bounds both storage and the join payload. */
export const CHAT_HISTORY = 200;

/** Per-connection token bucket: CHAT_BURST land instantly, then one per
 * CHAT_REFILL_MS. */
export const CHAT_BURST = 5;
export const CHAT_REFILL_MS = 700;

export interface ChatMessage {
  /** Monotonic within the room and the storage key's sort order. Clients
   * dedupe on it. */
  id: number;
  /** Author's persistent player id — how a client recognises its own lines. */
  pid: string;
  /** The author's name AT SEND TIME. Snapshotted rather than looked up later,
   * so renaming yourself doesn't rewrite what you already said. */
  name: string;
  text: string;
  /** Server clock (ms epoch) when the message was accepted. */
  at: number;
}

export type ChatClientMsg =
  | { type: "say"; text: string }
  /** Forwarded to the LOBBY, which owns the roster. Lines already said keep
   * the name they were said under — see `ChatMessage.name`. */
  | RenameMsg
  /** Wipe this room's history. Proctor only. Per ROOM: a Durable Object can
   * only clear itself. */
  | { type: "clear" };

export type ChatServerMsg =
  /** The room as it stands: on connect, and again after a proctor clear —
   * clients REPLACE their history on it. */
  | { type: "chat"; messages: ChatMessage[]; players: PlayerInfo[] }
  /** One accepted message, fanned out to the room. */
  | { type: "said"; message: ChatMessage }
  /** Someone joined or left. */
  | { type: "presence"; players: PlayerInfo[] };
