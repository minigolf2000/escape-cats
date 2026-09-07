import type { LevelPack } from "./goomba/pack";

// The team lobby — the one piece of state that outlives a game room. A team
// id doubles as the room id both games run in.

export interface Team {
  /** Also the game's room id. */
  id: string;
  name: string;
}

export const TEAMS: Team[] = [
  { id: "t1", name: "Team 1" },
  { id: "t2", name: "Team 2" },
  { id: "t3", name: "Team 3" },
  { id: "t4", name: "Team 4" },
];

export const TEAM_IDS: string[] = TEAMS.map((t) => t.id);

/** Where an unsorted phone plays: one shared room, for the device-testing
 * window with no proctor present. Deliberately NOT in `TEAMS` — the board
 * draws drop targets from that list and `assign` validates against it, so
 * nobody can be sorted INTO it. The proctor watches it from its own box
 * (`apps/proctor/src/TestRoom.tsx`). */
export const OPEN_TEAM: Team = { id: "t0", name: "Testing Room" };

/** `false` restores the waiting room on every surface (all three ask
 * `roomFor`). Flip it when the testing window closes. */
export const OPEN_ROOM_OPEN = true;

/**
 * Ad-hoc rooms: `/g00mBa/?r=kittens` plays in room `r-kittens`, a durable
 * room of its own. The one relaxation of "no `?room=` params": an `?r=` link
 * changes which room, never which origin, and the lobby stays the only way
 * into a TEAM — the prefix is one a team id can never have, `assign`
 * validates against `TEAM_IDS`, and `roomFor` answers the team FIRST so a URL
 * can never override the proctor.
 *
 * BOTH GAMES take the same slug: it names a ROOM, not a game. Hex's win is a
 * proctor's press, so HexServer announces an ad-hoc room to the registry on
 * connect or its players could never be told they won. Chat ignores `?r=`.
 * A slug is not a secret — anyone the link reaches can join.
 */
export const ADHOC_PREFIX = "r-";

/** Longest slug kept — the proctor's list stays one line per room. */
export const ADHOC_SLUG_MAX = 24;

/** The room id for a slug, or null. Normalised HERE so `?r=Kittens` and
 * `?r=kittens` are one room on every surface, the proctor's links included.
 * Narrow character class: the id goes in a WebSocket URL. */
export function adhocRoomId(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const clean = String(slug)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, ADHOC_SLUG_MAX);
  return clean ? ADHOC_PREFIX + clean : null;
}

/** The prefix is the whole test — team ids and t0 are `t`-something. */
export function isAdhocRoom(room: string | null | undefined): boolean {
  return typeof room === "string" && room.startsWith(ADHOC_PREFIX);
}

/** The gate on showing player NAMES: a team's four are a sorted, known group,
 * where t0 is every unsorted phone in the building and an ad-hoc room is
 * whoever a link reached. NOT `!isAdhocRoom` — that answers true for t0, and
 * for any room id a later change invents. The four are a closed list; ask it. */
export function isTeamRoom(room: string | null | undefined): boolean {
  return typeof room === "string" && TEAM_IDS.includes(room);
}

/** The slug back out of a room id — what the link says. */
export function adhocSlug(room: string): string {
  return room.startsWith(ADHOC_PREFIX) ? room.slice(ADHOC_PREFIX.length) : room;
}

/** The room a phone should join; `null` = wait for the proctor. THE ORDER IS
 * THE RULE: team beats the URL, always, so the proctor can reclaim any phone
 * whatever link it arrived on. `adhoc` is the caller's already-validated id. */
export function roomFor(
  team: string | null,
  adhoc?: string | null,
): string | null {
  if (team) return team;
  if (adhoc) return adhoc;
  return OPEN_ROOM_OPEN ? OPEN_TEAM.id : null;
}

/** The chat channel this phone may open, or `null` = wait for the proctor.
 * NOT `roomFor`: chat has four rooms and no fallback, because the channel is
 * the thing being gated. Asks the roster, never the URL; `server/src/index.ts`
 * says the same on the wire. */
export function chatRoomFor(team: string | null | undefined): string | null {
  return isTeamRoom(team) ? (team as string) : null;
}

/** Longest display name, in characters AS READ — an emoji is one, a flag is
 * one. Twelve is Jackbox's number, and it is right here for the same reason:
 * four of these have to fit the chat's `n here: A, B, C, D` and the column of
 * names both games draw over the play area. The chip's `max-width: 12ch` is
 * this number. */
export const NAME_MAX = 12;

/** What a phone with no name of its own announces. Never overwrites a real
 * name — see `Roster.register`. */
export const DEFAULT_NAME = "Cat";

/** What a name may be made of, as a WHITELIST: a blocklist of what breaks a
 * layout is a list nobody finishes — ban the zero-width space and U+2800
 * BRAILLE BLANK still draws nothing. Latin rather than ASCII because José is
 * an ordinary US name; emoji because this is a party game. The cases, and what
 * each one would have broken, are in `tools/names.mjs`. */
