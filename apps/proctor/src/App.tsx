import { useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import QRCode from "react-qr-code";
import { Lobby } from "./Lobby";
import {
  TEAMS,
  UPGRADES,
  type HexServerMsg,
  type HexSnapshot,
  type PlayerInfo,
  type Team,
} from "@escape-cats/shared";

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";
const HEX_URL = import.meta.env.VITE_HEX_URL ?? "http://localhost:5173";

interface GameProgress {
  progress: number;
  players: PlayerInfo[];
  detail: string;
  codeword: string | null;
  /** The run's finish time (legibleAt - startedAt), null until the wall is
   * readable. Lives in room storage with the rest of the run, so it survives
   * evictions but not a reset. */
  finishedMs: number | null;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

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

function hexToProgress(msg: HexServerMsg): GameProgress | null {
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

/** The whole page is one level: the lobby roster plus every team's tile. No
 * subviews — everything a proctor does happens from here. */
export function App() {
  return (
    <div className="setup">
      <h1>🐾 Escape Cats — Proctor</h1>
      <Lobby />
      <TeamsOverview />
    </div>
  );
}

/**
 * Live 4-up view of every team's game room, one proctor socket per team, so
 * the whole night is visible on one screen. A tile carries everything a team
 * needs: the QR code into its room, live progress, and reset.
 */
function TeamsOverview() {
  return (
    <section className="overview">
      <h2>Live games</h2>
      <div className="tiles">
        {TEAMS.map((t) => (
          <TeamTile key={t.id} team={t} />
        ))}
      </div>
    </section>
  );
}

function TeamTile({ team }: { team: Team }) {
  const { progress: p, reset } = useGameSocket(team.id, undefined, hexToProgress);
  const joinUrl = `${HEX_URL}/?room=${team.id}`;
  return (
    <div className="tile">
      <div className="tile-head">
        <strong>{team.name}</strong>
        {p?.codeword && (
          <span className="codeword">
            ✅ {p.codeword}
            {p.finishedMs !== null && ` · ${mmss(p.finishedMs)}`}
          </span>
        )}
      </div>
      <div className="qr">
        <QRCode value={joinUrl} size={120} />
      </div>
      <a href={joinUrl} target="_blank" rel="noreferrer" className="join-url">
        {joinUrl}
      </a>
      {p ? (
        <>
          <div className="progressbar">
            <div style={{ width: `${p.progress * 100}%` }} />
          </div>
          <p className="detail">{p.detail}</p>
          <p className="players">
            {p.players.length === 0
              ? "No players yet"
              : p.players.map((pl) => (
                  <span key={pl.id} className={pl.connected ? "" : "offline"}>
                    {pl.name}
                  </span>
                ))}
          </p>
        </>
      ) : (
        <p className="detail">Connecting…</p>
      )}
      <button className="danger" onClick={reset}>
        Reset game
      </button>
    </div>
  );
}

function useGameSocket<M>(
  room: string,
  party: string | undefined,
  toProgress: (msg: M) => GameProgress | null,
): {
  progress: GameProgress | null;
  reset: () => void;
} {
  const [progress, setProgress] = useState<GameProgress | null>(null);
  const socketRef = useRef<PartySocket | null>(null);
  const toProgressRef = useRef(toProgress);
  toProgressRef.current = toProgress;

  useEffect(() => {
    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      room,
      party,
      query: { role: "proctor" },
    });
    socketRef.current = socket;
    socket.addEventListener("message", (e) => {
      const p = toProgressRef.current(JSON.parse(e.data));
      if (p) setProgress(p);
    });
    // A hidden tab drops its sockets. partysocket reconnects forever, so a
    // proctor tab forgotten in the background would otherwise hold one socket
    // per team all night — and every server broadcasts each connect/close to
    // the room, work done on nobody's behalf. On return, reconnect: onConnect
    // sends a fresh snapshot, so the tile repaints itself.
    const onVisibility = () => {
      if (document.hidden) socket.close();
      else socket.reconnect();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      socket.close();
    };
  }, [room, party]);

  return {
    progress,
    reset: () => {
      if (confirm("Reset this game for the current room?")) {
        socketRef.current?.send(JSON.stringify({ type: "reset" }));
      }
    },
  };
}
