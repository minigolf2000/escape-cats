import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import PartySocket from "partysocket";
import {
  CHAT_MAX_TEXT,
  PROCTOR_NAME,
  PROCTOR_PID,
  TEAMS,
  type AnswerSubmission,
  type ChatClientMsg,
  type ChatMessage,
  type ChatServerMsg,
} from "@escape-cats/shared";
import { closeWhileHidden } from "./closeWhileHidden";
import { PARTYKIT_HOST } from "./net";

interface ChatState {
  byRoom: Record<string, ChatMessage[]>;
  /** Submissions per room. Held apart from the messages because the server
   * does: they have their own storage and survive a Clear chat. */
  answersByRoom: Record<string, AnswerSubmission[]>;
  /** Wipe ONE channel, named by its room id. `label` is the box's own name,
   * for the confirm — the wire only knows `t2`. */
  clear: (room: string, label: string) => void;
  /** Answer ONE team, in the channel they are already looking at. Goes down a
   * socket of its own — see `sayer`. */
  say: (room: string, text: string) => void;
}

const ChatCtx = createContext<ChatState | null>(null);

/** Every channel's socket, above the board — one per TEAM, which is every
 * channel there is: an unsorted phone has not been let into a chat at all.
 * The proctor READS on `?role=proctor`, a spectator, and TALKS on a second
 * socket seated as a player (`sayer`), because that is the only kind the
 * server takes a `say` from. Sockets belong to the page, not a box: reopening
 * on board re-renders would replay history, and a box's Clear sends down the
 * socket already held. */
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [byRoom, setByRoom] = useState<Record<string, ChatMessage[]>>({});
  const [answersByRoom, setAnswers] = useState<
    Record<string, AnswerSubmission[]>
  >({});
  /** One socket per room id — how a box's Clear finds its channel. */
  const socketsRef = useRef<Map<string, PartySocket>>(new Map());
  /** The OTHER socket per room, and only for the rooms this proctor has
   * actually talked in: the one seated as a player, which is the only kind
   * whose `say` the server accepts. Opened on the first line and kept, so a
   * team the proctor only watches never sees anyone arrive. */
  const sayersRef = useRef<Map<string, { socket: PartySocket; off: () => void }>>(
    new Map(),
  );

  useEffect(() => {
    const opened = TEAMS.map((t) => {
      const socket = new PartySocket({
        host: PARTYKIT_HOST,
        room: t.id,
        party: "chat",
        query: { role: "proctor" },
      });
      socket.addEventListener("message", (ev) => {
        let msg: ChatServerMsg;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (msg.type === "chat") {
          setAnswers((prev) => ({ ...prev, [t.id]: msg.answers ?? [] }));
        } else if (msg.type === "submitted") {
          setAnswers((prev) => {
            const have = prev[t.id] ?? [];
            // Dedupe on id, as the messages do; ids are per-LIST.
            if (have.some((a) => a.id === msg.answer.id)) return prev;
            return { ...prev, [t.id]: [...have, msg.answer] };
          });
        }
        setByRoom((prev) => {
          switch (msg.type) {
            case "chat":
              // History as the server has it: always a REPLACE (connect,
              // reconnect, clear).
              return { ...prev, [t.id]: msg.messages };
            case "said": {
              const have = prev[t.id] ?? [];
              // Dedupe on id: a reconnect can replay a line we already hold.
              if (have.some((m) => m.id === msg.message.id)) return prev;
              return { ...prev, [t.id]: [...have, msg.message] };
            }
            default:
              // Presence is already on screen via the team's box.
              return prev;
          }
        });
      });
      return { socket, unbindVisibility: closeWhileHidden(socket) };
    });
    socketsRef.current = new Map(
      opened.map((o, i) => [TEAMS[i].id, o.socket] as const),
    );
    return () => {
      for (const o of opened) {
        o.unbindVisibility();
        o.socket.close();
      }
      socketsRef.current = new Map();
      for (const s of sayersRef.current.values()) {
        s.off();
        s.socket.close();
      }
      sayersRef.current = new Map();
    };
  }, []);

  /** Wipe one channel: a Durable Object can only clear itself. The confirm
   * lives here so every destructive chat press asks the same question. */
  const clear = (room: string, label: string) => {
    const n = (byRoom[room] ?? []).length;
    if (!confirm(`Delete ${n} message${n === 1 ? "" : "s"} from ${label}'s chat?`))
      return;
    const msg: ChatClientMsg = { type: "clear" };
    socketsRef.current.get(room)?.send(JSON.stringify(msg));
  };

  /** This room's player socket, opened the first time it is needed. It carries
   * no message listener: the spectator socket above is already holding this
   * room's log, and a second one would double every line. */
  const sayer = (room: string): PartySocket => {
    const open = sayersRef.current.get(room);
    if (open) return open.socket;
    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      room,
      party: "chat",
      // No `role`, which IS the point — a proctor-role socket's `say` is
      // dropped. `pid` is stable so a reconnect reclaims the same seat rather
      // than seating a second Proctor, and is what a phone draws the line by.
      query: { pid: PROCTOR_PID, name: PROCTOR_NAME },
    });
    const off = closeWhileHidden(socket);
    sayersRef.current.set(room, { socket, off });
    return socket;
  };

  /** Clamp exactly as the server will (collapse, trim, truncate) so the board
   * and the room never disagree about what was said. An empty line is not a
   * line, and costs no token. */
  const say = (room: string, raw: string) => {
    const text = raw.replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_TEXT);
    if (!text) return;
    const msg: ChatClientMsg = { type: "say", text };
    // partysocket queues anything sent while it is still connecting, so the
    // first line of the session does not need the socket to be open yet.
    sayer(room).send(JSON.stringify(msg));
  };

  return (
    <ChatCtx.Provider value={{ byRoom, answersByRoom, clear, say }}>
      {children}
    </ChatCtx.Provider>
  );
}

