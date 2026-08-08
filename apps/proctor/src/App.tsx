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
    `${boughtN}/${UPGRADES.length} upgrades` +
      (s.speed !== 1 ? ` · ⏩×${s.speed}` : ""),
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

export function App() {
  const [room, setRoom] = useState<string | null>(null);

  if (!room) {
    return (
      <div className="setup">
        <h1>🐾 Escape Cats — Proctor</h1>
        <Lobby />
        <TeamsOverview onOpen={setRoom} />
      </div>
    );
  }
  return <Session room={room} onEnd={() => setRoom(null)} />;
}

/**
 * Live 4-up view of every team's game room, one proctor socket per team, so
 * the whole night is visible without opening a session. A tile is the way
 * into a team's session (QR code, reset, fast-forward).
 */
function TeamsOverview({ onOpen }: { onOpen: (teamId: string) => void }) {
  return (
    <section className="overview">
      <h2>Live games</h2>
      <div className="tiles">
        {TEAMS.map((t) => (
          <TeamTile key={t.id} team={t} onOpen={() => onOpen(t.id)} />
        ))}
      </div>
    </section>
  );
}

function TeamTile({ team, onOpen }: { team: Team; onOpen: () => void }) {
  const { progress: p } = useGameSocket(team.id, undefined, hexToProgress);
  return (
    <button className="tile" onClick={onOpen} title="Open session">
      <div className="tile-head">
        <strong>{team.name}</strong>
        {p?.codeword && (
          <span className="codeword">
            ✅ {p.codeword}
            {p.finishedMs !== null && ` · ${mmss(p.finishedMs)}`}
          </span>
        )}
      </div>
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
    </button>
  );
}

function Session({ room, onEnd }: { room: string; onEnd: () => void }) {
  const hex = useGameSocket(room, undefined, hexToProgress);

  return (
    <div className="session">
      <header>
        <h1>{TEAMS.find((t) => t.id === room)?.name ?? `Room ${room}`}</h1>
        <button onClick={onEnd}>End session</button>
      </header>
      <div className="games">
        <GamePanel
          title="🐱 Hex Clicker"
          joinUrl={`${HEX_URL}/?room=${room}`}
          game={hex}
          // Rehearsal fast-forward: accelerates income + golden cadence on the
          // server, never click feel. Resets to ×1 with the room.
          speeds={[1, 5, 20]}
        />
      </div>
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
  send: (msg: unknown) => void;
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
    return () => socket.close();
  }, [room, party]);

  return {
    progress,
    send: (msg) => socketRef.current?.send(JSON.stringify(msg)),
    reset: () => {
      if (confirm("Reset this game for the current room?")) {
        socketRef.current?.send(JSON.stringify({ type: "reset" }));
      }
    },
  };
}

function GamePanel({
  title,
  joinUrl,
  game,
  speeds,
}: {
  title: string;
  joinUrl: string;
  game: {
    progress: GameProgress | null;
    reset: () => void;
    send: (msg: unknown) => void;
  };
  speeds?: number[];
}) {
  const p = game.progress;
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="qr">
        <QRCode value={joinUrl} size={180} />
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
          {p.codeword && (
            <p className="codeword">
              ✅ Unlocked: {p.codeword}
              {p.finishedMs !== null && ` in ${mmss(p.finishedMs)}`}
            </p>
          )}
        </>
      ) : (
        <p className="detail">Connecting…</p>
      )}
      <div className="actions">
        {speeds && (
          <span className="speeds">
            {speeds.map((n) => (
              <button key={n} onClick={() => game.send({ type: "speed", mult: n })}>
                ×{n}
              </button>
            ))}
          </span>
        )}
        <button className="danger" onClick={game.reset}>
          Reset game
        </button>
      </div>
    </section>
  );
}
