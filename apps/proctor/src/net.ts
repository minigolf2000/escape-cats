/** Host of the room server for every socket this page opens. Kept under
 * `VITE_PARTYKIT_HOST` because that is what `partysocket` reads everywhere
 * (README, Configuration). */
export const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";
