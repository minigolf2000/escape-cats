// Transport for the Goomba room. Same shape as hex-clicker's net.ts, minus the
// debug backend: there is no solo mode here. The locked party rule is 4 bands
// on every level with any player free to place the remainder, so even a single
// phone in a room can play the whole game — which is exactly what ?debug used
// to exist for.
//
// `partysocket` is imported dynamically for the same chunking reason as hex —
// though with no serverless mode left the win is only initial paint.

import type PartySocket from "partysocket";
import type {
  GoombaClientMsg,
  GoombaServerMsg,
  GoombaSnapshot,
  LobbyServerMsg,
} from "@escape-cats/shared";

export const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";

export interface Transport {
  send(msg: GoombaClientMsg): void;
}

/** Swapped in by connectRoom. A stable object so the game module can import it
 * once at load, before any connection exists; intents sent before the socket
 * opens are dropped — every one of them is re-derivable from the next
 * snapshot, unlike hex's pets. */
export const transport: Transport = {
  send() {},
};

/** Persistent per-device player id so reconnects reclaim the same seat —
 * the same key every other surface uses, which is the whole one-origin deal. */
export function playerId(): string {
  const KEY = "escape-cats-pid";
  let pid = localStorage.getItem(KEY);
  if (!pid) {
    pid = crypto.randomUUID();
    localStorage.setItem(KEY, pid);
  }
  return pid;
}

export function connectRoom(opts: {
  room: string;
  name: string;
  onSnapshot: (snap: GoombaSnapshot) => void;
  onConnection: (up: boolean) => void;
}): void {
  let socket: PartySocket | null = null;

  transport.send = (msg) => {
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  };

  void (async () => {
    const { default: PartySocket } = await import("partysocket");
    socket = new PartySocket({
      host: PARTYKIT_HOST,
      room: opts.room,
      party: "goomba",
      query: { pid: playerId(), name: opts.name },
    });
    socket.addEventListener("open", () => {
      opts.onConnection(true);
      socket!.send(JSON.stringify({ type: "join", name: opts.name }));
    });
    socket.addEventListener("close", () => opts.onConnection(false));
    socket.addEventListener("message", (e) => {
      const msg: GoombaServerMsg = JSON.parse(e.data as string);
      if (msg.type === "state") opts.onSnapshot(msg.state);
    });
  })();
}

/** Watch the lobby for this phone's team — verbatim the hex-clicker contract:
 * connecting also registers the phone in the lobby roster, so an unsorted
 * phone appears on the proctor's board and slots in when dragged to a team. */
export function watchTeam(opts: {
  name: string;
  onTeam: (team: string, name: string) => void;
  onStatus: (up: boolean) => void;
}): void {
  const pid = playerId();
  void (async () => {
    const { default: PartySocket } = await import("partysocket");
    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      room: "main",
      party: "lobby",
      query: { pid, name: opts.name },
    });
    socket.addEventListener("open", () => opts.onStatus(true));
    socket.addEventListener("close", () => opts.onStatus(false));
    socket.addEventListener("message", (e) => {
      const msg: LobbyServerMsg = JSON.parse(e.data as string);
      if (msg.type !== "lobby") return;
      const me = msg.snapshot.players.find((p) => p.pid === pid);
      if (me?.team) {
        socket.close();
        opts.onTeam(me.team, me.name);
      }
    });
  })();
}