/** Null outside the provider is a programming error — App wraps the page. */
export function useChats(): ChatState {
  const ctx = useContext(ChatCtx);
  if (!ctx) throw new Error("useChats outside ChatProvider");
  return ctx;
}

const hhmm = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** One room's log, the last block in that room's box. It may live in a drop
 * target ONLY because it is fixed-height and internally scrolled — a box that
 * grew when somebody typed would shove its neighbours out from under a drag. */
export function TeamChat({ room, label }: { room: string; label: string }) {
  const { byRoom, answersByRoom, clear, say } = useChats();
  /** The half-typed line, per box. Held here rather than in the provider so
   * four drafts cannot collide, and so a line typed into one team's box is
   * still there after a drag re-renders the board. */
  const [draft, setDraft] = useState("");
  const messages = byRoom[room] ?? [];
  const answers = answersByRoom[room] ?? [];
  const loaded = byRoom[room] !== undefined;
  // One log, two lists, merged on the server's clock — the only one both were
  // stamped by. The LAST submission is pinned to the log's bottom edge and so
  // is drawn outside the scroller; a newer one simply replaces it, which is
  // why pinning needs no press to undo and no state to track.
  const latest = answers.at(-1) ?? null;
  const rows: (
    | { at: number; kind: "say"; m: ChatMessage }
    | { at: number; kind: "answer"; a: AnswerSubmission }
  )[] = [
    ...messages.map((m) => ({ at: m.at, kind: "say" as const, m })),
    ...answers
      .filter((a) => a !== latest)
      .map((a) => ({ at: a.at, kind: "answer" as const, a })),
  ].sort((p, q) => p.at - q.at);
  const logRef = useRef<HTMLOListElement | null>(null);
  /** Whether the log was at the bottom BEFORE this render, so a proctor
   * reading back is not yanked to the end. */
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (pinned.current) log.scrollTop = log.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const log = logRef.current;
    if (!log) return;
    pinned.current = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  };

  return (
    <section className="chat-col">
      {/* Titled like a game block; the box's head already says whose. */}
      <h3>
        <span>Chat</span>
        <span className="muted">{messages.length}</span>
      </h3>
      <ol className="chat-log" ref={logRef} onScroll={onScroll}>
        {rows.length === 0 ? (
          <li className="chat-empty">{loaded ? "No messages" : "connecting…"}</li>
        ) : (
          rows.map((r) =>
            r.kind === "say" ? (
              <li
                // Keyed on the PID, never the name: a player may call
                // themselves Proctor and must not be dressed as one here
                // either.
                className={
                  r.m.pid === PROCTOR_PID ? "chat-line proctor" : "chat-line"
                }
                key={`m${r.m.id}`}
              >
                <span className="chat-who">{r.m.name}</span>
                {/* Player-authored text: React escapes it, never innerHTML. */}
                <span className="chat-body">{r.m.text}</span>
                <time className="chat-at" dateTime={new Date(r.m.at).toISOString()}>
                  {hhmm(r.m.at)}
                </time>
              </li>
            ) : (
              <li className="chat-line answer past" key={`a${r.a.id}`}>
                <span className="chat-who">{r.a.name}</span>
                <span className="chat-body">{r.a.text}</span>
                <time className="chat-at" dateTime={new Date(r.a.at).toISOString()}>
                  {hhmm(r.a.at)}
                </time>
              </li>
            ),
          )
        )}
      </ol>
      {/* The one loud thing on the board, and the only saturated fill in the
          box. Outside the scroller so the chatter cannot carry it away — the
          earlier inline sketch was sliced in half by this log's 150px. Always
          rendered, invisible when empty, so the box height never moves. */}
      <div className={latest ? "answer-pin on" : "answer-pin"}>
        {latest ? (
          <>
            <span className="answer-who">Answer &middot; {latest.name}</span>
            <span className="answer-body">{latest.text}</span>
            <time className="answer-at" dateTime={new Date(latest.at).toISOString()}>
              {hhmm(latest.at)}
            </time>
          </>
        ) : null}
      </div>
      {/* Answering the team, in the channel they are already reading. One row,
          fixed height: the box is a drop target and nothing in it may grow
          under a drag. Send is always DRAWN and disabled at empty, the same
          shape as Clear chat below — and Enter sends, because this is a
          chat. */}
      <form
        className="chat-say"
        onSubmit={(e) => {
          e.preventDefault();
          say(room, draft);
          // Cleared optimistically, with no line echoed into the log: the
          // server owns ordering and truncation, and its `said` is already on
          // its way back down the socket that draws this box.
          setDraft("");
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={CHAT_MAX_TEXT}
          autoComplete="off"
          enterKeyHint="send"
          aria-label={`Message ${label}`}
          placeholder={`Message ${label}`}
        />
        <button className="small" type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
      {/* One wipe per channel, in the box it wipes. Always drawn, disabled
          at zero: this is a drop target and its height must not move. */}
      <button
        className="small danger"
        disabled={messages.length === 0}
        onClick={() => clear(room, label)}
      >
        Clear chat
      </button>
    </section>
  );
}
