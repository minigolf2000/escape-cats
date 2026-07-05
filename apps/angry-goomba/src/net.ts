import PartySocket from "partysocket";

export const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";

export function roomFromUrl(): string | null {
  return new URLSearchParams(location.search).get("room");
}

export function playerId(): string {
  const KEY = "escape-cats-pid";
  let pid = localStorage.getItem(KEY);
  if (!pid) {
    pid = crypto.randomUUID();
    localStorage.setItem(KEY, pid);
  }
  return pid;
}

export function playerName(): string {
  return localStorage.getItem("escape-cats-name") ?? "Cat";
}

export function connectGoomba(room: string): PartySocket {
  return new PartySocket({
    host: PARTYKIT_HOST,
    room,
    party: "goomba",
    query: { pid: playerId(), name: playerName() },
  });
}
