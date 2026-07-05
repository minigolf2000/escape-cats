import PartySocket from "partysocket";

export const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";

export function roomFromUrl(): string | null {
  return new URLSearchParams(location.search).get("room");
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

export function connect(opts: {
  room: string;
  name: string;
  party?: string;
}): PartySocket {
  return new PartySocket({
    host: PARTYKIT_HOST,
    room: opts.room,
    party: opts.party,
    query: { pid: playerId(), name: opts.name },
  });
}
