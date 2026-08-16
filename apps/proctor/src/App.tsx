import { Chats } from "./Chats";
import { Lobby } from "./Lobby";
import { TestRoom } from "./TestRoom";

/** One flat page: one box per team that is both the drop target for sorting
 * and that team's live game status, then the shared testing room every
 * unsorted phone plays in, then every room's chat — the teams talk to the
 * proctor through those channels, so the dashboard reads them rather than
 * making someone open five tabs. */
export function App() {
  return (
    <div className="setup">
      <Lobby />
      <TestRoom />
      <Chats />
    </div>
  );
}
