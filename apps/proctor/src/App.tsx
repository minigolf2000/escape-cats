import { ChatProvider } from "./Chats";
import { Lobby } from "./Lobby";

/** One flat page: a box per zone — drop target, live game status, chat. The
 * chat sockets belong to the PAGE (four connections reopening on every board
 * re-render would replay history), hence the provider around the board. */
export function App() {
  return (
    <div className="setup">
      <ChatProvider>
        <Lobby />
      </ChatProvider>
    </div>
  );
}
