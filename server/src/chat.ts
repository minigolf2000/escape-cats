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
 * One team's chat channel; room id = team id, as the game room. There are four
 * ever — `src/index.ts` 404s an upgrade to any other room id. NO ticker: chat
 * is event-driven, so an idle room costs nothing.
 */
export class ChatServer extends Server<Env> {
  // Hibernate, or a backgrounded chat tab's socket pins the object resident.
  static options = { hibernate: true };

  private roster = new Roster(() => this.getConnections());
  /** The room's history, oldest first, capped at CHAT_HISTORY. */
  private history: ChatMessage[] = [];
  private nextId = 1;
  /** conn.id -> token bucket. Dropped with the connection — and with a
   * hibernation eviction, which merely refills everyone's burst. */
  private budget = new Map<string, { tokens: number; at: number }>();

  async onStart() {
    // Rehydrate BEFORE serving: partyserver holds connections until onStart
    // resolves.
    const stored = await this.ctx.storage.list<ChatMessage>({ prefix: "m:" });
    this.history = [...stored.values()];
    // Pruning only drops from the front, so the last entry is the highest id.
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
    if (msg.type === "clear") {
      // The role is a claim, not a credential (Roster); it guards a wipe of
      // a channel the proctor can already read.
      if (this.roster.isProctor(sender)) await this.clear();
      return;
    }
    if (msg.type === "rename") {
      await this.renameIntent(sender, msg.name);
      return;
    }
    if (msg.type !== "say") return;

    const me = this.roster.get(sender);
    // Proctors are spectators.
    if (!me || me.role !== "player") return;

    // Collapse whitespace BEFORE the clamp, or a screenful of newlines passes
    // the length check.
    const text = String(msg.text)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, CHAT_MAX_TEXT);
    // Before spending a token: an empty send is free.
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

  /** Rename the sender everywhere. This room's own roster first, so "n here"
   * updates the moment Save is pressed, then the LOBBY, which owns the name
   * the board and both games read. */
  private async renameIntent(sender: Connection, raw: unknown) {
    const me = this.roster.get(sender);
    // Proctors are spectators here too — a spectator has no name to change.
    if (!me || me.role !== "player") return;
    // Spend BEFORE cleaning, as `say` clamps before it spends: cleaning is
    // proportional to what arrives, and this is a write-through per press.
    if (!this.spend(sender.id)) return;
    const name = this.roster.rename(sender, raw);
    if (!name || name === me.name) return;
    this.broadcastPresence();
    try {
      await this.env.Lobby.get(this.env.Lobby.idFromName("main")).fetch(
        "http://lobby/name",
        { method: "POST", body: JSON.stringify({ pid: me.pid, name }) },
      );
    } catch {
      // An unreachable lobby costs the board this rename, not the chat: the
      // phone keeps the name locally and re-sends it as its `?name=` on the
      // next connect.
    }
  }

  /** One key per message, zero-padded so `storage.list` order is
   * chronological. Not one blob: history only appends, and a blob would
   * rewrite CHAT_HISTORY entries per line. */
  private async persist(entry: ChatMessage) {
    await this.ctx.storage.put(key(entry.id), entry);
    // Trimmed in the same step, so storage and `history` cannot drift.
    if (this.history.length > CHAT_HISTORY) {
      const dropped = this.history.splice(0, this.history.length - CHAT_HISTORY);
      await this.ctx.storage.delete(dropped.map((m) => key(m.id)));
    }
  }

  /** Empty the channel in storage and memory, and tell everyone. The wipe
   * goes out as a plain `chat` snapshot, which clients already REPLACE their
   * history on. `nextId` is NOT rewound: clients dedupe on id. */
  private async clear() {
    // By prefix, not deleteAll(); chunked because storage.delete() takes at
    // most 128 keys.
    const keys = [...(await this.ctx.storage.list({ prefix: "m:" })).keys()];
    for (let i = 0; i < keys.length; i += 128) {
      await this.ctx.storage.delete(keys.slice(i, i + 128));
    }
    this.history = [];
    const wiped: ChatServerMsg = {
      type: "chat",
      messages: [],
      players: this.roster.list(),
    };
    this.broadcast(JSON.stringify(wiped));
  }

  /** Token bucket per connection. Over the limit the message is dropped
   * SILENTLY — only a broken or hostile client reaches it. */
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
