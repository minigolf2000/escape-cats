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
 * its own box instead (`apps/proctor/src/App.tsx`).
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
 * The room id a phone should join, given what the lobby says about it.
 * `null` means "no room — wait for the proctor", which is what every surface
 * renders its waiting screen on.
 *
 * A team id doubles as a room id, so a sorted phone's answer is just its team.
 * The interesting case is the unsorted one, and it is answered HERE rather
 * than three times over in the clients.
 */
export function roomFor(team: string | null): string | null {
  if (team) return team;
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
}

export type LobbyClientMsg =
  | { type: "rename"; name: string }
  | { type: "assign"; pid: string; team: string | null } // proctor only
  | { type: "clearTeams" } // proctor only
  | { type: "forget"; pid: string }; // proctor only — drop one player

export type LobbyServerMsg = { type: "lobby"; snapshot: LobbySnapshot };
