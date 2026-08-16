// Per-team chat.
//
// The room id IS the team id — the same convention the game rooms use, so the
// proctor putting someone on "t2" is also what puts them in t2's channel.
// Nothing else has to agree on anything.
//
// Unlike the hex room there is no shared simulation here, so this file is the
// whole contract: the server owns history and ordering, clients only ever send
// a line of text.

import type { PlayerInfo } from "./protocol";

/**
 * Longest message the server keeps. Anything past this is TRUNCATED, not
 * rejected — a player who pastes an essay should see it land clipped rather
 * than silently vanish with no idea why.
 */
export const CHAT_MAX_TEXT = 240;

/**
 * How many messages a room remembers. Older ones leave storage and are never
 * replayed. A team talks for about ten minutes, so this is comfortably more
 * than a session needs, and it bounds both the stored size and the payload a
 * joining phone has to swallow.
 */
export const CHAT_HISTORY = 200;

/**
 * Per-connection token bucket: CHAT_BURST messages land instantly, then one
 * more every CHAT_REFILL_MS. Sized for how people actually type — several
 * short lines in a row is normal — while keeping a held key or a loop from
 * fanning out the whole room.
 */
export const CHAT_BURST = 5;
export const CHAT_REFILL_MS = 700;

export interface ChatMessage {
  /** Monotonic within the room, and the sort order of its storage key.
   * Clients dedupe on it, so a reconnect that replays history cannot
   * double-render a line. */
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
  /**
   * Wipe this room's history — proctor only, and the one destructive thing a
   * chat room can be asked to do. It is per ROOM because a Durable Object can
   * only clear itself; the proctor page's "Clear all chats" is one button
   * fanned out over the socket it already holds to each team.
   */
  | { type: "clear" };

export type ChatServerMsg =
  /**
   * The room as it stands. Sent once per connection before anything else —
   * and again to everyone after a proctor clear, which is why clients REPLACE
   * their history on it rather than treating it as a hello.
   */
  | { type: "chat"; messages: ChatMessage[]; players: PlayerInfo[] }
  /** One accepted message, fanned out to the room. */
  | { type: "said"; message: ChatMessage }
  /** Someone joined or left. */
  | { type: "presence"; players: PlayerInfo[] };
