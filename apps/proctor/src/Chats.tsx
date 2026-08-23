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

/** Every channel that can have anybody in it: the four teams, and the testing
 * room while it is open. Same list drives the sockets, the columns and the
 * clear-all fan-out, so they cannot disagree about what "all chats" means. */
const ROOMS: Team[] = OPEN_ROOM_OPEN ? [...TEAMS, OPEN_TEAM] : TEAMS;

interface ChatState {
  byRoom: Record<string, ChatMessage[]>;
  total: number;
  clearAll: () => void;
  rooms: Team[];
}

const ChatCtx = createContext<ChatState | null>(null);

/**
 * Every channel's socket, in one place, above the board.
 *
 * Chat is a line from a team to the proctor as much as between teammates, so
 * the dashboard reads them all rather than making someone open five tabs. The
 * proctor connects as `?role=proctor` — a spectator, exactly as in the game
 * rooms: the server refuses a `say` from this connection, and the Roster never
 * counts it, so watching a channel does not change the "n here" line the team
 * sees.
 *
 * The LOGS are drawn inside the zone boxes (see TeamChat), but the sockets are
 * not: they belong to the page, not to a box. Five connections that opened and
 * closed as the board re-rendered would replay history on every reconnect, and
 * the clear-all fan-out needs to hold all five at once anyway.
 */
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [byRoom, setByRoom] = useState<Record<string, ChatMessage[]>>({});
  /** One socket per room, kept for the clear-all fan-out. */
  const socketsRef = useRef<PartySocket[]>([]);

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
              // History as the server has it — on connect, on reconnect, and
              // after a clear. Always a replace, never an append.
              return { ...prev, [t.id]: msg.messages };
            case "said": {
              const have = prev[t.id] ?? [];
              // Dedupe on id: a reconnect can replay a line we already hold.
              if (have.some((m) => m.id === msg.message.id)) return prev;
              return { ...prev, [t.id]: [...have, msg.message] };
            }
            default:
              // Presence is already on screen — the team's box counts who is
              // in the game, which is the number a proctor acts on.
              return prev;
          }
        });
      });
      return { socket, unbindVisibility: closeWhileHidden(socket) };
    });
    socketsRef.current = opened.map((o) => o.socket);
    return () => {
      for (const o of opened) {
        o.unbindVisibility();
        o.socket.close();
      }
      socketsRef.current = [];
    };
  }, []);

  /** Wipe every channel. A Durable Object can only clear itself, so "global"
   * is this fan-out over the sockets the page already holds — not a new
   * server-side broadcast path between rooms. */
  const clearAll = () => {
    if (!confirm(`Delete every message in all ${ROOMS.length} chats?`)) return;
    const msg: ChatClientMsg = { type: "clear" };
    for (const socket of socketsRef.current) socket.send(JSON.stringify(msg));
  };

  const total = Object.values(byRoom).reduce((n, ms) => n + ms.length, 0);

  return (
    <ChatCtx.Provider value={{ byRoom, total, clearAll, rooms: ROOMS }}>
      {children}
    </ChatCtx.Provider>
  );
}

/** The board's chat state. Null outside the provider, which is a programming
 * error rather than a state to render — App wraps the whole page. */
export function useChats(): ChatState {
  const ctx = useContext(ChatCtx);
  if (!ctx) throw new Error("useChats outside ChatProvider");
  return ctx;
}

const hhmm = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * One room's log, drawn at the bottom of that room's box — the last block in
 * the same stack as the game readouts, because it answers the same question
 * they do: how is this team getting on? The Unassigned box gets the testing
 * room's channel, which is the channel every phone in that box is typing in.
 *
 * It used to sit below the board, out of the drag's way. What made that
 * necessary was height: a box is a drop target, and one that grew by a line
 * whenever somebody typed would shove the boxes beside it out from under a
 * proctor's finger, mid-drag. The log has been fixed-height and internally
 * scrolled all along, so it can live in the box without ever moving it — that
 * is the property to keep, not the position.
 */
export function TeamChat({ room }: { room: string }) {
  const { byRoom } = useChats();
  const messages = byRoom[room] ?? [];
  const loaded = byRoom[room] !== undefined;
  const logRef = useRef<HTMLOListElement | null>(null);
  /** Whether the log was scrolled to the bottom BEFORE this render, measured
   * in the commit that painted the previous list. A proctor reading back
   * through a conversation must not be yanked to the end by a new line. */
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
      {/* Titled like a game block, not with the team's name: the box's own head
          already says whose this is, and a second copy of it read as a card
          sitting inside the box rather than a part of it. */}
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
              {/* React escapes this; the proctor page renders the same
                  arbitrary player-authored text the chat client does, and it
                  never goes near innerHTML here either. */}
              <span className="chat-body">{m.text}</span>
              <time className="chat-at" dateTime={new Date(m.at).toISOString()}>
                {hhmm(m.at)}
              </time>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
