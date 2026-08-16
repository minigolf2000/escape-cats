import { OPEN_ROOM_OPEN, OPEN_TEAM } from "@escape-cats/shared";
import { TeamGame } from "./TeamGame";

/**
 * The shared room every unsorted phone plays in, watched exactly like a team's.
 *
 * It is NOT one of the board's boxes, and that is the point: the zones grid is
 * built from TEAMS, so a fifth box in there would be a fifth drop target and a
 * fifth thing to keep the same height under a drag. This is a plain readout
 * below the board — the same two GameBlocks, the same two reset buttons, which
 * is the only way to unwedge a testing room that a phone left mid-run.
 *
 * There is no roster line because the lobby has no idea who is in here: an
 * unsorted phone's `connected` flag goes false the moment it leaves the landing
 * page for the game. The Hex block's "n playing" is the honest count, and it
 * comes from the room itself.
 */
export function TestRoom() {
  if (!OPEN_ROOM_OPEN) return null;
  return (
    <div className="testroom">
      <div className="zone">
        <div className="zone-head">
          <strong>{OPEN_TEAM.name}</strong>
          <span className="muted">room {OPEN_TEAM.id}</span>
        </div>
        <p className="muted">
          Every phone nobody has sorted plays here — no drag needed. Drop one on
          a team above and that phone reloads into it.
        </p>
        <TeamGame team={OPEN_TEAM} assigned={[]} />
      </div>
    </div>
  );
}
