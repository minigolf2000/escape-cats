import { useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import { closeWhileHidden } from "./closeWhileHidden";
import {
  TEAMS,
  type LobbyClientMsg,
  type LobbyPlayer,
  type LobbyServerMsg,
} from "@escape-cats/shared";

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";

/**
 * Live view of everyone sitting on the landing page, with the controls to sort
 * them onto teams. A team id is also the room id both games run in, so
 * assigning someone here is what puts them in a room later. The way into a
 * room (QR code, reset) is its tile in the teams overview below.
 */
export function Lobby() {
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [online, setOnline] = useState(false);
  const socketRef = useRef<PartySocket | null>(null);

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

  const unassigned = players.filter((p) => !p.team);
  const here = players.filter((p) => p.connected).length;

  return (
    <div className="lobby">
      <div className="lobby-head">
        <h2>
          Lobby{" "}
          <span className={online ? "dot on" : "dot"} title={online ? "connected" : "offline"} />
        </h2>
        <span className="muted">
          {here} here · {players.length - here} away
        </span>
      </div>

      {players.length === 0 && (
        <p className="muted">
          {online
            ? "Nobody has opened the landing page yet."
            : "Can't reach the lobby — is PartyKit running?"}
        </p>
      )}

      {unassigned.length > 0 && (
        <>
          <h3>Waiting to be sorted ({unassigned.length})</h3>
          <ul className="roster">
            {unassigned.map((p) => (
              <PlayerRow key={p.pid} player={p} onAssign={send} />
            ))}
          </ul>
        </>
      )}

      <div className="teams">
        {TEAMS.map((team) => {
          const members = players.filter((p) => p.team === team.id);
          return (
            <div className="team-col" key={team.id}>
              <div className="team-head">
                <strong>{team.name}</strong>
                <span className="muted">{members.length}</span>
              </div>
              <ul className="roster">
                {members.map((p) => (
                  <PlayerRow key={p.pid} player={p} onAssign={send} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="lobby-actions">
        <button
          className="small"
          disabled={unassigned.length === 0}
          onClick={() => send({ type: "autoAssign" })}
        >
          Auto-assign {unassigned.length || ""}
        </button>
        <button
          className="small"
          disabled={players.every((p) => !p.team)}
          onClick={() => {
            if (confirm("Clear every team assignment?")) send({ type: "clearTeams" });
          }}
        >
          Clear teams
        </button>
        <button
          className="small"
          disabled={players.length === here}
          onClick={() => {
            if (confirm("Forget everyone who has disconnected?")) send({ type: "forget" });
          }}
        >
          Forget away
        </button>
      </div>
    </div>
  );
}

function PlayerRow({
  player,
  onAssign,
}: {
  player: LobbyPlayer;
  onAssign: (msg: LobbyClientMsg) => void;
}) {
  return (
    <li className={player.connected ? "" : "offline"}>
      <span className="pname">{player.name}</span>
      <span className="pick">
        {TEAMS.map((t) => (
          <button
            key={t.id}
            className={player.team === t.id ? "chip on" : "chip"}
            title={t.name}
            onClick={() =>
              onAssign({
                type: "assign",
                pid: player.pid,
                // Tapping the team someone is already on takes them off it,
                // so a misclick is one tap to undo.
                team: player.team === t.id ? null : t.id,
              })
            }
          >
            {t.id.replace("t", "")}
          </button>
        ))}
      </span>
    </li>
  );
}
