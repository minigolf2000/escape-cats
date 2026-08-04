// Transport: one interface, two backends. A PartyKit room for the real game,
// or the shared HexSim running in-page for ?solo practice. Either way the
// game code only ever sees snapshots arriving and intents leaving.

import PartySocket from "partysocket";
import type { HexClientMsg, HexServerMsg, HexSnapshot } from "@escape-cats/shared";

export const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";

// Taps are batched so a Zoomies mash doesn't send 20 messages a second.
const PET_FLUSH_MS = 100;

export interface Transport {
  send(msg: HexClientMsg): void;
  /** Enqueue one pet for the next batched `pets` message. */
  queuePet(): void;
}

/** Swapped in by connectRoom/startSolo. A stable object so game modules can
 * import it once at load, before any connection exists. */
export const transport: Transport = {
  send() {},
  queuePet() {},
};

export function roomFromUrl(): string | null {
  return new URLSearchParams(location.search).get("room");
}

export function soloFromUrl(): boolean {
  return new URLSearchParams(location.search).has("solo");
}

/** Persistent per-device player id so reconnects reclaim the same seat. */
function playerId(): string {
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
  onSnapshot: (snap: HexSnapshot) => void;
  onConnection: (up: boolean) => void;
}): void {
  const socket = new PartySocket({
    host: PARTYKIT_HOST,
    room: opts.room,
    query: { pid: playerId(), name: opts.name },
  });

  let pendingPets = 0;
  const flush = () => {
    if (pendingPets > 0 && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "pets", count: pendingPets }));
      pendingPets = 0;
    }
  };
  setInterval(flush, PET_FLUSH_MS);

  socket.addEventListener("open", () => {
    opts.onConnection(true);
    socket.send(JSON.stringify({ type: "join", name: opts.name }));
  });
  socket.addEventListener("close", () => opts.onConnection(false));
  socket.addEventListener("message", (e) => {
    const msg: HexServerMsg = JSON.parse(e.data as string);
    if (msg.type === "state") opts.onSnapshot(msg.state);
  });

  transport.send = (msg) => {
    // A purchase must land AFTER the pets already queued, or the server may
    // reject it for a bank the taps have actually filled.
    flush();
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };
  transport.queuePet = () => {
    pendingPets++;
  };
}
