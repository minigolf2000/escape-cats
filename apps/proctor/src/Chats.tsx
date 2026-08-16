import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

/**
 * Every channel, side by side, read-only.
 *
 * Chat is a line from a team to the proctor as much as between teammates, so
 * the dashboard reads them all rather than making someone open five tabs.
 * The proctor connects as `?role=proctor` — a spectator, exactly as in the
 * game rooms: the server refuses a `say` from this connection, and the Roster
 * never counts it, so watching a channel does not change the "n here" line the
 * team sees.
 *
 * It sits BELOW the board rather than inside the team boxes on purpose. A
 * team's box is a drop target of fixed height (see TeamGame), and a log that
 * grew by a line whenever somebody typed would shove the boxes beside it out
 * from under a proctor's finger, mid-drag. Down here it can scroll and grow
 * without touching the geometry of the drag.
 */
export function Chats() {
  const [byTeam, setByTeam] = useState<Record<string, ChatMessage[]>>({});
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
        setByTeam((prev) => {
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

  const total = Object.values(byTeam).reduce((n, ms) => n + ms.length, 0);

  return (
    <div className="chats">
      <div className="chats-head">
        <h2>Team chat</h2>
        <span className="muted">
          {total} {total === 1 ? "message" : "messages"} across {ROOMS.length}{" "}
          rooms
        </span>
        <button className="danger small" disabled={total === 0} onClick={clearAll}>
          Clear all chats
        </button>
      </div>
      <div className="chat-cols">
        {ROOMS.map((t) => (
          <ChatColumn
            key={t.id}
            name={t.name}
            messages={byTeam[t.id] ?? []}
            loaded={byTeam[t.id] !== undefined}
          />
        ))}
      </div>
    </div>
  );
}

const hhmm = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** One room's log. Fixed height and scrolled internally, so unequal
 * conversations keep the row one height rather than several. */
function ChatColumn({
  name,
  messages,
  loaded,
}: {
  name: string;
  messages: ChatMessage[];
  loaded: boolean;
}) {
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
      <h3>
        <span>{name}</span>
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
