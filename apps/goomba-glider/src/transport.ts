// THE SEAM. Everything the game does is an intent sent through here, and
// everything it knows arrives as a snapshot — the shape a server used to sit
// behind. There is no server any more (`backend.js` runs the shared sim
// in this tab), and the seam stays anyway, because it is what the whole client
// is built around: `main.js` reacts to snapshots, `input.js` and `selector.js`
// only ever send intents. Nothing calls a sim method directly. Keep it that
// way — the phase-edge handling in `onSnapshot` is the spine of this app.

import type { GoombaClientMsg } from "@escape-cats/shared";

export interface Transport {
  send(msg: GoombaClientMsg): void;
}

/** Swapped in by `startBackend`. A stable object so modules can import it once
 * at load; an intent sent before the backend is wired is dropped, and every
 * one of them is re-derivable from the next snapshot. */
export const transport: Transport = { send() {} };
