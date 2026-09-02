import { OPEN_ROOM_OPEN, OPEN_TEAM } from "@escape-cats/shared";
import { TeamGame } from "./TeamGame";

/** The shared room every unsorted phone plays in, drawn INSIDE the Unassigned
 * box — that box's game, not a sixth drop target. `assigned` is empty because
 * the lobby's `connected` goes false once a phone leaves the landing page;
 * the Hex block's "n playing" comes from the room and can exceed the names
 * above it. */
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
