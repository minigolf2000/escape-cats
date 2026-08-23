import { useState } from "react";
import {
  ADHOC_SLUG_MAX,
  adhocRoomId,
  adhocSlug,
  type AdhocRoom,
} from "@escape-cats/shared";
import { GoombaBlock } from "./TeamGame";

/**
 * Where the links point. Same origin as this page, because that is the whole
 * one-origin deal — the pid that identifies a phone is per-origin, the vanity
 * domains REDIRECT here rather than rewriting, and a link built off any other
 * host would hand out a different player to the same person.
 *
 * `npm run dev` is the exception, serving each app on its own port; set
 * VITE_GOOMBA_URL there if you want the copy button to produce something you
 * can paste.
 */
const GOOMBA_URL =
  import.meta.env.VITE_GOOMBA_URL ?? new URL("/g00mBa/", location.origin).href;

/** The link for a slug. One function, so the URL the proctor copies and the URL
 * the game parses cannot disagree about what a slug is — `adhocRoomId` has
 * already lowercased and stripped it by the time it gets here. */
function linkFor(room: string): string {
  const url = new URL(GOOMBA_URL);
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
            Rooms opened by a <code>?r=</code> link. They are not teams — nobody
            can be dropped into one, and sorting a phone onto a team takes it
            out of here. Anyone with a link can join it.
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
            <CopyLink room={minted} label="Copy link" />
          </div>
          {minted && <p className="adhoc-url">{linkFor(minted)}</p>}

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

/** One room: what it is called, when it was last joined, its Goomba readout,
 * and the two things a proctor can do to it. No Hex block and no chat — an
 * ad-hoc room is a Goomba room and nothing else (see ADHOC_PREFIX in shared). */
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
      <GoombaBlock room={room.id} label={adhocSlug(room.id)} showPlayers />
      <div className="adhoc-btns">
        <CopyLink room={room.id} label="Copy link" />
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

/** Copy a room's link, and say so. Disabled with nothing to copy, so the button
 * is never a no-op that looks like a failure. */
function CopyLink({ room, label }: { room: string | null; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="small"
      disabled={!room}
      onClick={() => {
        if (!room) return;
        void navigator.clipboard.writeText(linkFor(room)).then(
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
