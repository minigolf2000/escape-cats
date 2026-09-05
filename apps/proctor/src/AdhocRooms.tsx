import { useState } from "react";
import {
  ADHOC_SLUG_MAX,
  adhocRoomId,
  adhocSlug,
  type AdhocRoom,
} from "@escape-cats/shared";
import { GoombaBlock, HexBlock } from "./TeamGame";

/** Same origin as this page: the pid is per-origin, so a link off any other
 * host hands the same person a different player. `npm run dev` serves each
 * app on its own port; the env vars in .env.development cover that. */
const GAMES = [
  {
    key: "goomba",
    label: "🍄 link",
    base: import.meta.env.VITE_GOOMBA_URL ?? new URL("/g00mBa/", location.origin).href,
  },
  {
    key: "hex",
    label: "🐱 link",
    base: import.meta.env.VITE_HEX_URL ?? new URL("/hexxygon/", location.origin).href,
  },
] as const;

type GameKey = (typeof GAMES)[number]["key"];

/** One function for the link, so the URL copied and the URL parsed agree —
 * `adhocRoomId` has already normalised the slug. Both games take the SAME slug. */
function linkFor(room: string, game: GameKey): string {
  const url = new URL(GAMES.find((g) => g.key === game)!.base);
  url.searchParams.set("r", adhocSlug(room));
  return url.href;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Rough on purpose: answers "is anyone still using this link". */
function ago(ms: number): string {
  const d = Date.now() - ms;
  if (d < 2 * MINUTE) return "just now";
  if (d < HOUR) return `${Math.round(d / MINUTE)}m ago`;
  if (d < DAY) return `${Math.round(d / HOUR)}h ago`;
  return `${Math.round(d / DAY)}d ago`;
}

/** Every `?r=` link somebody has opened. Below the board, not a box in it:
 * not a drop target, no fixed count, and a box's height must hold still
 * under a drag. COLLAPSED BY DEFAULT, and that is load-bearing: each row
 * holds a spectator socket to its room, and rows only mount while open. */
export function AdhocRooms({
  rooms,
  onForget,
}: {
  rooms: AdhocRoom[];
  onForget: (room: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");

  // Normalised by the same function the game uses on the URL.
  const minted = adhocRoomId(slug);

  return (
    <div className="adhoc">
      <button className="adhoc-head" onClick={() => setOpen(!open)}>
        <span>{open ? "▾" : "▸"} Ad-hoc rooms</span>
        <span className="muted">{rooms.length}</span>
      </button>

      {open && (
        <>
          <p className="muted adhoc-note">
            Rooms opened by a <code>?r=</code> link — both games, same slug.
            They are not teams: nobody can be dropped into one, and sorting a
            phone onto a team takes it out of here. Anyone with a link can join.
          </p>

          {/* The list only shows rooms that exist; the first one is made here. */}
          <div className="adhoc-mint">
            <input
              value={slug}
              maxLength={ADHOC_SLUG_MAX * 2}
              placeholder="new room name, e.g. kittens"
              onChange={(e) => setSlug(e.target.value)}
            />
            {GAMES.map((g) => (
              <CopyLink key={g.key} room={minted} game={g.key} label={g.label} />
            ))}
          </div>
          {minted && (
            <p className="adhoc-url">
              {GAMES.map((g) => (
                <span key={g.key}>{linkFor(minted, g.key)}</span>
              ))}
            </p>
          )}

          {rooms.length === 0 ? (
            <p className="muted">
              Nobody has opened one yet. A room appears here the first time a
              phone joins it, not when the link is made.
            </p>
          ) : (
            <ul className="adhoc-list">
              {rooms.map((r) => (
                <AdhocRow key={r.id} room={r} onForget={onForget} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** One room: name, last join, both games' readouts in a team box's two
 * slots (same slug, two rooms). Hex's block is load-bearing: its win is a
 * proctor's press. The two "playing" counts are genuinely two numbers. No
 * chat — a channel needs a box on the board. */
function AdhocRow({
  room,
  onForget,
}: {
  room: AdhocRoom;
  onForget: (room: string) => void;
}) {
  return (
    <li className="adhoc-room">
      <div className="zone-head">
        <strong>{adhocSlug(room.id)}</strong>
        <span className="muted" title={new Date(room.seenAt).toLocaleString()}>
          joined {ago(room.seenAt)}
        </span>
      </div>
      <div className="games">
        <HexBlock room={room.id} label={adhocSlug(room.id)} />
        <GoombaBlock room={room.id} label={adhocSlug(room.id)} showPlayers />
      </div>
      <div className="adhoc-btns">
        {GAMES.map((g) => (
          <CopyLink key={g.key} room={room.id} game={g.key} label={g.label} />
        ))}
        {/* Wipes BOTH games, then drops the row (`forgetRoom` in
            server/src/lobby.ts). Unlike forgetting a PLAYER this destroys
            something no phone can put back, so it is the one button here that
            asks — native confirm, like the chat log's delete. */}
        <button
          className="danger small"
          onClick={() => {
            if (
              !confirm(
                `Reset and forget "${adhocSlug(room.id)}"? Both games lose every level cleared.`,
              )
            )
              return;
            onForget(room.id);
          }}
        >
          Reset &amp; forget
        </button>
      </div>
    </li>
  );
}

/** Copy one game's link. Disabled with nothing to copy. */
function CopyLink({
  room,
  game,
  label,
}: {
  room: string | null;
  game: GameKey;
  label: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="small"
      disabled={!room}
      title={room ? linkFor(room, game) : undefined}
      onClick={() => {
        if (!room) return;
        void navigator.clipboard.writeText(linkFor(room, game)).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          // Clipboard can be refused (insecure origin); the URL is on screen.
          () => undefined,
        );
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}
