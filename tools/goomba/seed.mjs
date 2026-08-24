#!/usr/bin/env node
// Put levels into a running event — and read back what it is running.
//
//   node seed.mjs --pull                   # print what the event is running
//   node seed.mjs --pull --host g00.mba    # …on a deployed one
//   node seed.mjs --file pack.json         # print a pack file
//   node seed.mjs --push --file pack.json  # send it to the local dev lobby
//   node seed.mjs --push --file pack.json --host g00.mba
//
// The game has no built-in levels: `GOOMBA_LEVELS` ships empty and the event's
// pack lives in the lobby Durable Object, which is the only copy. That is the
// right shape for a party — a level pasted from Figma is live for everyone a
// second later, with no deploy — but it means a brand new event starts with an
// empty grid, and the way you fill it is by pasting frames.
//
// This command is the OTHER way: it moves a pack between events, and reads back
// what one is running. It used to be able to seed from the repo, and the five
// levels it seeded from are deleted — see `pack.ts`.
//
// It is deliberately a COMMAND rather than a button in the editor. Seeding is
// an operator's day-one action, not something to leave one tap away from a
// phone that is mid-level; and the editor's job is the four things a person
// does at a party (paste, reorder, delete, play), which this is not one of.
//
// It talks to the lobby exactly as a phone does — same party, same room, same
// message shapes. There is no admin door, because there isn't one, and adding
// one for a weekend in one room would be the wrong trade.
import { readFile } from "node:fs/promises";
// No lib.mjs import: this command moves packs around and never decodes one.

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const host = opt("host", "127.0.0.1:1999");
const local = /^(127\.|localhost|0\.0\.0\.0|\[::1\])/.test(host);
const url = `${local ? "ws" : "wss"}://${host}/parties/lobby/main?pid=seed-tool&name=seed`;

/**
 * Open the lobby socket and hand each snapshot to `onSnap(pack, send, done)`.
 * `onSnap` is called once per snapshot, so a caller can wait for the FIRST one
 * (that's the greeting) and then for the one its own write causes.
 */
function lobby(onSnap) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`no answer from the lobby at ${url}`));
    }, 8000);
    const done = (v) => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(v);
    };
    const send = (msg) => ws.send(JSON.stringify(msg));
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`could not reach the lobby at ${url}`));
    });
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "lobby") onSnap(msg.snapshot.pack ?? [], send, done);
    });
  });
}

if (flag("pull")) {
  const pack = await lobby((pack, _send, done) => done(pack));
  console.log(JSON.stringify(pack, null, 2));
  console.error(`\n${pack.length} level(s) live on ${host}`);
  process.exit(0);
}

// A pack has to come from a FILE now. There is no repo-side pack to fall back
// on: `SEED_LEVELS` — five levels kept as TypeScript literals for exactly this
// command to push — is deleted, because a level's source is the Figma frame it
// was drawn in and a hand-maintained transcription beside it is a second copy
// that goes stale. What this command is for is moving a pack BETWEEN events:
// pull one out of the lobby that has it, push it into the one that needs it.
const file = opt("file", null);
if (!file) {
  console.error("nothing to push: --push needs --file <pack.json>.");
  console.error("");
  console.error("There are no levels in the repo to seed from. Levels are drawn in");
  console.error("Figma and pasted into the game (press \\), and an event's pack lives in");
  console.error("its lobby. To copy one event's levels into another:");
  console.error("");
  console.error("  node seed.mjs --pull --host g00.mba > pack.json");
  console.error("  node seed.mjs --push --file pack.json");
  process.exit(2);
}
const pack = JSON.parse(await readFile(file, "utf8"));

if (!flag("push")) {
  console.log(JSON.stringify(pack, null, 2));
  console.error(`\n${pack.length} level(s) in ${file}\n` +
                `add --push to send it to the lobby at ${host}`);
  process.exit(0);
}

// Write, then read back — "I ran the seeder" and "the event has levels" are
// different claims, and only the second one matters at 9pm.
let sent = false;
const live = await lobby((got, send, done) => {
  if (!sent) { sent = true; send({ type: "packAll", pack }); return; }
  done(got);
});
const ok = live.length === pack.length;
console.log(`pushed ${pack.length} → the lobby now holds ${live.length} level(s)`);
process.exit(ok ? 0 : 1);
