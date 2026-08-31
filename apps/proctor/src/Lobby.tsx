import { useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import { closeWhileHidden } from "./closeWhileHidden";
import {
  earsFor,
  earsHeight,
  teamEarsSvg,
  OPEN_ROOM_OPEN,
  OPEN_TEAM,
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

/** Who is MEANT to be on each team, typed in by hand. Purely a reading aid for
 * the proctor doing the sorting — nothing reads it but the line at the bottom
 * of a team's box, and it is not checked against the actual roster, because a
 * name on a phone is whatever that player typed. Edit it per event. */
const INTENDED: Record<string, string[]> = {
  t1: ["Deepa", "Emi", "Gia Hoa", "Zerah"],
  t2: ["Amanda", "John", "Kyle"],
  t3: ["Ashley", "Bill", "Krithi", "Vanessa"],
  t4: ["Alyssa", "Anamaria", "Patrin", "Will"],
};

/** Ear width on a zone box, in px. Small — the board is five boxes at once and
 * the ears are here to be matched against heads across the room, not admired. */
const ZONE_EAR_W = 64;
/** Matches .zone's border-width in styles.css, so the ear's base and the box's
 * border meet without a step. */
const ZONE_BORDER = 2;

/** How far the pointer must travel before a press counts as a drag, so a
 * stray click on a name never reassigns anyone. */
const DRAG_SLOP = 5;

/** A drag held within this many px of the viewport's top/bottom edge scrolls
 * the board (up to SCROLL_MAX px per frame). Dragging is the only way to sort
 * anyone, so a zone below the fold must be reachable mid-drag — rows set
 * `touch-action: none`, which kills native scrolling for exactly the gesture
 * that needs it most. */
const SCROLL_EDGE = 56;
const SCROLL_MAX = 14;

interface Drag {
  /** The pointer this drag belongs to. There is one drag record, so a second
   * finger landing on another row must be ignored, not adopted — otherwise
   * both fingers steer one ghost and somebody gets dropped on the wrong team. */
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


/**
 * The board: five boxes, and dragging a name between them is the only way to
 * sort anyone. A team id is also the room id both games run in, so dropping
 * someone on Team 2 is what puts them in room t2 — there is no other route in.
 *
 * A box is ALSO everything else about the room those players are in — the live
 * game status (see TeamGame) and the chat log (see TeamChat) — because they all
 * answer the same question: how is Team 2 doing? Unassigned is no exception,
 * and that is the point of it being a zone at all: its players are exactly the
 * phones in the shared testing room, so it carries t0's readout and t0's
 * channel in the same two slots a team's box uses.
 *
 * The drag runs on POINTER events rather than HTML5 drag-and-drop, which fires
 * no dragstart under a finger. Dragging is the whole interface now, so a
 * proctor holding a tablet would otherwise have no way to sort anybody.
 */
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
        // `?? []` for the deploy window, not for a bug: CI starts the Worker
        // and Vercel at once on a push to main, and a snapshot from a Worker
        // that predates this field would otherwise blank the whole board.
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

  // Who is in which box, in one pass — the counts, the caps and the rows all
  // read from this, so they cannot disagree about what "in zone z" means.
  const byZone = new Map<string, LobbyPlayer[]>(
    ZONES.map((z) => [z.id, [] as LobbyPlayer[]]),
  );
  for (const p of players) byZone.get(zoneOf(p.team))?.push(p);
  const isFull = (zone: string) =>
    zone !== UNSORTED && (byZone.get(zone)?.length ?? 0) >= TEAM_SIZE;

  /** The zone under the pointer, asked of the browser rather than measured: the
   * ghost is `pointer-events: none`, and `closest` walks up from whatever row or
   * button the pointer is actually over. */
  const zoneAt = (x: number, y: number): string | null =>
    document.elementFromPoint(x, y)?.closest<HTMLElement>(".zone")?.dataset
      .zone ?? null;

  const endDrag = () => {
    dragCleanup.current?.();
    dragCleanup.current = null;
    setDragState(null);
  };

  // The move/up/cancel handlers live on WINDOW for the drag's duration, not on
  // the row. Handlers on the row die with it — and a lobby broadcast can
  // unmount the dragged row mid-drag (another proctor tab sorting the same
  // player), which used to strand the ghost on screen and leave a live drag
  // record that the next unrelated pointerup turned into a surprise assign.
  // The pointerId check is the other half: only the pointer that started the
  // drag may steer or finish it.
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

  // The window listeners are bound once per drag, but must never act on a
  // stale closure — a drop reads isFull from the CURRENT roster, not the one
  // at drag start. So they delegate through a ref re-pointed every render.
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
    // Held near the viewport's top/bottom edge, the board scrolls under the
    // drag. The pointer doesn't move while that happens, so the drop target
    // has to be re-asked here, not in the move handler.
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

  // No confirm: forgetting is cheap to undo — the phone reappears in Unassigned
  // the moment it reconnects — and the prompt fired on every tidy-up.
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
        {/* Deliberately not a here/away count: the lobby only knows who is on
         * the landing page (see LobbyPlayer.connected), so every phone that has
         * moved on to a game would read as away. */}
        <span className="muted">
          {players.length} phones · {byZone.get(UNSORTED)?.length ?? 0} unsorted
        </span>
      </div>

      {/* Only speaks up when the board is empty — with names on it, the board
       * explains itself and the line was just standing there. */}
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
              // --team-tc is the box's resting colour; the drag states override
              // it through --zone-tc, which is a CLASS and would lose to an
              // inline --zone-tc here (see .zone in styles.css). The ears keep
              // the team's colour throughout — they say WHICH team this is,
              // and that doesn't change because a name is hovering over it.
              style={ears ? ({ "--team-tc": ears.ink } as React.CSSProperties) : undefined}
            >
              {/* Markup from our own colour table — no player input reaches it.
                  It goes in raw because the ears have to be a child of the box
                  they hang off, and one drawing serves this React board, the
                  lobby's template literals and chat alike. */}
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
                    // honestly means the phone has left the landing page. On a
                    // team it would strike through everyone who is playing.
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
                  {/* The holding pen's own game: every phone in this box is
                      playing the shared testing room, so it gets the readout a
                      team's box gets, in the same slot. */}
                  <TestRoom />
                </>
              )}
              {/* Last block in the box, for teams and the pen alike. The pen
                  reads t0's channel, because that is the room its phones are
                  typing in. Skipped when the testing room is closed — there is
                  no channel to read then. */}
              {(isTeam || OPEN_ROOM_OPEN) && (
                <TeamChat
                  room={isTeam ? z.id : OPEN_TEAM.id}
                  label={isTeam ? z.name : OPEN_TEAM.name}
                />
              )}
              {/* Last line in the box: the roster this team is supposed to end
                  up with. A reference while dragging, nothing more — see
                  INTENDED. */}
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
        // Moved with a transform, not left/top: this runs on every pointermove,
        // and an out-of-flow transform skips layout — which also keeps zoneAt's
        // hit test off the read-after-write path.
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
      // Only the press starts here — the rest of the drag is handled on
      // window, so it survives this row unmounting under a lobby update.
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
