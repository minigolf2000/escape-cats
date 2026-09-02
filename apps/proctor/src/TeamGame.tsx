import { useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import {
  UPGRADES,
  packToLevels,
  hexWon,
  levelLabel,
  type GoombaServerMsg,
  type GoombaSnapshot,
  type HexServerMsg,
  type HexSnapshot,
  type LobbyPlayer,
  type Team,
} from "@escape-cats/shared";
import { closeWhileHidden } from "./closeWhileHidden";
import { PARTYKIT_HOST } from "./net";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The Hex readout: one string per line, ALWAYS the same number of them —
 * absent state is placeholders (see TeamGame). Long values are clipped by CSS. */
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

interface StatLine {
  text: string;
  /** Extra class for this line — the finished-run line goes green. */
  className?: string;
  /** Tooltip, for when the text is clipped. Defaults to the text. */
  title?: string;
}

/** One game's readout: heading, progress bar, a line each. Both games render
 * through this so "the same shape" is structural. */
function GameBlock({
  title,
  progress,
  lines,
  pending,
  children,
}: {
  title: string;
  progress: number;
  lines: StatLine[];
  /** Reserved, with no server to report from yet. */
  pending?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className={pending ? "game pending" : "game"}>
      <h3>{title}</h3>
      <div className="progressbar">
        <div style={{ width: `${progress * 100}%` }} />
      </div>
      {lines.map((line, i) => (
        <p
          className={line.className ? `stat ${line.className}` : "stat"}
          key={i}
          title={line.title ?? line.text}
        >
          {line.text}
        </p>
      ))}
      {children}
    </section>
  );
}

/** The Goomba readout — same fixed-line contract as hexStats. The levels come
 * from the ROOM, never this bundle: `GOOMBA_LEVELS` ships empty and a proctor
 * never applies a pack (four teams would be four writers on one module-global
 * array). `names` is this team's pack decoded — see useGoombaRoom. */
function goombaStats(s: GoombaSnapshot | null, names: string[]): StatLine[] {
  if (!s) return [{ text: "…" }, { text: "…/… levels" }, { text: "…" }];
  const total = s.levelCount;
  // Icon alone; the word is the line's `title`.
  const phase =
    s.phase === "run" ? "🛹"
    : s.phase === "win" ? "🎉"
    : s.phase === "splash" ? "🏁" // done with the game, on the curtain call
    : "✏️";
  const phaseWord =
    s.phase === "run" ? "riding"
    : s.phase === "win" ? "cleared"
    : s.phase === "splash" ? "splash"
    : "placing";
  const done = s.completed.filter(Boolean).length;
  const finishedMs = s.finishedAt ? s.finishedAt - s.startedAt : null;
  // No pack yet, or a pack message not yet on THIS socket, is a real state.
  // A known name is numbered by `levelLabel`, the same one the phones' cards
  // use; neither fallback is.
  const known = names[s.level];
  const name =
    known !== undefined
      ? levelLabel(s.level, known)
      : total === 0 ? "no levels loaded" : `level ${s.level + 1}`;
  return [
    { text: `${phase} ${name}`, title: `${phaseWord} · ${name}` },
    s.finishedAt
      ? {
          text: `✅ all ${total} levels${finishedMs !== null ? ` · ${mmss(finishedMs)}` : ""}`,
          className: "codeword",
        }
      : { text: `${done}/${total} levels done` },
    { text: `${s.bands.length}/4 bands` },
  ];
}

/** One team's live game state, inside its drop target. EVERY line is drawn in
 * every state — a box that grew when a codeword landed would move its
 * neighbours out from under a drag. The two blocks need not match each other;
 * all four teams must render the same two. */
export function TeamGame({
  team,
  assigned,
}: {
  team: Team;
  assigned: LobbyPlayer[];
}) {
  // The room id IS the team id, verbatim — nothing on any surface cases it.
  return (
    <div className="games">
      <HexBlock room={team.id} label={team.name} assigned={assigned} />
      <GoombaBlock room={team.id} label={team.name} />
    </div>
  );
}

/** One room's Hex readout, 🏆 and reset. The trophy is why an ad-hoc room
 * needs this block: Hex cannot score its own win (`wonAt` is a proctor-only
 * intent), so a room with no box here could reach the code word and never be
 * told. */
export function HexBlock({
  room,
  label,
  assigned,
}: {
  room: string;
  label: string;
  /** Who the LOBBY says belongs here, for the "not in game" half of the
   * presence line. An ad-hoc room has no roster and passes none. */
  assigned?: LobbyPlayer[];
}) {
  const { snap, reset, setWon } = useHexRoom(room, label);

  const inRoom = new Set(
    (snap?.players ?? []).filter((p) => p.connected).map((p) => p.id),
  );
  // Assigned but not in the room — the only honest presence for a sorted
  // phone (the lobby's `connected` goes false off the landing page).
  const missing = (assigned ?? [])
    .filter((p) => !inRoom.has(p.pid))
    .map((p) => p.name);
  const finishedMs = snap?.legibleAt ? snap.legibleAt - snap.startedAt : null;
  // The proctor's own mark, not something the game scored — see HexSim.setWon.
  const won = snap !== null && hexWon(snap);

  const lines: StatLine[] = [
    ...hexStats(snap).map((text) => ({ text })),
    {
      text: !snap
        ? "connecting…"
        : `${inRoom.size} playing` +
          (missing.length > 0 ? ` · not in game: ${missing.join(", ")}` : ""),
    },
    snap?.codeword
      ? {
          // The trophy replaces the tick on the same line, same height.
          text: `${won ? "🏆" : "✅"} ${snap.codeword}${finishedMs !== null ? ` · ${mmss(finishedMs)}` : ""}`,
          className: "codeword",
        }
      : { text: won ? "🏆 marked won" : "codeword locked" },
  ];

  return (
    <GameBlock title="🐱 Hex Clicker" progress={snap?.progress ?? 0} lines={lines}>
      <div className="btns">
        {/* The proctor witnesses the win: press, and all four phones get their
            splash. Pressing again takes it back; that direction confirms,
            granting doesn't. */}
        <button className={won ? "won on" : "won"} onClick={() => setWon(!won)}>
          {won ? "🏆 Won ✓" : "🏆 Mark won"}
        </button>
        <button className="danger" onClick={reset}>
          Reset Hex
        </button>
      </div>
    </GameBlock>
  );
}

/** One room's Goomba readout and reset. Split out like HexBlock so an ad-hoc
 * row and a team box cannot drift — including the fixed line count. */
export function GoombaBlock({
  room,
  label,
  showPlayers = false,
}: {
  room: string;
  label: string;
  /** Add a "who is in there" line. A team box gets that from the roster; an
   * ad-hoc room has no roster, so the room is the only place to ask. Fixed
   * per call site, so no caller's line count changes with state. */
  showPlayers?: boolean;
}) {
  const { snap, names, reset } = useGoombaRoom(room, label);
  const playing = (snap?.players ?? []).filter((p) => p.connected).length;
  return (
    <GameBlock
      title="🍄 Goomba Glider"
      progress={snap?.progress ?? 0}
      lines={[
        ...goombaStats(snap, names),
        ...(showPlayers
          ? [{ text: snap ? `${playing} playing` : "connecting…" }]
          : []),
      ]}
    >
      <button className="danger" onClick={reset}>
        Reset Goomba
      </button>
    </GameBlock>
  );
}

/** Watch one Goomba room as a spectator. Two messages: `pack` on connect
 * (before the first snapshot) and on every edit, and a snapshot's `level`
 * only means something against it. NAMES only, per team, so one team's edit
 * cannot relabel another's box. */
function useGoombaRoom(
  room: string,
  teamName: string,
): { snap: GoombaSnapshot | null; names: string[]; reset: () => void } {
  const [snap, setSnap] = useState<GoombaSnapshot | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const socketRef = useRef<PartySocket | null>(null);

  useEffect(() => {
    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      room,
      party: "goomba",
      query: { role: "proctor" },
    });
    socketRef.current = socket;
    socket.addEventListener("message", (e) => {
      const msg: GoombaServerMsg = JSON.parse(e.data as string);
      if (msg.type === "state") setSnap(msg.state);
      // `packToLevels` drops what will not decode, exactly as the room's own
      // `applyPack` does — so these indices are the indices the room plays.
      else if (msg.type === "pack")
        setNames(packToLevels(msg.pack).map((L) => L.name ?? ""));
    });
    const unbindVisibility = closeWhileHidden(socket);
    return () => {
      unbindVisibility();
      socket.close();
    };
  }, [room]);

  return {
    snap,
    names,
    reset: () => {
      if (confirm(`Reset ${teamName}'s Goomba game back to level 1?`)) {
        socketRef.current?.send(JSON.stringify({ type: "reset" }));
      }
    },
  };
}

