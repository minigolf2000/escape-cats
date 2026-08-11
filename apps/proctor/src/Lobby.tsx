import { useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import {
  TEAM_SIZE,
  TEAMS,
  type LobbyClientMsg,
  type LobbyPlayer,
  type LobbyServerMsg,
} from "@escape-cats/shared";
import { TeamGame } from "./TeamGame";

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";

/** Zone id for the players nobody has sorted yet. `null` is the wire value for
 * "no team"; this string never leaves the page. */
const UNSORTED = "unsorted";

/** Five drop targets: the holding pen, then the four teams. */
const ZONES = [{ id: UNSORTED, name: "Unassigned" }, ...TEAMS];

const zoneOf = (team: string | null) => team ?? UNSORTED;
const teamOf = (zone: string) => (zone === UNSORTED ? null : zone);

/** How far the pointer must travel before a press counts as a drag, so a
 * stray click on a name never reassigns anyone. */
const DRAG_SLOP = 5;

interface Drag {
  pid: string;
  name: string;
  /** Zone the player was in when the drag started — dropping back is a no-op. */
  from: string;
  /** Where the press landed, for the slop test. */
  x0: number;
  y0: number;
  /** Current pointer position, for the ghost. */
  x: number;
  y: number;
  /** Zone under the pointer, or null past the edge of all five. */
  over: string | null;
  /** Past the slop threshold — until then this is still just a click. */
  moved: boolean;
}

/**
 * The board: five boxes, and dragging a name between them is the only way to
 * sort anyone. A team id is also the room id both games run in, so dropping
 * someone on Team 2 is what puts them in room t2 — there is no other route in.
 *
 * A team's box is ALSO that team's live game status (see TeamGame), because the
 * two answer the same question: how is Team 2 doing? Only the Unassigned box is
 * a bare holding pen.
 *
 * The drag runs on POINTER events rather than HTML5 drag-and-drop, which fires
 * no dragstart under a finger. Dragging is the whole interface now, so a
 * proctor holding a tablet would otherwise have no way to sort anybody.
 */
export function Lobby() {
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [online, setOnline] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const socketRef = useRef<PartySocket | null>(null);
  /** Live drag state for the handlers — `drag` is for rendering, and a pointerup
   * must not act on a frame-stale copy of it. */
  const dragRef = useRef<Drag | null>(null);
  /** zone id -> its box, for hit-testing the pointer against real geometry. */
  const zoneEls = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      room: "main",
      party: "lobby",
      query: { role: "proctor" },
    });
    socketRef.current = socket;
    const onOpen = () => setOnline(true);
    const onClose = () => setOnline(false);
    const onMessage = (ev: MessageEvent) => {
      let msg: LobbyServerMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === "lobby") setPlayers(msg.snapshot.players);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    socket.addEventListener("message", onMessage);
    return () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("message", onMessage);
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const send = (msg: LobbyClientMsg) =>
    socketRef.current?.send(JSON.stringify(msg));

  const setDragState = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const zoneAt = (x: number, y: number): string | null => {
    for (const [id, el] of zoneEls.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return null;
  };

  const onRowPointerDown = (p: LobbyPlayer, e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Capture so the drag survives the pointer leaving the row it started on —
    // which it does immediately, since the target is another box.
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({
      pid: p.pid,
      name: p.name,
      from: zoneOf(p.team),
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      over: zoneOf(p.team),
      moved: false,
    });
  };

  const onRowPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const moved =
      d.moved ||
      Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > DRAG_SLOP;
    setDragState({
      ...d,
      x: e.clientX,
      y: e.clientY,
      over: moved ? zoneAt(e.clientX, e.clientY) : d.over,
      moved,
    });
  };

  const isFull = (zone: string) =>
    zone !== UNSORTED &&
    players.filter((p) => p.team === zone).length >= TEAM_SIZE;

  const onRowPointerUp = () => {
    const d = dragRef.current;
    setDragState(null);
    if (!d || !d.moved || !d.over || d.over === d.from) return;
    // A full team refuses the drop; the box already showed it wouldn't take it.
    if (isFull(d.over)) return;
    send({ type: "assign", pid: d.pid, team: teamOf(d.over) });
  };

  const forget = (p: LobbyPlayer) => {
    // Always asks. It would be nicer to skip the prompt for someone who has
    // gone home, but `connected` cannot tell us that for a sorted player (see
    // the count above), so a conditional prompt would fire on exactly the wrong
    // half. The × also sits inside a drag handle, where a misclick is cheap.
    if (
      !confirm(
        `Forget ${p.name}? They drop off the board until their phone reconnects.`,
      )
    )
      return;
    send({ type: "forget", pid: p.pid });
  };

  const unsorted = players.filter((p) => !p.team).length;

  return (
    <div className="lobby">
      <div className="lobby-head">
        <h2>
          Lobby{" "}
          <span
            className={online ? "dot on" : "dot"}
            title={online ? "connected" : "offline"}
          />
        </h2>
        {/* Deliberately not a here/away count. `connected` here means "holding a
         * socket to the LOBBY", and a phone drops that the moment it learns its
         * team (watchTeam closes it), so every player who is actually in a game
         * reads as away. Per-team presence comes from the game itself, below. */}
        <span className="muted">
          {players.length} phones · {unsorted} unsorted
        </span>
      </div>

      <p className="muted">
        {players.length === 0
          ? online
            ? "Nobody has opened the landing page yet."
            : "Can't reach the lobby — is the room server running?"
          : "Drag a name between boxes to sort it. × forgets a player."}
      </p>

      <div className="zones">
        {ZONES.map((z) => {
          const members = players.filter((p) => zoneOf(p.team) === z.id);
          const full = isFull(z.id);
          const hovered = drag?.moved && drag.over === z.id && drag.from !== z.id;
          return (
            <div
              key={z.id}
              ref={(el) => {
                if (el) zoneEls.current.set(z.id, el);
                else zoneEls.current.delete(z.id);
              }}
              className={`zone${hovered ? (full ? " blocked" : " over") : ""}`}
            >
              <div className="zone-head">
                <strong>{z.name}</strong>
                <span className="muted">
                  {z.id === UNSORTED
                    ? members.length
                    : `${members.length}/${TEAM_SIZE}`}
                </span>
              </div>
              <ul className="roster">
                {members.map((p) => (
                  <li
                    key={p.pid}
                    className={
                      // Struck through only in Unassigned, where "not connected"
                      // honestly means the phone has left the landing page. On a
                      // team it would strike through everyone who is playing.
                      (z.id === UNSORTED && !p.connected ? "offline " : "") +
                      (drag?.moved && drag.pid === p.pid ? "lifted" : "")
                    }
                    onPointerDown={(e) => onRowPointerDown(p, e)}
                    onPointerMove={onRowPointerMove}
                    onPointerUp={onRowPointerUp}
                    onPointerCancel={() => setDragState(null)}
                  >
                    <span className="pname">{p.name}</span>
                    <button
                      className="forget"
                      title={`Forget ${p.name}`}
                      // The row under it is the drag handle; a press on the ×
                      // must not start one.
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => forget(p)}
                    >
                      ×
                    </button>
                  </li>
                ))}
                {/* A team is four seats, always drawn, so a half-full team reads
                 * as unfinished at a glance rather than just short. */}
                {z.id !== UNSORTED &&
                  Array.from(
                    { length: Math.max(0, TEAM_SIZE - members.length) },
                    (_, i) => (
                      <li key={`slot${i}`} className="slot">
                        empty slot
                      </li>
                    ),
                  )}
              </ul>
              {z.id === UNSORTED && members.length === 0 && (
                <p className="zone-empty">Drop here</p>
              )}
              {z.id !== UNSORTED && (
                <TeamGame team={z} assigned={members} />
              )}
            </div>
          );
        })}
      </div>

      <div className="lobby-actions">
        <button
          className="small"
          disabled={players.every((p) => !p.team)}
          onClick={() => {
            if (confirm("Send every player back to Unassigned?"))
              send({ type: "clearTeams" });
          }}
        >
          Clear teams
        </button>
      </div>

      {drag?.moved && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          {drag.name}
        </div>
      )}
    </div>
  );
}
