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

/** The Hex readout, one string per line and always the same number of them.
 * Absent state becomes placeholders rather than fewer lines — see the note on
 * TeamGame. Long values are clipped by CSS, never wrapped, for the same
 * reason. */
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

/**
 * One game's readout: a heading, a progress bar, then a line each. Both games
 * in a team's box render through this, so "the same shape" is structural rather
 * than a promise two JSX trees are trusted to keep.
 */
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

/** The Goomba readout — same fixed-line contract as hexStats: every line drawn
 * in every state, absent values as placeholders, so the box never changes
 * height.
 *
 * The levels come from the ROOM, never from this bundle: `GOOMBA_LEVELS` ships
 * empty on every surface now, and a proctor never applies a pack (four teams
 * share one module-global array, so it would be four writers on one variable
 * React is not watching anyway). So the count is the one the server stamped on
 * the snapshot, and `names` is this team's pack decoded — see useGoombaRoom. */
function goombaStats(s: GoombaSnapshot | null, names: string[]): StatLine[] {
  if (!s) return [{ text: "…" }, { text: "…/… levels" }, { text: "…" }];
  const total = s.levelCount;
  // The icon alone: four states, four glyphs, and the word beside them was
  // only ever restating the picture. Kept as the line's `title` so a hover
  // still says which is which.
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
  // An event with no pack loaded yet is a real state, not an error; so is a
  // pack message that has not landed on THIS socket yet.
  // A real name is numbered by its place in the pack (`levelLabel`, the same
  // one the phones' cards use). Neither fallback is: "no levels loaded" is not
  // a level, and the other one already IS the number.
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

/**
 * One team's live game state, rendered inside that team's drop target so
 * sorting and watching are the same box.
 *
 * EVERY line is drawn in every state — connecting, empty, mid-run, finished —
 * because a team's box must not change height as its state changes. It sits in
 * a grid with four others, so a box that grew by a line when a codeword landed
 * would move the boxes beside it out from under the proctor's finger, mid-drag.
 * The two blocks need not have the same line count as each other; what matters
 * is that all four teams render the same two blocks.
 */
export function TeamGame({
  team,
  assigned,
}: {
  team: Team;
  assigned: LobbyPlayer[];
}) {
  // The room id IS the team id, verbatim — nothing on any surface cases it.
  const { snap, reset, setWon } = useHexRoom(team.id, team.name);

  const inRoom = new Set(
    (snap?.players ?? []).filter((p) => p.connected).map((p) => p.id),
  );
  // Assigned but not in the game room — the useful direction, and the only
  // honest presence signal for a sorted phone (the lobby's own `connected` goes
  // false as soon as a phone leaves the landing page). Who IS playing is
  // already on screen: the roster above this block, minus these names.
  const missing = assigned.filter((p) => !inRoom.has(p.pid)).map((p) => p.name);
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
          // The trophy replaces the tick once the word has actually been read
          // out to me: same line, same height, and it is the line I am looking
          // at when I press the button, so the two cannot disagree on screen.
          text: `${won ? "🏆" : "✅"} ${snap.codeword}${finishedMs !== null ? ` · ${mmss(finishedMs)}` : ""}`,
          className: "codeword",
        }
      : { text: won ? "🏆 marked won" : "codeword locked" },
  ];

  return (
    <div className="games">
      <GameBlock
        title="🐱 Hex Clicker"
        progress={snap?.progress ?? 0}
        lines={lines}
      >
        <div className="btns">
          {/* The win, as the proctor witnesses it: they hear the code word, they
              press this, and all four of that team's phones get their splash.
              Pressing it again takes it back (a mis-pressed team box must not
              need a whole-game reset to fix) — that direction confirms, the
              granting direction doesn't. */}
          <button className={won ? "won on" : "won"} onClick={() => setWon(!won)}>
            {won ? "🏆 Won ✓" : "🏆 Mark won"}
          </button>
          <button className="danger" onClick={reset}>
            Reset Hex
          </button>
        </div>
      </GameBlock>
      <GoombaBlock room={team.id} label={team.name} />
    </div>
  );
}

/**
 * One room's Goomba readout and its reset, as a block.
 *
 * Split out of TeamGame because it is the WHOLE of what an ad-hoc room's row
 * shows (see AdhocRooms.tsx): those rooms have no Hex game to pair it with and
 * no roster to head it, but the readout is exactly a team's. One component
 * means the two cannot drift into telling the same story two ways — including
 * the fixed line count, which an ad-hoc row needs for the same reason a team
 * box does (a list of rows that reflow as rooms report in is unreadable).
 */
export function GoombaBlock({
  room,
  label,
  showPlayers = false,
}: {
  room: string;
  label: string;
  /** Add a "who is in there" line. A team box gets this from the ROSTER above
   * it (and from Hex's own line); an ad-hoc room has no roster anywhere — the
   * lobby never learns who walked through the link — so the room itself is the
   * only place to ask. Fixed per call site, so neither caller's line count
   * changes as its state does, which is the rule that matters. */
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

/** Watch one team's Goomba room as a spectator — the hex hook's shape, aimed
 * at the `goomba` party.
 *
 * Two messages, not one: the room sends its level `pack` on connect (before the
 * first snapshot) and again whenever someone edits it, and a snapshot's `level`
 * only means something against that pack. We keep the NAMES rather than the
 * levels — the proctor draws no geometry — and keep them per team, so one
 * team's mid-event edit cannot relabel another team's box. */
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

/** Watch one team's game room as a spectator. The snapshot is kept as it
 * arrives; everything shown is derived from it at render, so there is no second
 * copy of the room's state to keep in step. */
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
      // Granting a win is one tap: it happens with the team standing in front
      // of me having just read the word out. TAKING it back is the one that
      // asks, because it pulls a splash off four phones mid-event.
      if (!won && !confirm(`Take back ${teamName}'s Hex win?`)) return;
      socketRef.current?.send(JSON.stringify({ type: "won", won }));
    },
  };
}
