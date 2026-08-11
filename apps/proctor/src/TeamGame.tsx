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
  /** Exactly STAT_LINES strings, whatever the state — see hexStats. */
  stats: string[];
  codeword: string | null;
  /** The run's finish time (legibleAt - startedAt), null until the wall is
   * readable. Lives in room storage with the rest of the run, so it survives an
   * eviction but not a reset. */
  finishedMs: number | null;
}

/** How many stat lines a game block draws. FIXED: a box that changed height
 * when a number got longer would shuffle every other box on the board. */
const STAT_LINES = 3;

/** The readout, as one string per line and never more than STAT_LINES of them.
 * Long values are clipped by CSS rather than wrapped, for the same reason. */
function hexStats(s: HexSnapshot | null): string[] {
  if (!s) return ["…", "…", `…/${UPGRADES.length} upgrades`];
  const phase = s.nightAt ? "🌙 night" : "☀️ day";
  const boughtN = Object.keys(s.bought).length;
  // The clock freezes at the finish — the run is scored, stop counting.
  const elapsed = mmss((s.legibleAt ?? s.serverTime) - s.startedAt);
  return [
    `${phase} · ${elapsed}`,
    `${Math.floor(s.mice).toLocaleString()} mice · ${Math.round(s.cps).toLocaleString()}/s`,
    `${boughtN}/${UPGRADES.length} upgrades`,
  ];
}

function toStatus(msg: HexServerMsg): HexStatus | null {
  return msg.type === "state"
    ? {
        progress: msg.state.progress,
        players: msg.state.players,
        stats: hexStats(msg.state),
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
 * EVERY line is drawn in every state — connecting, empty, mid-run, finished —
 * because a team's box must not change height as its state changes. It sits in
 * a grid with four others, so a box that grew by a line when a codeword landed
 * would move the boxes beside it out from under the proctor's finger, mid-drag.
 * Absent values become placeholders; long ones are clipped, never wrapped.
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

  const inRoom = new Set(
    (status?.players ?? []).filter((p) => p.connected).map((p) => p.id),
  );
  // Assigned but not in the game room — the useful direction, and the only
  // honest presence signal for a sorted phone. Who IS playing is already on
  // screen: it is the roster above this block, minus these names.
  const missing = assigned.filter((p) => !inRoom.has(p.pid)).map((p) => p.name);
  const presence = !status
    ? "connecting…"
    : `${inRoom.size} playing` +
      (missing.length > 0 ? ` · not in game: ${missing.join(", ")}` : "");
  const won = status?.codeword
    ? `✅ ${status.codeword}${status.finishedMs !== null ? ` · ${mmss(status.finishedMs)}` : ""}`
    : "codeword locked";

  return (
    <div className="games">
      <section className="game">
        <h3>🐱 Hex Clicker</h3>
        <div className="progressbar">
          <div style={{ width: `${(status?.progress ?? 0) * 100}%` }} />
        </div>
        {(status?.stats ?? hexStats(null)).map((line, i) => (
          <p className="stat" key={i} title={line}>
            {line}
          </p>
        ))}
        <p className="stat" title={presence}>
          {presence}
        </p>
        <p className={status?.codeword ? "stat codeword" : "stat"} title={won}>
          {won}
        </p>
        <button className="danger" onClick={reset}>
          Reset Hex
        </button>
      </section>

      {/* Goomba Rider, reserved. Its state has no server yet — the game keeps
       * its progress in each phone's localStorage — so this block is a
       * placeholder holding the shape the real one will take: the same heading,
       * bar and STAT_LINES readout, filled from a Goomba room once one exists.
       * Keeping it here (rather than in a box of its own) is the point of this
       * component being per TEAM rather than per game. */}
      <section className="game pending">
        <h3>🍄 Goomba Rider</h3>
        <div className="progressbar">
          <div style={{ width: 0 }} />
        </div>
        {Array.from({ length: STAT_LINES }, (_, i) => (
          <p
            className="stat"
            key={i}
            title={
              i === 0
                ? "Goomba Rider has no room server: each phone keeps its own progress in localStorage, so there is nothing to report here yet."
                : undefined
            }
          >
            {i === 0 ? "no server yet" : "—"}
          </p>
        ))}
      </section>
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
      if (confirm(`Reset ${teamName}'s Hex game back to the start?`)) {
        socketRef.current?.send(JSON.stringify({ type: "reset" }));
      }
    },
  };
}
