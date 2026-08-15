import { Lobby } from "./Lobby";

/** One flat page: one box per team that is both the drop target for sorting
 * and that team's live game status. */
export function App() {
  return (
    <div className="setup">
      <Lobby />
    </div>
  );
}
