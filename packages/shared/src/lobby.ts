import type { LevelPack } from "./goomba/pack";

// The team lobby — the one piece of state that outlives a single game room.
//
// A team id doubles as the PartyKit room id the game runs in, so once the
// proctor puts a player on "t2", that player's game room is "t2". Nothing
// else needs to agree on anything.

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

/**
 * Where a phone the proctor hasn't sorted plays: one shared room holding
 * everybody unsorted.
 *
 * This exists for the device-testing window — new phones, new browsers, new
 * screen sizes, no proctor in the room. Without it every test device waits on
 * a drag that nobody is there to make, which is the right behaviour on an
 * event night and the wrong one for two weeks of "does it work on this
 * handset".
 *
 * It is deliberately NOT in `TEAMS`: the proctor's board draws its drop
 * targets from that list, and the lobby validates assignments against it, so
 * keeping it out means nobody can be sorted INTO the testing room by accident
 * and it never becomes a fifth seat on the board. The proctor watches it from
 * its own box instead (`apps/proctor/src/TestRoom.tsx`).
 */
export const OPEN_TEAM: Team = { id: "t0", name: "Testing Room" };

/**
 * The one switch for the above. `false` restores the waiting room: an unsorted
 * phone sits on "waiting for the proctor" exactly as it did before, on every
 * surface, because all three ask `roomFor`. Flip it back when the testing
 * window closes.
 */
export const OPEN_ROOM_OPEN = true;

/**
 * **Ad-hoc rooms** — the third way into a game, after the proctor's drag and
 * the shared testing room. A link like `/g00mBa/?r=kittens` plays in room
 * `r-kittens`: a durable room of its own, so a handful of friends who share
 * the link play together and a lone one plays alone, and either way a refresh
 * comes back to the same level with the same progress.
 *
 * This is the one relaxation of the README's "no `?room=` params, ever". That
 * rule is really two claims, and both still hold:
 *
 *   - **One origin.** The pid is per-origin, so the vanity domains REDIRECT
 *     here rather than rewriting. An `?r=` link is a path on the same origin;
 *     it changes which room, never which origin.
 *   - **The lobby is the only way into a TEAM.** Enforced three ways: an
 *     ad-hoc id carries a prefix a team id can never have, `assign` still
 *     validates against `TEAM_IDS` so nobody can be sorted into one, and
 *     `roomFor` answers the team FIRST — a URL can never override the
 *     proctor. That last one is what stops a friend who bookmarked a
 *     playtest link from turning up on event night stuck outside their team.
 *
 * BOTH GAMES take the same slug, because it names a ROOM and not a game:
 * `/g00mBa/?r=kelly` and `/hexxygon/?r=kelly` are two rooms sharing a name,
 * exactly as a team's two games are. Hex needs one thing Goomba does not — its
 * win is a proctor's press (`hexWon`), so an ad-hoc room has to reach the
 * proctor's board or its players could earn the code word and never be told
 * they won. That is what the registry is for, and why HexServer announces
 * itself on connect even though it has no other reason to call the lobby.
 *
 * Chat is the one surface still out: a channel is read from a box on the
 * board, and these rooms are a list below it. It keeps asking `roomFor` with
 * no ad-hoc argument, so it ignores `?r=`.
 *
 * A slug is not a secret — anyone the link reaches can join. That is the
 * point of handing it to two friends, and the thing to know before handing it
 * to one.
 */
export const ADHOC_PREFIX = "r-";

/** Longest slug we keep. Long enough for "kittens-practice", short enough that
 * the proctor's list stays one line per room. */
export const ADHOC_SLUG_MAX = 24;

/**
 * The room id for a slug off a URL, or null if nothing usable is left.
 *
 * Normalising HERE, in shared, is what makes `?r=Kittens` and `?r=kittens` the
 * same room on every surface — including the proctor, which builds the links it
 * hands out through this same function. The character class is deliberately
 * narrow: a room id ends up in a WebSocket URL and on a screen, and a slug that
 * survives a round trip through neither is worse than no slug.
 */
export function adhocRoomId(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const clean = String(slug)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, ADHOC_SLUG_MAX);
  return clean ? ADHOC_PREFIX + clean : null;
}

/** Whether a room id is an ad-hoc one. The prefix is the whole test — team ids
 * and the testing room are `t`-something and can never collide. */
export function isAdhocRoom(room: string | null | undefined): boolean {
  return typeof room === "string" && room.startsWith(ADHOC_PREFIX);
}

/** The slug back out of an ad-hoc room id — what the link says and what the
 * proctor shows. */
export function adhocSlug(room: string): string {
  return room.startsWith(ADHOC_PREFIX) ? room.slice(ADHOC_PREFIX.length) : room;
}