const NOT_A_NAME =
  /[^\p{Script=Latin}0-9 '._\-\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F]/gu;

/** Something you can SEE: `...` and `   ` pass the whitelist and are not names. */
const HAS_A_FACE = /[\p{L}0-9\p{Extended_Pictographic}]/u;

const WHITESPACE = /\s+/g;
const GAPS = / +/g;
const LEADING = /^ +/;

/** How much raw input is worth cleaning. Every pass below is proportional to
 * what arrives, and `?name=` is a query string sized by whoever typed it. */
const RAW_MAX = NAME_MAX * 8;

/** Cut to `n` characters as READ. `String.slice` cuts UTF-16 units and would
 * ship half a 🐈; `Intl.Segmenter` counts what a person counts. The code-point
 * fallback cannot throw on a runtime without it, and is only stricter — a flag
 * costs two. */
const segmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function cut(s: string, n: number): string {
  // A grapheme count never exceeds the UTF-16 length, so anything this short
  // already fits and never pays for the Segmenter.
  if (s.length <= n) return s;
  const chars = segmenter
    ? [...segmenter.segment(s)].map((g) => g.segment)
    : [...s];
  return chars.length <= n ? s : chars.slice(0, n).join("");
}

/** A name as it is being TYPED — `cleanName` without the final trim, so a
 * trailing space can still become the start of a surname. Clients write this
 * back into the input on every keystroke. */
export function nameDraft(name: unknown): string {
  return cut(
    String(name ?? "")
      .slice(0, RAW_MAX)
      .normalize("NFC")
      // Whitespace first, or stripping a tab welds two words together.
      .replace(WHITESPACE, " ")
      .replace(NOT_A_NAME, "")
      .replace(GAPS, " ")
      .replace(LEADING, ""),
    NAME_MAX,
  );
}

/** A name as it goes ON THE WIRE; `""` means "not a name" and callers refuse
 * it. Enforced server-side, in `Roster` — `?name=` is a socket URL, typed by
 * whoever wants to type it. */
export function cleanName(name: unknown): string {
  const out = nameDraft(name).trim();
  return HAS_A_FACE.test(out) ? out : "";
}

/** What a phone waiting to be sorted is told, on the lobby and in the chat.
 * One string so the two surfaces cannot tell it two different things. */
export const WAITING_LINE = "Waiting to be sorted\u2026";

/** Players per team. The design assumes four (slot colours, wall art); the
 * board draws four seats and refuses a fifth drop. Nothing below the proctor
 * UI enforces it. */
export const TEAM_SIZE = 4;

export interface LobbyPlayer {
  pid: string;
  name: string;
  /** null = waiting for the proctor to sort them. */
  team: string | null;
  /** Holding a socket to the LOBBY right now — narrower than "is with us": a
   * sorted phone drops it for the game, so this reads false while playing.
   * Trustworthy for an unsorted phone only; for a sorted one, ask the room. */
  connected: boolean;
}

export interface LobbySnapshot {
  players: LobbyPlayer[];
  teams: Team[];
  /** The game's levels: one global pack for the event, as level links
   * (`goomba/pack.ts`). Rides the lobby because every phone already holds a
   * socket to it. The room server reads it over an internal fetch — it scores
   * runs and cannot take a phone's word for the geometry. */
  pack: LevelPack;
  /** Bumped on every pack write. A room compares this to what it last applied
   * rather than diffing the levels, so an unchanged pack costs nothing. */
  packV: number;
  /** Ad-hoc rooms that have been JOINED (a link nobody opened never existed),
   * newest first. PROCTOR CONNECTIONS ONLY — every other phone gets an empty
   * list, or every friend room is one tap from every guest. A registry, not a
   * query: the goomba room announces itself on its pack fetch. */
  adhoc: AdhocRoom[];
}

/** One ad-hoc room the lobby has heard from. */
export interface AdhocRoom {
  /** Room id, `r-<slug>`. */
  id: string;
  /** When a phone last connected (epoch ms) — the lobby's only liveness for
   * a game room. */
  seenAt: number;
}

/** Change my display name. The LOBBY owns the roster, but a sorted phone is
 * holding a chat room's socket instead, so `ChatClientMsg` takes the same
 * intent and forwards it. One type, so the two doors cannot drift. */
export type RenameMsg = { type: "rename"; name: string };

export type LobbyClientMsg =
  | RenameMsg
  | { type: "assign"; pid: string; team: string | null } // proctor only
  /** Send one team's players back to Unassigned. Per TEAM, never board-wide:
   * one mis-click must not unsort a room mid-event. */
  | { type: "clearTeam"; team: string } // proctor only
  | { type: "forget"; pid: string } // proctor only — drop one player
  /** Drop one ad-hoc room from the proctor's list. The ROOM is untouched and
   * reappears when the link is opened again. */
  | { type: "forgetRoom"; room: string } // proctor only
  // ---- the level pack. Open to any phone, on purpose: the selector IS the
  // editor, and the room server re-scores against the authority, so nothing
  // here can corrupt a run.
  /** Paste a level in. `index` null appends a new slot; otherwise it REPLACES
   * that slot, which is how you fix a level in Figma and paste over it. */
  | { type: "packSet"; index: number | null; hash: string }
  /** Drag a card to a new position. */
  | { type: "packMove"; from: number; to: number }
  | { type: "packDelete"; index: number }
  /** Replace the whole pack — how an operator seeds an empty event. */
  | { type: "packAll"; pack: LevelPack };

export type LobbyServerMsg = { type: "lobby"; snapshot: LobbySnapshot };
