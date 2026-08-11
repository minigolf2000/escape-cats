import { useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import {
  UPGRADES,
  type HexServerMsg,
  type HexSnapshot,
  type LobbyPlayer,
  type PlayerInfo,
} from "@escape-cats/shared";

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

interface HexStatus {
  progress: number;
  /** Who the ROOM has seen. `id` is the player's pid, so these match up with
   * the lobby's assignments. */
  players: PlayerInfo[];
  detail: string;
  codeword: string | null;
  /** The run's finish time (legibleAt - startedAt), null until the wall is
   * readable. Lives in room storage with the rest of the run, so it survives an
   * eviction but not a reset. */
  finishedMs: number | null;
}

function hexDetail(s: HexSnapshot): string {
  const phase = s.nightAt ? "🌙 night" : "☀️ day";
  const boughtN = Object.keys(s.bought).length;
  // The clock freezes at the finish — the run is scored, stop counting.
  const elapsed = mmss((s.legibleAt ?? s.serverTime) - s.startedAt);
  return [
    `${phase} · ${elapsed}`,
    `${Math.floor(s.mice).toLocaleString()} mice · ${Math.round(s.cps).toLocaleString()}/s`,
    `${boughtN}/${UPGRADES.length} upgrades`,
  ].join("\n");
}

function toStatus(msg: HexServerMsg): HexStatus | null {
  return msg.type === "state"
    ? {
        progress: msg.state.progress,
        players: msg.state.players,
        detail: hexDetail(msg.state),
        codeword: msg.state.codeword,
        finishedMs: msg.state.legibleAt
          ? msg.state.legibleAt - msg.state.startedAt
          : null,
      }
    : null;
}

/**
 * One team's live game state, rendered inside that team's drop target so
 * sorting and watching are the same box.
 *
 * Hex today. Goomba's status is meant to land here as a second block under the
 * same heading — which is why this component is keyed by TEAM rather than by
 * game, and why it takes the team's assigned roster rather than deriving a
 * player list of its own.
 */
export function TeamGame({
  team,
  assigned,
}: {
  team: { id: string; name: string };
  assigned: LobbyPlayer[];
}) {
  // The room id IS the team id, verbatim. Nothing upper- or lower-cases it on
  // any surface: Durable Object names are case-sensitive, so `t2` and `T2`
  // would be two separate games (which is exactly how a scanned QR code used
  // to strand half a team).
  const { status, reset } = useHexRoom(team.id, team.name);

  if (!status) return <p className="detail">Connecting…</p>;

  const inRoom = new Set(
    status.players.filter((p) => p.connected).map((p) => p.id),
  );
  // Assigned but not in the game room — the useful direction, and the only
  // honest presence signal for a sorted phone. Who IS playing is already on
  // screen: it is the roster above this block, minus these names.
  const missing = assigned.filter((p) => !inRoom.has(p.pid)).map((p) => p.name);

  return (
    <div className="game">
      {status.codeword && (
        <p className="codeword">
          ✅ {status.codeword}
          {status.finishedMs !== null && ` · ${mmss(status.finishedMs)}`}
        </p>
      )}
      <div className="progressbar">
        <div style={{ width: `${status.progress * 100}%` }} />
      </div>
      <p className="detail">{status.detail}</p>
      <p className="detail">
        {inRoom.size} playing
        {missing.length > 0 && ` · not in game: ${missing.join(", ")}`}
      </p>
      <button className="danger" onClick={reset}>
        Reset game
      </button>
    </div>
  );
}

function useHexRoom(
  room: string,
  teamName: string,
): { status: HexStatus | null; reset: () => void } {
  const [status, setStatus] = useState<HexStatus | null>(null);
  const socketRef = useRef<PartySocket | null>(null);

  useEffect(() => {
    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      room,
      query: { role: "proctor" },
    });
    socketRef.current = socket;
    socket.addEventListener("message", (e) => {
      const s = toStatus(JSON.parse(e.data as string));
      if (s) setStatus(s);
    });
    return () => socket.close();
  }, [room]);

  return {
    status,
    reset: () => {
      if (confirm(`Reset ${teamName}'s game back to the start?`)) {
        socketRef.current?.send(JSON.stringify({ type: "reset" }));
      }
    },
  };
}
