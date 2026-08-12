import { useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import {
  UPGRADES,
  type HexServerMsg,
  type HexSnapshot,
  type LobbyPlayer,
  type Team,
} from "@escape-cats/shared";
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

/**
 * Goomba Rider, reserved. Its state has no server: the game keeps each player's
 * progress in that phone's localStorage, so there is nothing to report yet.
 * Wiring it up means a Durable Object roomed by team id feeding this block —
 * which is why TeamGame is keyed by TEAM rather than by game.
 *
 * Static, so it is built once rather than per render.
 */
const GOOMBA_PENDING = (
  <GameBlock
    title="🍄 Goomba Rider"
    progress={0}
    pending
    lines={[
      {
        text: "no server yet",
        title:
          "Goomba Rider has no room server: each phone keeps its own progress in localStorage, so there is nothing to report here yet.",
      },
      { text: "—" },
      { text: "—" },
    ]}
  />
);

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
  const { snap, reset } = useHexRoom(team.id, team.name);

  const inRoom = new Set(
    (snap?.players ?? []).filter((p) => p.connected).map((p) => p.id),
  );
  // Assigned but not in the game room — the useful direction, and the only
  // honest presence signal for a sorted phone (the lobby's own `connected` goes
  // false as soon as a phone leaves the landing page). Who IS playing is
  // already on screen: the roster above this block, minus these names.
  const missing = assigned.filter((p) => !inRoom.has(p.pid)).map((p) => p.name);
  const finishedMs = snap?.legibleAt ? snap.legibleAt - snap.startedAt : null;

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
          text: `✅ ${snap.codeword}${finishedMs !== null ? ` · ${mmss(finishedMs)}` : ""}`,
          className: "codeword",
        }
      : { text: "codeword locked" },
  ];

  return (
    <div className="games">
      <GameBlock
        title="🐱 Hex Clicker"
        progress={snap?.progress ?? 0}
        lines={lines}
      >
        <button className="danger" onClick={reset}>
          Reset Hex
        </button>
      </GameBlock>
      {GOOMBA_PENDING}
    </div>
  );
}

/** Watch one team's game room as a spectator. The snapshot is kept as it
 * arrives; everything shown is derived from it at render, so there is no second
 * copy of the room's state to keep in step. */
function useHexRoom(
  room: string,
  teamName: string,
): { snap: HexSnapshot | null; reset: () => void } {
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
    return () => socket.close();
  }, [room]);

  return {
    snap,
    reset: () => {
      if (confirm(`Reset ${teamName}'s Hex game back to the start?`)) {
        socketRef.current?.send(JSON.stringify({ type: "reset" }));
      }
    },
  };
}
