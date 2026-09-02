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
  OPEN_ROOM_OPEN,
  OPEN_TEAM,
  TEAMS,
  type ChatClientMsg,
  type ChatMessage,
  type ChatServerMsg,
  type Team,
} from "@escape-cats/shared";
import { closeWhileHidden } from "./closeWhileHidden";
import { PARTYKIT_HOST } from "./net";

/** Every channel that can have anybody in it. One list drives sockets and
 * logs. */
const ROOMS: Team[] = OPEN_ROOM_OPEN ? [...TEAMS, OPEN_TEAM] : TEAMS;

interface ChatState {
  byRoom: Record<string, ChatMessage[]>;
  /** Wipe ONE channel, named by its room id. `label` is the box's own name,
   * for the confirm — the wire only knows `t2`. */
  clear: (room: string, label: string) => void;
  rooms: Team[];
}

const ChatCtx = createContext<ChatState | null>(null);

/** Every channel's socket, above the board. The proctor connects
 * `?role=proctor` — a spectator: the server refuses its `say` and the Roster
 * never counts it. Sockets belong to the page, not a box: reopening on board
 * re-renders would replay history, and a box's Clear sends down the socket
 * already held. */
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [byRoom, setByRoom] = useState<Record<string, ChatMessage[]>>({});
  /** One socket per room id — how a box's Clear finds its channel. */
  const socketsRef = useRef<Map<string, PartySocket>>(new Map());

  useEffect(() => {
    const opened = ROOMS.map((t) => {
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
      opened.map((o, i) => [ROOMS[i].id, o.socket] as const),
    );
    return () => {
      for (const o of opened) {
        o.unbindVisibility();
        o.socket.close();
      }
      socketsRef.current = new Map();
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

  return (
    <ChatCtx.Provider value={{ byRoom, clear, rooms: ROOMS }}>
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
  const { byRoom, clear } = useChats();
  const messages = byRoom[room] ?? [];
  const loaded = byRoom[room] !== undefined;
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
        <span>💬 Chat</span>
        <span className="muted">{messages.length}</span>
      </h3>
      <ol className="chat-log" ref={logRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <li className="chat-empty">{loaded ? "No messages" : "connecting…"}</li>
        ) : (
          messages.map((m) => (
            <li className="chat-line" key={m.id}>
              <span className="chat-who">{m.name}</span>
              {/* Player-authored text: React escapes it, never innerHTML. */}
              <span className="chat-body">{m.text}</span>
              <time className="chat-at" dateTime={new Date(m.at).toISOString()}>
                {hhmm(m.at)}
              </time>
            </li>
          ))
        )}
      </ol>
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
