import { useState } from "react";
import {
  ADHOC_SLUG_MAX,
  adhocRoomId,
  adhocSlug,
  type AdhocRoom,
} from "@escape-cats/shared";
import { GoombaBlock, HexBlock } from "./TeamGame";

/**
 * Where the links point. Same origin as this page, because that is the whole
 * one-origin deal — the pid that identifies a phone is per-origin, the vanity
 * domains REDIRECT here rather than rewriting, and a link built off any other
 * host would hand out a different player to the same person.
 *
 * `npm run dev` is the exception, serving each app on its own port; the env
 * vars are set in .env.development so the copy buttons produce something you
 * can paste there too.
 */
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

/** The link for a slug, in one game. One function, so the URL the proctor
 * copies and the URL the game parses cannot disagree about what a slug is —
 * `adhocRoomId` has already lowercased and stripped it by the time it gets
 * here. The two games take the SAME slug: it names a room, not a game. */
function linkFor(room: string, game: GameKey): string {
  const url = new URL(GAMES.find((g) => g.key === game)!.base);
  url.searchParams.set("r", adhocSlug(room));
  return url.href;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Rough, and deliberately so: this answers "is anyone still using this link",
 * not "when exactly". */
function ago(ms: number): string {
  const d = Date.now() - ms;
  if (d < 2 * MINUTE) return "just now";
  if (d < HOUR) return `${Math.round(d / MINUTE)}m ago`;
  if (d < DAY) return `${Math.round(d / HOUR)}h ago`;
  return `${Math.round(d / DAY)}d ago`;
}

/**
 * The ad-hoc rooms — every `?r=` link somebody has actually opened.
 *
 * A readout at the bottom of the page rather than a box on the board, because
 * these are not drop targets: nobody can be sorted INTO one (`assign` validates
 * against TEAM_IDS), the list has no fixed length, and the board's five boxes
 * are five things whose height must hold still under a drag. It is the same
 * reasoning that kept the testing room out of the grid — except that room is a
 * constant with a home in the Unassigned box, and these are not.
 *
 * COLLAPSED BY DEFAULT, and that is load-bearing rather than tidy: each row
 * holds an open spectator socket to its room, so a proctor who never opens this
 * section opens no sockets at all. Rows only mount while it is open.
 */
export function AdhocRooms({
  rooms,
  onForget,
}: {
  rooms: AdhocRoom[];
  onForget: (room: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");

  // What the typed slug will actually become — normalised by the same function
  // the game uses on the URL, so what is copied is what will be joined.
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

          {/* Minting a link is the reason to be on this page at all: the list
              below only ever shows rooms that already exist, so without this
              there is nowhere to make the first one. */}
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

/**
 * One room: what it is called, when it was last joined, both games' readouts,
 * and the two things a proctor can do to the row itself.
 *
 * BOTH games, in the same two slots a team's box uses, because `?r=kelly` names
 * a room rather than a game — the same slug plays Hex at `/hexxygon/?r=kelly`
 * and Goomba at `/g00mBa/?r=kelly`, in two separate rooms that happen to share
 * a name (as a team's two games always have). Hex's block is the load-bearing
 * one: its win is a proctor's press, so without a 🏆 here a room could reach
 * the code word and never be told it won.
 *
 * The two "playing" counts are genuinely two numbers, not one repeated: a
 * friend in the glider holds a socket to the goomba room and none to the hex
 * one. No chat, though — a channel needs a box on the board to be read from.
 */
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
        {/* Drops the ROW, not the room — the levels it has cleared are safe,
            and the next phone through the link puts it straight back. So no
            confirm: this is a tidy-up, exactly like forgetting a player. */}
        <button className="small" onClick={() => onForget(room.id)}>
          Forget
        </button>
      </div>
    </li>
  );
}

/** Copy one game's link for a room, and say so. Disabled with nothing to copy,
 * so the button is never a no-op that looks like a failure. */
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
          // Clipboard access can be refused (an insecure origin, a permission
          // the browser never granted). The URL is on screen either way —
          // saying nothing happened beats a tick that lies.
          () => undefined,
        );
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}
