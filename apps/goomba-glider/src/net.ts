// Transport for the Goomba room. Same shape as hex-clicker's net.ts; the
// ?debug backend lives in debug.js (the shared GoombaSim in-page, feeding the
// LEVEL LAB) and swaps itself into `transport` exactly the way connectRoom
// does, so the game code cannot tell which backend it is on.
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
  /** Stream the band being stretched right now (throttled to ~10Hz on the
   * wire); pass null when the drag ends without a placement. Teammates render
   * it as a live ghost. */
  preview(bd: { ax: number; ay: number; bx: number; by: number } | null): void;
}

/** Swapped in by connectRoom. A stable object so the game module can import it
 * once at load, before any connection exists; intents sent before the socket
 * opens are dropped — every one of them is re-derivable from the next
 * snapshot, unlike hex's pets. */
export const transport: Transport = {
  send() {},
  preview() {},
};

/** How often a drag-in-progress goes on the wire. 10Hz reads as live motion
 * on the other phones while costing a handful of tiny messages per second. */
const PREVIEW_MS = 100;

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

  // Throttle with a trailing send, so the ghost's final position lands even
  // if the last move fell inside the window. The clear (null) always goes out
  // immediately — a lingering ghost is worse than an extra message.
  let lastPreviewAt = 0;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;

  transport.send = (msg) => {
    // A placement retires my ghost in the room. A trailing preview firing
    // after it would raise a new one with no gesture behind it, and it would
    // sit on every teammate's phone until the 3s TTL swept it — so the
    // placement takes the queued send with it.
    if (msg.type === "place" && previewTimer) {
      clearTimeout(previewTimer); previewTimer = null; lastPreviewAt = 0;
    }
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  };

  transport.preview = (bd) => {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    if (bd === null) {
      lastPreviewAt = 0;
      transport.send({ type: "preview" });
      return;
    }
    const wait = lastPreviewAt + PREVIEW_MS - Date.now();
    const fire = () => {
      lastPreviewAt = Date.now();
      transport.send({ type: "preview", ax: bd.ax, ay: bd.ay, bx: bd.bx, by: bd.by });
    };
    if (wait <= 0) fire();
    else previewTimer = setTimeout(fire, wait);
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
