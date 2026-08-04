import { useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import QRCode from "react-qr-code";
import {
  UPGRADES,
  foldMods,
  baseCpsWith,
  type GoombaServerMsg,
  type HexServerMsg,
  type HexSnapshot,
  type PlayerInfo,
} from "@escape-cats/shared";

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";
const HEX_URL = import.meta.env.VITE_HEX_URL ?? "http://localhost:5173";
const GOOMBA_URL = import.meta.env.VITE_GOOMBA_URL ?? "http://localhost:5174";
const TOKEN = import.meta.env.VITE_PROCTOR_TOKEN ?? "dev-proctor";

function randomRoomCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O — QR text stays unambiguous
  return Array.from(
    crypto.getRandomValues(new Uint8Array(4)),
    (b) => letters[b % letters.length],
  ).join("");
}

interface GameProgress {
  progress: number;
  players: PlayerInfo[];
  detail: string;
  codeword: string | null;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function hexDetail(s: HexSnapshot): string {
  const phase = s.nightAt ? "🌙 night" : "☀️ day";
  const mps = baseCpsWith(foldMods(s.bought, s.owned), s.owned);
  const boughtN = Object.keys(s.bought).length;
  const elapsed = mmss(s.serverTime - s.startedAt);
  return [
    `${phase} · ${elapsed}`,
    `${Math.floor(s.mice).toLocaleString()} mice · ${Math.round(mps).toLocaleString()}/s`,
    `${boughtN}/${UPGRADES.length} upgrades` +
      (s.speed !== 1 ? ` · ⏩×${s.speed}` : ""),
  ].join("\n");
}

export function App() {
  const [room, setRoom] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => randomRoomCode());

  if (!room) {
    return (
      <div className="setup">
        <h1>🐾 Escape Cats — Proctor</h1>
        <p>Start a session for the next team.</p>
        <div className="row">
          <input
            value={draft}
            maxLength={8}
            onChange={(e) => setDraft(e.target.value.toUpperCase().trim())}
          />
          <button onClick={() => setDraft(randomRoomCode())}>🎲</button>
        </div>
        <button className="primary" disabled={!draft} onClick={() => setRoom(draft)}>
          Start session
        </button>
      </div>
    );
  }
  return <Session room={room} onEnd={() => setRoom(null)} />;
}

function Session({ room, onEnd }: { room: string; onEnd: () => void }) {
  const hex = useGameSocket(room, undefined, (msg: HexServerMsg): GameProgress | null =>
    msg.type === "state"
      ? {
          progress: msg.state.progress,
          players: msg.state.players,
          detail: hexDetail(msg.state),
          codeword: msg.state.codeword,
        }
      : null,
  );
  const goomba = useGameSocket(room, "goomba", (msg: GoombaServerMsg): GameProgress | null =>
    msg.type === "state"
      ? {
          progress: msg.state.progress,
          players: msg.state.players,
          detail: `${msg.state.levelsCleared}/${msg.state.totalLevels} levels · ${msg.state.targetsRemaining} targets left`,
          codeword: msg.state.codeword,
        }
      : null,
  );

  return (
    <div className="session">
      <header>
        <h1>Room {room}</h1>
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
        <GamePanel
          title="😾 Angry Goomba"
          joinUrl={`${GOOMBA_URL}/?room=${room}`}
          game={goomba}
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
      query: { role: "proctor", token: TOKEN },
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
          {p.codeword && <p className="codeword">✅ Unlocked: {p.codeword}</p>}
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
