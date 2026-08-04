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

export interface LobbyPlayer {
  pid: string;
  name: string;
  /** null = waiting for the proctor to sort them. */
  team: string | null;
  connected: boolean;
}

export interface LobbySnapshot {
  players: LobbyPlayer[];
  teams: Team[];
}

export type LobbyClientMsg =
  | { type: "rename"; name: string }
  | { type: "assign"; pid: string; team: string | null } // proctor only
  | { type: "autoAssign" } // proctor only — round-robin the unassigned
  | { type: "clearTeams" } // proctor only
  | { type: "forget" }; // proctor only — drop players who have gone home

export type LobbyServerMsg = { type: "lobby"; snapshot: LobbySnapshot };
