import type PartySocket from "partysocket";

/** A hidden tab lets go of its socket; a visible one takes it back.
 * partysocket reconnects forever, so a background proctor tab would otherwise
 * pin every room's Durable Object resident all night. Every server sends a
 * fresh snapshot on connect. Returns the listener's remover. */
export function closeWhileHidden(socket: PartySocket): () => void {
  const onVisibility = () => {
    if (document.hidden) socket.close();
    else socket.reconnect();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
}
