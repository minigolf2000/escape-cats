import {
  Server,
  type Connection,
  type ConnectionContext,
  type WSMessage,
} from "partyserver";
import {
  ANSWER_BURST,
  ANSWER_HISTORY,
  ANSWER_MAX_TEXT,
  ANSWER_REFILL_MS,
  CHAT_BURST,
  CHAT_HISTORY,
  CHAT_MAX_TEXT,
  CHAT_REFILL_MS,
  type AnswerSubmission,
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
  /** The team's answers, oldest first, capped at ANSWER_HISTORY. Its own
   * list and its own `a:` keys: a proctor's Clear chat empties `history`
   * and must not take the submissions with it. */
  private answers: AnswerSubmission[] = [];
  private nextAnswerId = 1;
  /** conn.id -> token bucket. Dropped with the connection — and with a
   * hibernation eviction, which merely refills everyone's burst. */
  private budget = new Map<string, { tokens: number; at: number }>();
  /** The same, for submissions. A SECOND map, not a share of the first:
   * spending your answers must never cost you the ability to talk. */
  private answerBudget = new Map<string, { tokens: number; at: number }>();

  async onStart() {
    // Rehydrate BEFORE serving: partyserver holds connections until onStart
    // resolves.
    const stored = await this.ctx.storage.list<ChatMessage>({ prefix: "m:" });
    this.history = [...stored.values()];
    // Pruning only drops from the front, so the last entry is the highest id.
    this.nextId = (this.history.at(-1)?.id ?? 0) + 1;
    const subs = await this.ctx.storage.list<AnswerSubmission>({ prefix: "a:" });
    this.answers = [...subs.values()];
    this.nextAnswerId = (this.answers.at(-1)?.id ?? 0) + 1;
  }

  onConnect(conn: Connection, ctx: ConnectionContext) {
    this.roster.register(conn, ctx);
    const hello: ChatServerMsg = {
      type: "chat",
      messages: this.history,
      players: this.roster.list(),
      answers: this.answers,
    };
    conn.send(JSON.stringify(hello));
    this.broadcastPresence();
  }

  onClose(conn: Connection) {
    this.budget.delete(conn.id);
    this.answerBudget.delete(conn.id);
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
      if (this.roster.isProctor(sender)) await this.clear(msg.scope ?? "chat");
      return;
    }
    if (msg.type === "rename") {
      await this.renameIntent(sender, msg.name);
      return;
    }
    if (msg.type === "submit") {
      await this.submitIntent(sender, msg.text);
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

  /** Put a line in front of the proctor. Same shape as `say` — clamp, then
   * spend, then stamp — but off its own budget and into its own list. */
  private async submitIntent(sender: Connection, raw: unknown) {
    const me = this.roster.get(sender);
    // Proctors are spectators; a spectator has no answer to give.
    if (!me || me.role !== "player") return;

    const text = String(raw)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, ANSWER_MAX_TEXT);
    if (!text) return;
    if (
      !this.spend(sender.id, this.answerBudget, ANSWER_BURST, ANSWER_REFILL_MS)
    ) {
      return;
    }

    const entry: AnswerSubmission = {
      id: this.nextAnswerId++,
      pid: me.pid,
      name: me.name,
      text,
      at: Date.now(),
    };
    this.answers.push(entry);
    const out: ChatServerMsg = { type: "submitted", answer: entry };
    this.broadcast(JSON.stringify(out));
    await this.persistAnswer(entry);
  }

  /** One key per submission, under its own prefix so `clear` (which deletes
   * by `m:`) cannot reach them. */
  private async persistAnswer(entry: AnswerSubmission) {
    await this.ctx.storage.put(answerKey(entry.id), entry);
    if (this.answers.length > ANSWER_HISTORY) {
      const dropped = this.answers.splice(
        0,
        this.answers.length - ANSWER_HISTORY,
      );
      await this.ctx.storage.delete(dropped.map((a) => answerKey(a.id)));
    }
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
   * goes out as a plain `chat` snapshot, which clients already REPLACE both
   * lists on. Neither `nextId` is rewound: clients dedupe on id. */
  private async clear(scope: "chat" | "answers" | "all") {
    if (scope !== "answers") {
      await this.dropByPrefix("m:");
      this.history = [];
    }
    if (scope !== "chat") {
      await this.dropByPrefix("a:");
      this.answers = [];
    }
    const wiped: ChatServerMsg = {
      type: "chat",
      messages: this.history,
      players: this.roster.list(),
      answers: this.answers,
    };
    this.broadcast(JSON.stringify(wiped));
  }

  /** By prefix, not deleteAll(); chunked because storage.delete() takes at
   * most 128 keys. */
  private async dropByPrefix(prefix: string) {
    const keys = [...(await this.ctx.storage.list({ prefix })).keys()];
    for (let i = 0; i < keys.length; i += 128) {
      await this.ctx.storage.delete(keys.slice(i, i + 128));
    }
  }

  /** Token bucket per connection. Over the limit the message is dropped
   * SILENTLY — only a broken or hostile client reaches it. Takes its own
   * map and limits so chat and submissions cannot spend each other's. */
  private spend(
    id: string,
    budget = this.budget,
    burst = CHAT_BURST,
    refillMs = CHAT_REFILL_MS,
  ): boolean {
    const now = Date.now();
    const b = budget.get(id) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + (now - b.at) / refillMs);
    b.at = now;
    budget.set(id, b);
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

/** The same for one submission. A DIFFERENT prefix is the whole reason a
 * proctor's Clear chat leaves the answers standing — see `clear`. */
const answerKey = (id: number) => `a:${String(id).padStart(12, "0")}`;
