#!/usr/bin/env node
// Put levels into a running event — and read back what it is running.
//
//   node seed.mjs                          # print the repo's seed pack
//   node seed.mjs --push                   # send it to the local dev lobby
//   node seed.mjs --push --host g00.mba    # …or to a deployed one
//   node seed.mjs --push --file pack.json  # send some other pack
//   node seed.mjs --pull                   # print what the event is running
//
// The game has no built-in levels any more: `GOOMBA_LEVELS` ships empty and the
// event's pack lives in the lobby Durable Object, which is the only copy. That
// is the right shape for a party — a level pasted from Figma is live for
// everyone a second later, with no deploy — but it means a brand new event
// starts with an empty grid. This is the one command that fills it.
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
import { LEVELS, encodeLevel } from "./lib.mjs";

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

const file = opt("file", null);
const pack = file ? JSON.parse(await readFile(file, "utf8")) : LEVELS.map(encodeLevel);

if (!flag("push")) {
  console.log(JSON.stringify(pack, null, 2));
  console.error(
    `\n${pack.length} level(s): ${LEVELS.map((l) => l.name).join(" · ")}\n` +
    `add --push to send this to the lobby at ${host}`,
  );
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
