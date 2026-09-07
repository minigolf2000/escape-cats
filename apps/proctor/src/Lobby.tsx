import { useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import { closeWhileHidden } from "./closeWhileHidden";
import {
  earsFor,
  earsHeight,
  teamEarsSvg,
  TEAM_SIZE,
  TEAMS,
  type AdhocRoom,
  type LobbyClientMsg,
  type LobbyPlayer,
  type LobbyServerMsg,
  type Team,
} from "@escape-cats/shared";
import { PARTYKIT_HOST } from "./net";
import { TeamGame } from "./TeamGame";
import { TeamChat } from "./Chats";
import { TestRoom } from "./TestRoom";
import { AdhocRooms } from "./AdhocRooms";

/** Zone id for the players nobody has sorted yet. `null` is the wire value for
 * "no team"; this string never leaves the page. */
const UNSORTED = "unsorted";

/** Five drop targets: the holding pen, then the four teams. The pen borrows
 * `Team`'s shape so one loop can draw all five. */
const ZONES: Team[] = [{ id: UNSORTED, name: "Unassigned" }, ...TEAMS];

const zoneOf = (team: string | null) => team ?? UNSORTED;
const teamOf = (zone: string) => (zone === UNSORTED ? null : zone);

/** Who is MEANT to be on each team, typed by hand: a reading aid for the
 * proctor, not checked against the roster. Edit per event. */
const INTENDED: Record<string, string[]> = {
  t1: ["Deepa", "Emi", "Gia Hoa", "Zerah"],
  t2: ["Amanda", "John", "Kyle"],
  t3: ["Ashley", "Bill", "Krithi", "Vanessa"],
  t4: ["Alyssa", "Anamaria", "Patrin", "Will"],
};

/** Ear width on a zone box, px — small, the board is five boxes at once. */
const ZONE_EAR_W = 64;
/** Matches .zone's border-width in styles.css, so the ear's base and the box's
 * border meet without a step. */
const ZONE_BORDER = 2;

/** How far the pointer must travel before a press counts as a drag, so a
 * stray click on a name never reassigns anyone. */
const DRAG_SLOP = 5;

/** A drag held within this many px of the viewport's top/bottom edge scrolls
 * the board (up to SCROLL_MAX px/frame). Rows set `touch-action: none`, so a
 * zone below the fold is otherwise unreachable mid-drag. */
const SCROLL_EDGE = 56;
const SCROLL_MAX = 14;

interface Drag {
  /** The pointer this drag belongs to; a second finger is ignored, not adopted. */
  pointerId: number;
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


/** The board: five boxes; dragging a name is the only way to sort anyone, and
 * a team id is the room id both games run in. A box is also everything about
 * that room (TeamGame, TeamChat); Unassigned carries t0's readout, but no
 * chat — a channel is what the drag BUYS a phone, so those four exist and t0's
 * does not. POINTER events, not HTML5 drag-and-drop, which fires no dragstart
 * under a finger. */
export function Lobby() {
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  /** Only ever populated on a proctor's socket — the lobby sends every other
   * phone an empty list (see LobbySnapshot.adhoc). */
  const [adhoc, setAdhoc] = useState<AdhocRoom[]>([]);
  const [online, setOnline] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const socketRef = useRef<PartySocket | null>(null);
  /** Live drag state for the handlers — `drag` is for rendering, and a pointerup
   * must not act on a frame-stale copy of it. */
  const dragRef = useRef<Drag | null>(null);
  /** Detaches the active drag's window listeners and autoscroll loop. */
  const dragCleanup = useRef<(() => void) | null>(null);

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
      if (msg.type === "lobby") {
        setPlayers(msg.snapshot.players);
        // `?? []` covers the deploy window: a Worker that predates this field
        // would otherwise blank the board.
        setAdhoc(msg.snapshot.adhoc ?? []);
      }
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    socket.addEventListener("message", onMessage);
    // The close handler already dims the dot while the tab is hidden.
    const unbindVisibility = closeWhileHidden(socket);
    return () => {
      unbindVisibility();
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

  // Who is in which box, in one pass — counts, caps and rows all read this.
  const byZone = new Map<string, LobbyPlayer[]>(
    ZONES.map((z) => [z.id, [] as LobbyPlayer[]]),
  );
  for (const p of players) byZone.get(zoneOf(p.team))?.push(p);
  const isFull = (zone: string) =>
    zone !== UNSORTED && (byZone.get(zone)?.length ?? 0) >= TEAM_SIZE;

  /** The zone under the pointer, asked of the browser: the ghost is
   * `pointer-events: none`, and `closest` walks up from whatever is under it. */
  const zoneAt = (x: number, y: number): string | null =>
    document.elementFromPoint(x, y)?.closest<HTMLElement>(".zone")?.dataset
      .zone ?? null;

  const endDrag = () => {
    dragCleanup.current?.();
    dragCleanup.current = null;
    setDragState(null);
  };

  // The move/up/cancel handlers live on WINDOW for the drag's duration: a
  // lobby broadcast can unmount the dragged row mid-drag, which would strand
  // the ghost and leave a live drag record for the next pointerup to turn into
  // an assign. The pointerId check: only the starting pointer may steer it.
  const onDragMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    // A release we never got to see (capture lost while off-window, say):
    // no buttons down means this drag already ended, so end it.
    if (e.buttons === 0) return endDrag();
    const moved =
      d.moved ||
      Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > DRAG_SLOP;
    setDragState({
      ...d,
      x: e.clientX,
      y: e.clientY,
      over: moved ? zoneAt(e.clientX, e.clientY) : null,
      moved,
    });
  };
  const onDragUp = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    endDrag();
    if (!d.moved || !d.over || d.over === d.from) return;
    // A full team refuses the drop; the box already showed it wouldn't take it.
    if (isFull(d.over)) return;
    send({ type: "assign", pid: d.pid, team: teamOf(d.over) });
  };
  const onDragCancel = (e: PointerEvent) => {
    const d = dragRef.current;
    if (d && e.pointerId === d.pointerId) endDrag();
  };

  // Bound once per drag but must never act on a stale closure — a drop reads
  // isFull from the CURRENT roster — so they delegate through a ref re-pointed
  // every render.
  const liveDrag = useRef({ move: onDragMove, up: onDragUp, cancel: onDragCancel });
  liveDrag.current = { move: onDragMove, up: onDragUp, cancel: onDragCancel };

  const startDrag = (p: LobbyPlayer, e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (dragRef.current) return; // one drag at a time; later fingers are ignored
    // Capture so a MOUSE drag keeps reporting while outside the browser window.
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({
      pointerId: e.pointerId,
      pid: p.pid,
      name: p.name,
      from: zoneOf(p.team),
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      over: null,
      moved: false,
    });
    const move = (ev: PointerEvent) => liveDrag.current.move(ev);
    const up = (ev: PointerEvent) => liveDrag.current.up(ev);
    const cancel = (ev: PointerEvent) => liveDrag.current.cancel(ev);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    // Autoscroll near the viewport edge. The pointer doesn't move while the
    // board scrolls under it, so the drop target is re-asked here, not in the
    // move handler.
    let raf = requestAnimationFrame(function tick() {
      const d = dragRef.current;
      if (d?.moved) {
        const h = window.innerHeight;
        let dy = 0;
        if (d.y < SCROLL_EDGE) dy = -SCROLL_MAX * (1 - d.y / SCROLL_EDGE);
        else if (d.y > h - SCROLL_EDGE) dy = SCROLL_MAX * (1 - (h - d.y) / SCROLL_EDGE);
        if (dy) {
          window.scrollBy(0, dy);
          const over = zoneAt(d.x, d.y);
          if (over !== d.over) setDragState({ ...d, over });
        }
      }
      raf = requestAnimationFrame(tick);
    });
    dragCleanup.current = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  };

  // A drag must not outlive the board (proctor navigates mid-drag).
  useEffect(() => () => dragCleanup.current?.(), []);

  // No confirm: the phone reappears in Unassigned the moment it reconnects.
  const forget = (p: LobbyPlayer) => {
    send({ type: "forget", pid: p.pid });
  };

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
        {/* Not a here/away count: the lobby only knows who is on the landing
         * page (LobbyPlayer.connected). */}
        <span className="muted">
          {players.length} phones · {byZone.get(UNSORTED)?.length ?? 0} unsorted
        </span>
      </div>

      {/* Only with an empty board; with names on it the board explains itself. */}
      {players.length === 0 && (
        <p className="muted">
          {online
            ? "Nobody has opened the landing page yet."
            : "Can't reach the lobby — is the room server running?"}
        </p>
      )}

      <div
        className="zones"
        style={{ "--ear-h": `${earsHeight(ZONE_EAR_W)}px` } as React.CSSProperties}
      >
        {ZONES.map((z) => {
          const isTeam = z.id !== UNSORTED;
          const members = byZone.get(z.id) ?? [];
          const hovered =
            drag?.moved && drag.over === z.id && drag.from !== z.id;
          const ears = earsFor(isTeam ? z.id : null);
          return (
            <div
              key={z.id}
              data-zone={z.id}
              className={`zone${hovered ? (isFull(z.id) ? " blocked" : " over") : ""}`}
              // --team-tc is the resting colour; drag states override it
              // through --zone-tc, a CLASS that would lose to an inline
              // --zone-tc here (see .zone). The ears keep the team's colour.
              style={ears ? ({ "--team-tc": ears.ink } as React.CSSProperties) : undefined}
            >
              {/* Our own colour table, no player input. Raw because the ears
                  must be a child of the box they hang off. */}
              {ears && (
                <span
                  dangerouslySetInnerHTML={{
                    __html: teamEarsSvg(z.id, {
                      width: ZONE_EAR_W,
                      strokeWidth: ZONE_BORDER,
                      // Resting background only — .zone sets --ear-fill per
                      // drag state so the ear's interior tracks the box's.
                      panel: "#12141b",
                    }),
                  }}
                />
              )}
              <div className="zone-head">
                <strong>{z.name}</strong>
                <span className="muted">
                  {isTeam ? `${members.length}/${TEAM_SIZE}` : members.length}
                </span>
              </div>
              <ul className="roster">
                {members.map((p) => (
                  <PlayerRow
                    key={p.pid}
                    player={p}
                    // Struck through only in Unassigned, where "not connected"
                    // means the phone left the landing page. On a team it
                    // would strike through everyone playing.
                    offline={!isTeam && !p.connected}
                    lifted={Boolean(drag?.moved) && drag?.pid === p.pid}
                    onDragStart={startDrag}
                    onForget={forget}
                  />
                ))}
                {/* A team is four seats, always drawn, so a half-full team reads
                 * as unfinished at a glance rather than just short. */}
                {isTeam &&
                  Array.from(
                    { length: Math.max(0, TEAM_SIZE - members.length) },
                    (_, i) => (
                      <li key={`slot${i}`} className="slot">
                        empty slot
                      </li>
                    ),
                  )}
              </ul>
              {isTeam ? (
                <TeamGame team={z} assigned={members} />
              ) : (
                <>
                  {members.length === 0 && (
                    <p className="zone-empty">Drop here</p>
                  )}
                  {/* The pen's own game: every phone here plays the testing room. */}
                  <TestRoom />
                </>
              )}
              {/* Last block, TEAMS ONLY: there are four channels and the pen
                  is not one of them — an unsorted phone is still waiting to
                  be let into a chat at all. */}
              {isTeam && <TeamChat room={z.id} label={z.name} />}
              {/* The roster this team is supposed to end up with — see INTENDED. */}
              {isTeam && INTENDED[z.id] && (
                <p className="zone-intended">{INTENDED[z.id].join(" · ")}</p>
              )}
            </div>
          );
        })}
      </div>

      <AdhocRooms
        rooms={adhoc}
        onForget={(room) => send({ type: "forgetRoom", room })}
      />

      {drag?.moved && (
        // A transform, not left/top: runs on every pointermove, and an
        // out-of-flow transform skips layout (keeps zoneAt's hit test off the
        // read-after-write path).
        <div
          className="drag-ghost"
          style={{
            transform: `translate(${drag.x}px, ${drag.y}px) translate(-50%, -50%)`,
          }}
        >
          {drag.name}
        </div>
      )}
    </div>
  );
}

function PlayerRow({
  player,
  offline,
  lifted,
  onDragStart,
  onForget,
}: {
  player: LobbyPlayer;
  offline: boolean;
  lifted: boolean;
  onDragStart: (p: LobbyPlayer, e: React.PointerEvent) => void;
  onForget: (p: LobbyPlayer) => void;
}) {
  return (
    <li
      className={[offline && "offline", lifted && "lifted"]
        .filter(Boolean)
        .join(" ")}
      // Only the press starts here; the rest is on window, so it survives
      // this row unmounting.
      onPointerDown={(e) => onDragStart(player, e)}
    >
      <span className="pname">{player.name}</span>
      <button
        className="forget"
        title={`Forget ${player.name}`}
        // The row under it is the drag handle; a press on the × must not start one.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onForget(player)}
      >
        ×
      </button>
    </li>
  );
}
