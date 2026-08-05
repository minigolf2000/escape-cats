// Transport: one interface, two backends. A PartyKit room for the real game,
// or the shared HexSim running in-page for ?debug practice. Either way the
// game code only ever sees snapshots arriving and intents leaving.

import PartySocket from "partysocket";
import type { HexClientMsg, HexServerMsg, HexSnapshot } from "@escape-cats/shared";

export const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";

// Taps are batched so a Zoomies mash doesn't send 20 messages a second.
const PET_FLUSH_MS = 100;

export interface Transport {
  send(msg: HexClientMsg): void;
  /** Enqueue one pet for the next batched `pets` message. Returns the seq of
   * the batch it will ride in, so the caller can hold its optimistic credit
   * until the server acknowledges that batch. */
  queuePet(): number;
}

/** Swapped in by connectRoom/startDebug. A stable object so game modules can
 * import it once at load, before any connection exists. */
export const transport: Transport = {
  send() {},
  queuePet: () => 0,
};

export function roomFromUrl(): string | null {
  return new URLSearchParams(location.search).get("room");
}

/** ?debug — the practice bench: the shared sim in-page, no server, no room.
 * ?solo was the old name for the same thing and still works, so a bookmark or
 * a printed link from before the rename doesn't dead-end. */
export function debugFromUrl(): boolean {
  const q = new URLSearchParams(location.search);
  return q.has("debug") || q.has("solo");
}

/** Persistent per-device player id so reconnects reclaim the same seat. */
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
  onSnapshot: (snap: HexSnapshot) => void;
  onConnection: (up: boolean) => void;
  onPetAck: (seq: number) => void;
}): void {
  const socket = new PartySocket({
    host: PARTYKIT_HOST,
    room: opts.room,
    query: { pid: playerId(), name: opts.name },
  });

  let pendingPets = 0;
  let batchSeq = 0;
  // When each queued tap happened, so the batch can carry its rhythm and not
  // just its size.
  let tapTimes: number[] = [];
  const flush = () => {
    if (pendingPets > 0 && socket.readyState === socket.OPEN) {
      batchSeq++;
      const now = performance.now();
      socket.send(
        JSON.stringify({
          type: "pets",
          count: pendingPets,
          seq: batchSeq,
          offsets: tapTimes.map((t) => Math.round(t - now)),
        }),
      );
      pendingPets = 0;
      tapTimes = [];
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
    else if (msg.type === "petAck") opts.onPetAck(msg.seq);
  });

  transport.send = (msg) => {
    // A purchase must land AFTER the pets already queued, or the server may
    // reject it for a bank the taps have actually filled.
    flush();
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };
  transport.queuePet = () => {
    pendingPets++;
    tapTimes.push(performance.now());
    return batchSeq + 1; // the batch this tap will leave in
  };
}
