import { OPEN_ROOM_OPEN, OPEN_TEAM } from "@escape-cats/shared";
import { TeamGame } from "./TeamGame";

/**
 * The shared room every unsorted phone plays in, watched exactly like a team's
 * — and drawn INSIDE the Unassigned box, because it is the Unassigned box's
 * game. A team's box is that team's roster and that team's games; the holding
 * pen's roster is exactly the set of phones playing in t0, so the same pairing
 * holds and the readout belongs in the same box rather than adrift below the
 * board. It is still not a sixth drop target: the zones grid is built from
 * ZONES, and this is a block inside one of them.
 *
 * The same two GameBlocks and the same two reset buttons, which is the only way
 * to unwedge a testing room that a phone left mid-run. `assigned` is empty
 * because the lobby has no idea who is in here: an unsorted phone's `connected`
 * flag goes false the moment it leaves the landing page for the game. The Hex
 * block's "n playing" is the honest count, and it comes from the room itself —
 * which is also why it can exceed the names listed above it.
 */
export function TestRoom() {
  if (!OPEN_ROOM_OPEN) return null;
  return (
    <div className="testroom">
      <p className="muted">
        Room {OPEN_TEAM.id} — every phone nobody has sorted plays here, no drag
        needed. Drop one on a team and that phone reloads into it.
      </p>
      <TeamGame team={OPEN_TEAM} assigned={[]} />
    </div>
  );
}
