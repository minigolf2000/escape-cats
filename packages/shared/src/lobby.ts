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
