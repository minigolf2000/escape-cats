import QRCode from "react-qr-code";
import { Lobby } from "./Lobby";

/**
 * Where players start, and the only door in. Production serves every surface
 * from one origin with the lobby at its root, so same-origin is both the right
 * answer and one fewer Vercel var to forget; dev runs the two apps on separate
 * ports, which is what the override is for.
 */
const LOBBY_URL =
  import.meta.env.VITE_LOBBY_URL ?? new URL("/", location.href).href;

/** One flat page: how players get in, then one box per team that is both the
 * drop target for sorting and that team's live game status. */
export function App() {
  return (
    <div className="setup">
      <h1>🐾 Escape Cats — Proctor</h1>
      <section className="join">
        <div className="qr">
          <QRCode value={LOBBY_URL} size={120} />
        </div>
        <div className="join-copy">
          <strong>Players start here</strong>
          <a
            href={LOBBY_URL}
            target="_blank"
            rel="noreferrer"
            className="join-url"
          >
            {LOBBY_URL}
          </a>
          <p className="muted">
            One code for the whole room, and the only way into a game: a phone
            types its name, lands in Unassigned below, and joins a team when you
            drag it onto one.
          </p>
        </div>
      </section>
      <Lobby />
    </div>
  );
}
