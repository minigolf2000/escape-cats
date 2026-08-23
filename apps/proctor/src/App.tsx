import { ChatProvider } from "./Chats";
import { Lobby } from "./Lobby";

/** One flat page: one box per zone, and a box is everything about that zone at
 * once — the drop target for sorting, the live game status of the room those
 * players are in, and their chat. Unassigned is a zone like any other: its room
 * is the shared testing room, so it carries that readout and that channel.
 *
 * The chat sockets are the one thing that cannot live in a box (they belong to
 * the page: five connections that reopened on every board re-render would
 * replay history each time), hence the provider around the board rather than a
 * section under it. */
export function App() {
  return (
    <div className="setup">
      <ChatProvider>
        <Lobby />
      </ChatProvider>
    </div>
  );
}