/**
 * The room id a phone should join, given what the lobby says about it.
 * `null` means "no room — wait for the proctor", which is what every surface
 * renders its waiting screen on.
 *
 * A team id doubles as a room id, so a sorted phone's answer is just its team.
 * The interesting cases are the other two, and they are answered HERE rather
 * than three times over in the clients.
 *
 * The ORDER is the rule that makes ad-hoc rooms safe (see ADHOC_PREFIX): a
 * team assignment beats the URL, always, so the proctor can reclaim any phone
 * no matter what link it arrived on. `adhoc` is the caller's already-validated
 * room id — surfaces that do not offer ad-hoc rooms simply don't pass one.
 */
export function roomFor(
  team: string | null,
  adhoc?: string | null,
): string | null {
  if (team) return team;
  if (adhoc) return adhoc;
  return OPEN_ROOM_OPEN ? OPEN_TEAM.id : null;
}

/** Players per team. The game is designed around four — it is what the room's
 * slot colours and the wall art assume — so the proctor's board draws four
 * seats per team and refuses a fifth drop. Nothing enforces it below the
 * proctor UI: the lobby validates team ids, not team sizes. */
export const TEAM_SIZE = 4;

export interface LobbyPlayer {
  pid: string;
  name: string;
  /** null = waiting for the proctor to sort them. */
  team: string | null;
  /**
   * Whether this phone is holding a socket to the LOBBY right now — which is
   * narrower than "is with us". A phone drops that socket the moment it learns
   * its team and moves on to the game, so a sorted player who is happily
   * playing reads as false here. Trustworthy for an unsorted phone (it is on
   * the landing page or a waiting screen); for a sorted one, ask the game room.
   */
  connected: boolean;
}

export interface LobbySnapshot {
  players: LobbyPlayer[];
  teams: Team[];
  /**
   * **The game's levels.** One global pack for the whole event, as a list of
   * level links (see `goomba/pack.ts`).
   *
   * It rides the LOBBY rather than a Durable Object of its own because the
   * lobby is already the one thing that outlives a game room, already the one
   * object every phone holds a socket to, and already the surface the proctor
   * drives. A pack DO would have been a second global singleton with the same
   * lifetime and an extra hop to reach it.
   *
   * The room server reads the same pack over an internal fetch, because it is
   * the authority that scores runs and cannot take a phone's word for what the
   * geometry was.
   */
  pack: LevelPack;
  /** Bumped on every pack write. A room compares this to what it last applied
   * rather than diffing the levels, so an unchanged pack costs nothing. */
  packV: number;
  /**
   * **Ad-hoc rooms that have been played in** (see ADHOC_PREFIX), newest first.
   *
   * PROCTOR CONNECTIONS ONLY — every other phone gets an empty list. A slug is
   * not a secret, but it is not an invitation either, and broadcasting the
   * whole list to the landing page would put every friend room one tap away
   * from every guest at the party.
   *
   * Nothing enumerates Durable Objects, so this is a registry rather than a
   * query: the goomba room announces its own name on the pack fetch it already
   * makes, and the lobby remembers it. That makes it a record of rooms that
   * have been JOINED — a link nobody has opened yet has never existed.
   */
  adhoc: AdhocRoom[];
}

/** One ad-hoc room the lobby has heard from. */
export interface AdhocRoom {
  /** Room id, `r-<slug>`. */
  id: string;
  /** When a phone last connected to it (epoch ms) — the only liveness the
   * lobby has, since it holds no socket to a game room. */
  seenAt: number;
}

export type LobbyClientMsg =
  | { type: "rename"; name: string }
  | { type: "assign"; pid: string; team: string | null } // proctor only
  /** Send one team's players back to Unassigned. Per TEAM rather than a
   * board-wide wipe: the proctor's board is five boxes, groups turn over one
   * team at a time, and a clear that emptied the other three with it was one
   * mis-click away from unsorting a room mid-event. */
  | { type: "clearTeam"; team: string } // proctor only
  | { type: "forget"; pid: string } // proctor only — drop one player
  /** Drop one ad-hoc room from the proctor's list. The ROOM is untouched —
   * its Durable Object keeps every level it has cleared, and it reappears here
   * the moment somebody opens the link again. This is "stop showing me this",
   * the same cheap tidy-up `forget` is for a player. */
  | { type: "forgetRoom"; room: string } // proctor only
  // ---- the level pack. Open to any phone, on purpose: the editor IS the
  // game's level selector, the party's own phones are the tool, and this runs
  // for one weekend in one room. Nothing here can corrupt a run — the room
  // server re-reads the pack from the authority and re-scores against it.
  /** Paste a level in. `index` null appends a new slot; otherwise it REPLACES
   * that slot, which is how you fix a level in Figma and paste over it. */
  | { type: "packSet"; index: number | null; hash: string }
  /** Drag a card to a new position. */
  | { type: "packMove"; from: number; to: number }
  | { type: "packDelete"; index: number }
  /** Replace the whole pack — how an operator seeds an empty event. */
  | { type: "packAll"; pack: LevelPack };

export type LobbyServerMsg = { type: "lobby"; snapshot: LobbySnapshot };
