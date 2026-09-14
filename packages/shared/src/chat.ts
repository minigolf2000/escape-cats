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

/**
 * Who the proctor is when it talks, and it talks as an ORDINARY PLAYER.
 *
 * The board reads all four channels as a spectator (`?role=proctor`), and a
 * spectator's `say` is refused — so to answer a team it opens a SECOND socket
 * per room under these two, which the server seats like any phone. That keeps
 * the whole feature on Vercel: no carve-out in `ChatServer`, nothing to deploy
 * mid-event, and it works against a Worker that has never heard of it.
 *
 * What it costs, in exchange:
 * - The proctor takes a seat in that room's roster, so it appears in the
 *   phone's "n here" — which is why the board opens the socket LAZILY, on the
 *   first line sent, and never for a team it is only watching.
 * - The mark is a pid, not a server stamp, so it is only as good as the fact
 *   that a phone's own pid is a `crypto.randomUUID` it never chose. Typing the
 *   name is not enough to forge it; editing localStorage is. That is the right
 *   trade for a party game and the wrong one for anything else — if this ever
 *   needs to be true, it becomes a `from: "proctor"` the SERVER stamps, and
 *   the deploy that costs.
 *
 * Clients key the look on the PID. The name is what an old bundle draws in the
 * `who` slot, so it has to read as a name and obey the lobby's rules.
 */
export const PROCTOR_NAME = "Proctor";
export const PROCTOR_PID = "proctor";

/** An answer is the same field as a chat line — it is typed into the same
 * input — so it clamps to the same length. One rule, never two. */
export const ANSWER_MAX_TEXT = CHAT_MAX_TEXT;

/** Submissions a room remembers. Far below CHAT_HISTORY: a team makes a
 * handful all event, and the proctor's box lists them. */
export const ANSWER_HISTORY = 40;

/** A submission's own, stingier bucket. Chat is chatter and wants CHAT_BURST;
 * an answer SHOUTS on the proctor's board, so four bored phones must not be
 * able to fill it. Deliberately not a share of the chat bucket: hitting this
 * limit must never cost someone the ability to talk to their team. */
export const ANSWER_BURST = 2;
export const ANSWER_REFILL_MS = 15_000;

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

/**
 * One answer a team has put in front of the proctor.
 *
 * This is a chat message said LOUDER, and nothing more. It is still its own
 * kind rather than a `ChatMessage` with a flag, for two reasons a flag could
 * not carry: its own budget (`ANSWER_BURST` — the louder a message is, the
 * less it may be spammed), and its own storage, so a proctor clearing the
 * chatter mid-event does not take the team's code words with it. Clients
 * merge the two lists by `at` to draw one log.
 *
 * There is NO verdict and NO acknowledgement, on purpose. Nothing in this app
 * handles a submission: it lands on the proctor's board where it cannot be
 * missed, and everything after that happens in the room. A `correct` boolean
 * would be a score board nobody asked this repo to keep, and an acknowledged
 * stamp would promise a press nobody is going to make.
 */
export interface AnswerSubmission {
  /** Monotonic within the room, in its own sequence — clients dedupe on it.
   * Never compared against a `ChatMessage.id`. */
  id: number;
  pid: string;
  /** The submitter's name AT SUBMIT TIME, as `ChatMessage.name` is. */
  name: string;
  text: string;
  /** Server clock (ms epoch) when the submission was accepted. */
  at: number;
}

export type ChatClientMsg =
  | { type: "say"; text: string }
  /** Put a line in front of the proctor as this team's answer. Same input,
   * same clamp as `say`; a separate type because it costs a different
   * budget and is kept in a different place. */
  | { type: "submit"; text: string }
  /** Forwarded to the LOBBY, which owns the roster. Lines already said keep
   * the name they were said under — see `ChatMessage.name`. */
  | RenameMsg
  /** Wipe this room. Proctor only. Per ROOM: a Durable Object can only clear
   * itself. `clear` is once again the ONLY thing a proctor sends into a
   * channel — proctors are spectators, with no carve-out. SCOPED, and
   * defaulting to the chat, because the two want
   * different things: wiping the chatter mid-event must not take the team's
   * submissions with it, but a room reused by the next event has to be able
   * to drop both. An omitted scope is the old behaviour. */
  | { type: "clear"; scope?: "chat" | "answers" | "all" };

export type ChatServerMsg =
  /** The room as it stands: on connect, and again after a proctor clear —
   * clients REPLACE their history on it. `answers` rides along so a client
   * holds the whole room after one message; a clear sends the SAME (unwiped)
   * submissions back, which is what keeps them out of the wipe. */
  | {
      type: "chat";
      messages: ChatMessage[];
      players: PlayerInfo[];
      answers: AnswerSubmission[];
    }
  /** One accepted message, fanned out to the room. */
  | { type: "said"; message: ChatMessage }
  /** One accepted submission, fanned out to the room — teammates see it the
   * moment it lands, which is what stops four phones sending it four times. */
  | { type: "submitted"; answer: AnswerSubmission }
  /** Someone joined or left. */
  | { type: "presence"; players: PlayerInfo[] };