/** Watch one hex room as a spectator; everything shown is derived from the
 * snapshot at render. */
function useHexRoom(
  room: string,
  teamName: string,
): {
  snap: HexSnapshot | null;
  reset: () => void;
  setWon: (won: boolean) => void;
} {
  const [snap, setSnap] = useState<HexSnapshot | null>(null);
  const socketRef = useRef<PartySocket | null>(null);

  useEffect(() => {
    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      room,
      query: { role: "proctor" },
    });
    socketRef.current = socket;
    socket.addEventListener("message", (e) => {
      const msg: HexServerMsg = JSON.parse(e.data as string);
      if (msg.type === "state") setSnap(msg.state);
    });
    const unbindVisibility = closeWhileHidden(socket);
    return () => {
      unbindVisibility();
      socket.close();
    };
  }, [room]);

  return {
    snap,
    reset: () => {
      if (confirm(`Reset ${teamName}'s Hex game back to the start?`)) {
        socketRef.current?.send(JSON.stringify({ type: "reset" }));
      }
    },
    setWon: (won: boolean) => {
      // Granting is one tap (the team is standing there). TAKING it back
      // asks: it pulls a splash off four phones.
      if (!won && !confirm(`Take back ${teamName}'s Hex win?`)) return;
      socketRef.current?.send(JSON.stringify({ type: "won", won }));
    },
  };
}
