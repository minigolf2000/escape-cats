import {
  Server,
  type Connection,
  type ConnectionContext,
  type WSMessage,
} from "partyserver";
import {
  CHAT_BURST,
  CHAT_HISTORY,
  CHAT_MAX_TEXT,
  CHAT_REFILL_MS,
  type ChatClientMsg,
  type ChatMessage,
  type ChatServerMsg,
} from "@escape-cats/shared";
import { Roster } from "./connections";

/**
 * One team's chat channel. The room id is the team id, so this DO is per team
 * exactly as the game room is.
 *
 * There is deliberately NO ticker in here. Chat is entirely event-driven, so
 * without a timer the room does nothing at all between messages — which is the
 * difference between a channel that costs nothing while nobody is typing and
 * one that bills like the game room.
 */
export class ChatServer extends Server<Env> {
  private roster = new Roster();
  /** The room's history, oldest first, capped at CHAT_HISTORY. */
  private history: ChatMessage[] = [];
  private nextId = 1;
  /** conn.id -> token bucket. Dropped with the connection. */
  private budget = new Map<string, { tokens: number; at: number }>();

  async onStart() {
    // Rehydrate BEFORE any connection is served: partyserver holds connections
    // until onStart resolves, so nobody ever sees an empty room that then
    // fills itself in.
    const stored = await this.ctx.storage.list<ChatMessage>({ prefix: "m:" });
    this.history = [...stored.values()];
    // Derived from the newest surviving message rather than persisted
    // separately — pruning only ever drops from the front, so the last entry is
    // always the highest id this room has issued.
    this.nextId = (this.history.at(-1)?.id ?? 0) + 1;
  }

  onConnect(conn: Connection, ctx: ConnectionContext) {
    this.roster.register(conn, ctx);
    const hello: ChatServerMsg = {
      type: "chat",
      messages: this.history,
      players: this.roster.list(),
    };
    conn.send(JSON.stringify(hello));
    this.broadcastPresence();
  }

  onClose(conn: Connection) {
    this.budget.delete(conn.id);
    this.roster.disconnect(conn);
    this.broadcastPresence();
  }

  async onMessage(sender: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    let msg: ChatClientMsg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg.type !== "say") return;

    const me = this.roster.get(sender);
    // Proctor connections are spectators here, same as in the game rooms.
    if (!me || me.role !== "player") return;

    // Collapsing whitespace before the clamp is what makes the clamp mean
    // something: a screenful of newlines is one line of content, and would
    // otherwise pass a length check while shoving the room off the screen.
    const text = String(msg.text)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, CHAT_MAX_TEXT);
    // Checked before spending a token, so an empty send is free rather than
    // burning someone's budget on nothing.
    if (!text) return;
    if (!this.spend(sender.id)) return;

    const entry: ChatMessage = {
      id: this.nextId++,
      pid: me.pid,
      name: me.name,
      text,
      at: Date.now(),
    };
    this.history.push(entry);
    const said: ChatServerMsg = { type: "said", message: entry };
    this.broadcast(JSON.stringify(said));
    await this.persist(entry);
  }

  /**
   * One small key per message, rather than the single-blob shape the lobby and
   * the game room use. Those two rewrite their whole state on every change,
   * which is right for state that mutates in place; a chat history only ever
   * appends, so a blob would turn a 200-byte write into a CHAT_HISTORY-sized
   * one on every line. Keys are zero-padded so the order `storage.list`
   * returns is also chronological.
   */
  private async persist(entry: ChatMessage) {
    await this.ctx.storage.put(key(entry.id), entry);
    // Trimmed in the same step that grew it, so storage and `history` cannot
    // drift apart.
    if (this.history.length > CHAT_HISTORY) {
      const dropped = this.history.splice(0, this.history.length - CHAT_HISTORY);
      await this.ctx.storage.delete(dropped.map((m) => key(m.id)));
    }
  }

  /**
   * Token bucket, per connection. Over the limit the message is dropped
   * SILENTLY: the only client that can reach this ceiling is a broken or
   * hostile one, and a rate limit that reports itself is one more thing to
   * fan out to the room.
   */
  private spend(id: string): boolean {
    const now = Date.now();
    const b = this.budget.get(id) ?? { tokens: CHAT_BURST, at: now };
    b.tokens = Math.min(CHAT_BURST, b.tokens + (now - b.at) / CHAT_REFILL_MS);
    b.at = now;
    this.budget.set(id, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private broadcastPresence() {
    const msg: ChatServerMsg = {
      type: "presence",
      players: this.roster.list(),
    };
    this.broadcast(JSON.stringify(msg));
  }
}

/** Storage key for one message, padded so lexicographic order is id order. */
const key = (id: number) => `m:${String(id).padStart(12, "0")}`;
