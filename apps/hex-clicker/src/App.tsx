import { useEffect, useRef, useState } from "react";
import type PartySocket from "partysocket";
import {
  HEX_BALANCE,
  upgradeCost,
  type HexServerMsg,
  type HexState,
} from "@escape-cats/shared";
import { connect, roomFromUrl } from "./net";
import { ToyCanvas } from "./ToyCanvas";

const CLICK_FLUSH_MS = 150;

export function App() {
  const [room] = useState(() => roomFromUrl());
  const [name, setName] = useState(
    () => localStorage.getItem("escape-cats-name") ?? "",
  );
  const [joined, setJoined] = useState(false);

  if (!room) {
    return (
      <div className="screen center">
        <h1>🐱 Hex Clicker</h1>
        <p>Scan the room QR code to join your team.</p>
      </div>
    );
  }
  if (!joined) {
    return (
      <div className="screen center">
        <h1>🐱 Hex Clicker</h1>
        <p>Room {room}</p>
        <input
          value={name}
          placeholder="Your name"
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="primary"
          disabled={!name.trim()}
          onClick={() => {
            localStorage.setItem("escape-cats-name", name.trim());
            setJoined(true);
          }}
        >
          Join
        </button>
      </div>
    );
  }
  return <Game room={room} name={name.trim()} />;
}

function Game({ room, name }: { room: string; name: string }) {
  const [state, setState] = useState<HexState | null>(null);
  const socketRef = useRef<PartySocket | null>(null);
  const pendingClicks = useRef(0);
  // Offset between server clock and this phone's clock, so every phone
  // renders the toy animation on the same timeline.
  const clockOffset = useRef(0);

  useEffect(() => {
    const socket = connect({ room, name });
    socketRef.current = socket;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "join", name }));
    });
    socket.addEventListener("message", (e) => {
      const msg: HexServerMsg = JSON.parse(e.data);
      if (msg.type === "state") {
        clockOffset.current = msg.state.serverTime - Date.now();
        setState(msg.state);
      }
    });
    const flush = setInterval(() => {
      if (pendingClicks.current > 0 && socket.readyState === socket.OPEN) {
        socket.send(
          JSON.stringify({ type: "clicks", count: pendingClicks.current }),
        );
        pendingClicks.current = 0;
      }
    }, CLICK_FLUSH_MS);
    return () => {
      clearInterval(flush);
      socket.close();
    };
  }, [room, name]);

  if (!state) {
    return (
      <div className="screen center">
        <p>Connecting…</p>
      </div>
    );
  }

  return (
    <div className="screen game">
      <ToyCanvas
        seed={state.seed}
        toyCount={state.toyCount}
        clockOffset={clockOffset}
      />
      <header>
        <div className="points">{Math.floor(state.points).toLocaleString()} 🐟</div>
        <div className="cps">{state.pointsPerSecond.toFixed(1)} / sec</div>
        <div className="progressbar">
          <div style={{ width: `${state.progress * 100}%` }} />
        </div>
      </header>

      {state.codeword ? (
        <div className="codeword">
          <h2>The cats have spoken!</h2>
          <div className="word">{state.codeword}</div>
          <p>Tell the proctor the code word.</p>
        </div>
      ) : (
        <button
          className="clicker"
          onPointerDown={(e) => {
            e.preventDefault();
            pendingClicks.current++;
          }}
        >
          🐱
        </button>
      )}

      <section className="shop">
        {HEX_BALANCE.upgrades.map((u) => {
          const owned = state.upgrades[u.id] ?? 0;
          const cost = upgradeCost(u, owned);
          return (
            <button
              key={u.id}
              className="upgrade"
              disabled={state.points < cost}
              onClick={() =>
                socketRef.current?.send(
                  JSON.stringify({ type: "buy", upgradeId: u.id }),
                )
              }
            >
              <span className="emoji">{u.emoji}</span>
              <span className="label">
                {u.name} <small>×{owned}</small>
              </span>
              <span className="cost">{cost.toLocaleString()} 🐟</span>
            </button>
          );
        })}
      </section>

      <footer>
        {state.players.map((p) => (
          <span key={p.id} className={p.connected ? "player" : "player offline"}>
            {p.name}
          </span>
        ))}
      </footer>
    </div>
  );
}
