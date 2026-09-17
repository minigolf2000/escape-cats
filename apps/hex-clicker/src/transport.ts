// THE SEAM. Everything the player does is an intent sent through here, and
// everything the game knows arrives as a snapshot — the shape a server
// used to sit behind. There is no server (`backend.ts` runs the shared HexSim
// in this tab), and the seam stays anyway: `applySnapshot` and the edge flags
// it reports are the spine of this client, and a shortcut past `transport`
// is how that comes apart.

import type { HexClientMsg } from "@escape-cats/shared";

export interface Transport {
  send(msg: HexClientMsg): void;
  /** Enqueue one pet for the next batched `pets` message.
   *
   * Still BATCHED with nothing to batch for: a Zoomies mash is 20 taps a
   * second, and folding them into one `pets` per flush keeps the sim's income
   * fold off the tap path — which is the one path in this game that has to
   * stay at 60fps. What went with the server is the ACK: credit used to be
   * optimistic until the authority confirmed the batch, and a local sim
   * confirms it inside the same call. */
  queuePet(): void;
}

/** Swapped in by `startBackend`. A stable object so game modules can import it
 * once at load, before the backend is wired. */
export const transport: Transport = {
  send() {},
  queuePet() {},
};

/** `?debug` mounts the 🛠 tuning panel. */
export function debugFromUrl(): boolean {
  return new URLSearchParams(location.search).has("debug");
}
