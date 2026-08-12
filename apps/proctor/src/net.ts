/**
 * Host of the room server, for every socket this page opens — the lobby party
 * and one game room per team. One definition, so a change to the host (port,
 * protocol, a path prefix) cannot fix half the dashboard.
 *
 * Kept under the `VITE_PARTYKIT_HOST` name for the same reason the clients do:
 * it is what `partysocket` reads everywhere. See the README's Configuration.
 */
export const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";
