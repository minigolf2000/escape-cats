import type PartySocket from "partysocket";

/**
 * A hidden tab lets go of its socket; a visible one takes it back.
 * partysocket reconnects forever, so a proctor tab forgotten in the
 * background would otherwise hold one socket per team all night, pinning
 * every room's Durable Object resident (billed duration) on nobody's
 * behalf. Reconnecting is cheap: every server sends a fresh snapshot on
 * connect, so the page repaints itself.
 *
 * Returns the listener's remover, for use in effect cleanup.
 */
export function closeWhileHidden(socket: PartySocket): () => void {
  const onVisibility = () => {
    if (document.hidden) socket.close();
    else socket.reconnect();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
}
