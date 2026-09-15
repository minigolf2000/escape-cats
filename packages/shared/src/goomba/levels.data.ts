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
// EVERY ROW BELOW WAS READ OUT OF FIGMA, frame by frame, through the shipped
// reader (`figma/read-frame.mjs --nodes`) — the same code path a Ctrl+V takes.
// The Figma file is still the SOURCE of a level's shape; a row is what a frame
// becomes when it ships. To change one, change the frame and re-paste it.
//
// The ORDER is the page's own left-to-right, top-to-bottom layout, which is
// also the difficulty ramp. A level's number is its position here + 1
// (`levelLabel`), computed at display — never typed into a name.
//
// `bonus: true` marks a POST-CREDITS level. The finale fires on the last row
// WITHOUT it — Fireworks — and everything after sits behind the ending, reached
// from the levels grid that clearing the game unlocks. Moving that line is
// moving the flag: nothing else knows where the credits roll.
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
    id: "welcome",
    name: "Welcome to Goomba Glider",
    hash: "AwIYV2VsY29tZSB0byBHb29tYmEgR2xpZGVy1ALcApwJcAIC_wkdkAM8ArgDRIgEUAGRA9UBAAAArQmnA7AOmgg",
  },
  {
    id: "first-steps",
    name: "First Steps",
    hash: "AwILRmlyc3QgU3RlcHP4AoADH6QLBQKnAZEMAMgIAoIExQaBBDMD5ArOAaUDH70HuAIC9golgwPqAQLABd4EmQ20AwOCCd8MFfoCDaIFAAAApQrXDOIP9BI",
  },
  {
    id: "holding-hands",
    name: "Holding hands",
    hash: "AwINSG9sZGluZyBoYW5kc6oBkAP0EKAGAQKfEb8F2AFGAfwJ2ggAAADRDI8N0BTgEg",
  },
  {
    id: "party-poppers",
    name: "Party poppers",
    hash: "AwINUGFydHkgcG9wcGVyc8YDqgWqBKwZBALtBasYrgZ8ArAKkBEA7xAC2wXkDbgDAASDB8QKjwMAANECkAMABMYHwRLJCLAG4gXuAlqmCgPlB7cYgweoFCnCDYQHAIIKuguLFQAAAOEQ4R7QFKYi",
  },
  {
    id: "fireworks",
    name: "Fireworks",
    hash: "AwIJRmlyZXdvcmtzbPgTkA6vCAICyQ7yCM4BIgKsA4ML5gPFAQaxAt0EA8gCoAicC_4Cmwu7AewQpQmNCA_UBI4IjwOoFKsIAAAAvAvoAvcKAP4CAAAA_QLPBQAA_gIAAAD9As8FAAD-AgAAAP0CzwUAAP4CAAAAAKcFqwIAhQe0BcAlAMsBuQWbMQCvBQCYKgAAggiTIwAABPQHFADoAgDoAgC4COsLzxmSFOgb",
  },
  {
    id: "cats-cradle",
    bonus: true,
    name: "Cat's Cradle",
    hash: "AwIMQ2F0J3MgQ3JhZGxl2AKoAcUBgBABAmqRD9gBRgSsBXy7BYIF9gOOB50CAwgQ4QurAqgUsAcAAACvB8QJAACuB9YEtxcAALUJAAAC4AS4FwCvB9YEtxcAALUJAAAAAKsF5QjwEfIU",
  },
  {
    id: "the-long-way-up",
    bonus: true,
    name: "The Long Way Up",
    hash: "AwIPVGhlIExvbmcgV2F5IFVw5AHEGugB9QsFGKkCyA2mBFCAAwAKAAoBCgEMAQoBCAMKAwoFCAUKBQgFBgcIBQYHBgkGBwYJBAcECQIJAgkNqgS3D74BPB5PMRNuWTsTblk7E25ZOxNQE58BbVC9AQOkA-sDKLgDE7gDA4ESmgPIAcgBtAHHARqoCa4PugMACgEKAAoBDAEKAwgDCgMKAwgFCgUIBQYHCAcGBwYHBgcGCQQJBAkCCQIJAgkCCQAJA8sEvRfXBKwChwSIBAf0BtICmwmoFJkI7A6cCQC-Cg4AAMQD7wSLFQDlC-0FwA0A8gUAuwYA6AOJCzwAAAKEAtsBnwnMCYkJ8Q2KFuwd",
  },
  {
    id: "merry-go-round",
    bonus: true,
    name: "Merry Go Round",
    hash: "AwIOTWVycnkgR28gUm91bmTKCcwDAJwTCgJP1xMAyAECoAHHAQDIAREMpAM8CjoOOBQ4GDQeMiAwJiwoKCwmMCAyHDQaNhI6EDoKPBEAugEJOg86ETgZOBs0HzIlMCcsKygvJjEgMx43GDcSORA7ChG5AQA5CTkNORM1FzMdMx8tJSsnKSsjLx8xHTMXNRM5DTkJOxEAtwEKOw45FDcYNxwzIjEkLyorLCcuJTIfNh02FzoROg86CRe6AYUCPgg-DDwQOhI6GDoaNh40IjIkMCguKiouKDAkMiI0HjYaOhg4EjwQPAw-CD4XALoBBzwLPg88ETwXOBk6HTYhNCMyJzApLi0qLygxJDMiNR45GjkYORI7ED0MPQgXuQEAPQc7CzsPOxE5FzcZNR0zITMjLycrKSstJS8lMR8zHTUZORc3EzsNOws9Bz0XALcBCD0MPQ47FDsWNxw5HjUgMyYxKC8qLS4pLic0IzQhNh04GToXPBE8DzwLPgcE9wSQBIQJlwKzBfIF-APYARXNCM0DiA6oFADMA5MFAOYBkAOHBQCQA-YB7wQAzAMAzQQAkAPlAacEAOYBjwONBAAAywONBADnAY8DpwQAjQPlAc0EAMsDALAzAI8D5gGHBQCECdAG0QEAswK0AoQHALMDAJsxALUCswKEBwAAswOEBwC2ArMChAcAtAMAhAcAtAK0AoQHAI0E2gHCAwAAAMkJzw2UE9gY",
  },
  {
    id: "slalom",
    bonus: true,
    name: "Slalom",
    hash: "AwIGU2xhbG9tiAS4A7gNzBwCAs8P8xyoBcgBBN8DUACwGKgPkAMAvxsDnwv4BfAGmAfvBpgHAAAAvwfPGdAU2CI",
  },
  {
    id: "the-end",
    bonus: true,
    name: "The end",
    hash: "AwIHVGhlIGVuZNQCsgWCJNQECSS5In-2AgARQBU6HTYjMCkoKyAxGjEOMwY1AzENMRUtHSknIy0fNRc5ETsJPwNBBEEOPxI7HDcgMyYrLCUuGzITNAs0ATQIMhIwGibmBgUsICoqJC4eNhY6Ej4IQAJCBUINPhM8GzghMiUsKyIvHDEUMwgzADMHMRMvGykhJyshMRs3EzsNPQVBAkEIPxI9FjkeNSQvKCcuHyasCQAsICoqJC4eNhY6Ej4IQAJCBUINPhM8GzghMiUsKyIvHDEUMwgzADMHMRMvGykhJyshMRs3EzsNPQVBAkEIPxI9FjkeNSQvKCcuHwamBdYGAIMH1ALQBYwBANQCzwUAhAchoAGHBFoBVgdUCUwPRBM6FTAZIhscOQAAGzkAACMbLRk5FUMTSw9TCVUHWQEAhAdcAVgFVglQC0gPQhM2FSwVIBkaNRk2DOUE8wFaAloGVgpQDEgQQBQ4FiwYIBgSGggcAjy-AawCswUC4AO0BasCswUCpQOuBJgFAAHnHE0DkQexAaELqBTsAzv8AQDwBgAcAAACwgoY5gjQAscigQuEKpwO",
  },
];
