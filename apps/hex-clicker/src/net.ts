// Transport: one interface, two backends. A room on the server for the real
// game, or the shared HexSim running in-page for ?debug. Either way the
// game code only ever sees snapshots arriving and intents leaving.
//
// `partysocket` is imported DYNAMICALLY, inside the two functions that open a
// socket, and this is load-bearing rather than fussiness. Every game module
// (pet, shop, golden, debug) imports `transport` from here, so this module is
// always in the graph — a static import would put the websocket client in the
// main bundle for ?debug players too, who never open a socket at all. With the
// import inside the functions, Vite splits it into a chunk that is fetched only
// when someone actually joins a room. Keep the type-only import below type-only.

import type PartySocket from "partysocket";
import { roomFor } from "@escape-cats/shared";
import type {
  HexClientMsg,
  HexServerMsg,
  HexSnapshot,
  LobbyServerMsg,
} from "@escape-cats/shared";

export const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";

// Taps are batched so a Zoomies mash doesn't send 20 messages a second.
const PET_FLUSH_MS = 100;

export interface Transport {
  send(msg: HexClientMsg): void;
  /** Enqueue one pet for the next batched `pets` message. `x`/`y` are where on
   * Hex the finger landed, as fractions of her bounding box, so teammates can
   * replay the tap where it actually happened; omit them and the tap replays
   * scattered. Returns the seq of the batch it will ride in, so the caller can
   * hold its optimistic credit until the server acknowledges that batch. */
  queuePet(x?: number, y?: number): number;
}

/** A 0..1 box fraction to the integer thousandths the wire carries (see
 * HexClientMsg). Anything not a real fraction lands on her middle rather than
 * her top-left corner, which is where a bad number would otherwise put it. */
function thousandths(v: number | undefined): number {
  if (!Number.isFinite(v)) return 500;
  return Math.max(0, Math.min(1000, Math.round((v as number) * 1000)));
}

/** Swapped in by connectRoom/startDebug. A stable object so game modules can
 * import it once at load, before any connection exists. */
export const transport: Transport = {
  send() {},
  queuePet: () => 0,
};

/** ?debug — the shared sim in-page, no server, no room.
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
  // Null until the partysocket chunk lands. Everything below is written to
  // tolerate that gap rather than to wait for it: the transport is installed
  // synchronously, so a tap that beats the chunk is QUEUED, not dropped.
  let socket: PartySocket | null = null;

  let pendingPets = 0;
  let batchSeq = 0;
  // When each queued tap happened, so the batch can carry its rhythm and not
  // just its size — and where each one landed, so it can carry its spot too.
  // All three stay index-aligned; queuePet only ever appends to all of them.
  let tapTimes: number[] = [];
  let tapXs: number[] = [];
  let tapYs: number[] = [];
  const flush = () => {
    if (pendingPets > 0 && socket && socket.readyState === socket.OPEN) {
      batchSeq++;
      const now = performance.now();
      socket.send(
        JSON.stringify({
          type: "pets",
          count: pendingPets,
          seq: batchSeq,
          offsets: tapTimes.map((t) => Math.round(t - now)),
          xs: tapXs,
          ys: tapYs,
        }),
      );
      pendingPets = 0;
      tapTimes = [];
      tapXs = [];
      tapYs = [];
    }
  };
  setInterval(flush, PET_FLUSH_MS);

  transport.send = (msg) => {
    // A purchase must land AFTER the pets already queued, or the server may
    // reject it for a bank the taps have actually filled.
    flush();
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  };
  transport.queuePet = (x, y) => {
    pendingPets++;
    tapTimes.push(performance.now());
    tapXs.push(thousandths(x));
    tapYs.push(thousandths(y));
    return batchSeq + 1; // the batch this tap will leave in
  };

  void (async () => {
    const { default: PartySocket } = await import("partysocket");
    socket = new PartySocket({
      host: PARTYKIT_HOST,
      room: opts.room,
      query: { pid: playerId(), name: opts.name },
    });
    wire(socket);
  })();

  function wire(socket: PartySocket) {
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
  }
}

/**
 * Watch the lobby for this phone's room. Connecting also REGISTERS the phone in
 * the lobby roster (same pid+name contract the landing page uses), so a player
 * who lands here unsorted appears on the proctor's board.
 *
 * Which room that is comes from `roomFor`, not from here — a sorted phone gets
 * its team, and an unsorted one gets the shared testing room (or `null`, the
 * old waiting screen, when that room is closed). One rule, three surfaces.
 *
 * Once we are in a REAL team the socket closes: the answer cannot change under
 * us in a way this phone should follow silently, and the lobby object should be
 * free to hibernate. A phone in the testing room keeps it open instead, because
 * for that one the answer very much can change — the proctor sorting a tester
 * onto a team mid-session reloads the page into it.
 */
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
    let joined: string | null = null;
    socket.addEventListener("open", () => opts.onStatus(true));
    socket.addEventListener("close", () => opts.onStatus(false));
    socket.addEventListener("message", (e) => {
      const msg: LobbyServerMsg = JSON.parse(e.data as string);
      if (msg.type !== "lobby") return;
      const me = msg.snapshot.players.find((p) => p.pid === pid);
      const room = roomFor(me?.team ?? null);
      if (room === null) return; // unsorted, and the testing room is closed
      if (joined === null) {
        joined = room;
        if (me?.team) socket.close();
        opts.onTeam(room, me?.name ?? opts.name);
        return;
      }
      // Only reachable from the testing room, whose socket stayed open.
      // A reload is the whole move: the room is never in the URL, so the
      // fresh boot re-asks the lobby and lands in the new team.
      if (room !== joined) location.reload();
    });
  })();
}
