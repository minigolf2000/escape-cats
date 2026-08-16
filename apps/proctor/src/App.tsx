import { Chats } from "./Chats";
import { Lobby } from "./Lobby";

/** One flat page: one box per team that is both the drop target for sorting
 * and that team's live game status, then every team's chat below it — the
 * teams talk to the proctor through those channels, so the dashboard reads
 * them rather than making someone open four tabs. */
export function App() {
  return (
    <div className="setup">
      <Lobby />
      <Chats />
    </div>
  );
}
