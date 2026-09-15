// THE PACK THE GAME SHIPS. This file is the level list: a level PR adds a row
// here, and that is the whole publishing pipeline.
//
// It replaces the lobby Durable Object, which used to hold an event's pack as
// the only copy anywhere. The old rule was "no level lives in this repo" —
// true while a pack was a party's live state, edited from a phone and live on
// every other phone a second later. A single-player game that anyone can open
// has no party to be live to, so the pack is source now: reviewable in a diff,
// versioned with the code that plays it, and impossible to lose.
//
// HOW TO ADD ONE (tools/goomba/DESIGNING.md is the long version):
//   1. draw the frame in Figma, Ctrl+C
//   2. Ctrl+V into the game on a laptop — it lands in your LOCAL overlay and
//      is playable immediately, with nothing deployed and nobody else affected
//   3. play it. Nothing here grades a level; playing it is the verdict
//   4. `export` in the levels grid copies the overlay as rows — paste below
//   5. give it an `id` you are happy to keep forever (see library.ts): it is
//      what a player's saved progress is keyed on
//
// `name` is advisory — the name players see is inside `hash`. Keeping a
// readable copy here is what makes the diff mean anything;
// `node tools/goomba/levels.mjs` fails if the two ever drift.

import type { LevelRow } from "./library";

export const BAKED_LEVELS: LevelRow[] = [
  {
    id: "in-and-out",
    name: "In and Out",
    hash: "AwAKSW4gYW5kIE91dJAKeACcEwoCT9cTAMgBAqABxwEAyAERDqQDOgo6EDoSNhg0HjIgMCYsKCgsJjAgMh40GDgUOA46CjwRALoBCToNOhM6FzYdNB8yJTAnLCsoLyYxIDMeNRg5FDkOOQoRuQEAOwk5DTcTNxczHTEfLyUrJycrJS8fMR0zFzUROQ85CTkRALkBCjsQORI3GDceMyAxJi8oKywnMCUyHzQdOBc4EToPPAkXugGFAjwIPgw8EDwSOhg4GjYeNCIyJDAoLioqLigwJDIiNB42GjoYOBI8EDwMPgg-FwC6AQc8Cz4PPBE8FzoZOB02ITQjMicwKS4tKi8oMSQzIjUeNxo5GDsSOxA9DDsIF7kBAD0HPQs7DzsRNxc5GTUdMyExIy8nLSkpLScvIzEhMx01GTcXORE7DzsLPQc7FwC5AQg9DD0QOxI7GDcaOR41IjMkMSgvKi0uKTAnMiM0ITYdOhk4FzwRPA8-Cz4HBPkEkASECZcC1QXeBYgEBBW7COUBiA7UFgDMA5MFAOYBkAOHBQCQA-YB7wQAzAMAzQQAkAPlAacEAOYBjwONBAAAywOSNADlAY8DpwQAjwPlAc0EAMsDAO8EAI8D5gGHBQCECdAG0QEAswK0AoQHALMDAIQHALMCswKEBwAAswOEBwC0ArMChAcAtAMAhAcAtAK0AoQHAI0E2gHdNIMHAAA",
  },
];
