// Per-team chat at /chat/, and the door into the event: a phone names itself
// HERE, which registers it in the lobby roster, and then waits. No team
// picker, no `?room=`, and no fallback room — being sorted is the prereq
// (`chatRoomFor`).

import PartySocket from "partysocket";
import {
  ANSWER_BURST,
  ANSWER_REFILL_MS,
  CHAT_BURST,
  CHAT_MAX_TEXT,
  CHIP,
  PROCTOR_PID,
  TEAMS,
  WAITING_LINE,
  chatRoomFor,
  cleanName,
  clampName,
  nameChipHtml,
  type AnswerSubmission,
  type ChatClientMsg,
  type ChatMessage,
  type ChatServerMsg,
  type LobbyServerMsg,
  type RenameMsg,
  type PlayerInfo,
} from "@escape-cats/shared";
import "./styles.css";

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";

// Same keys as the lobby and the game. localStorage is per-ORIGIN, which is
// why /chat is a path on the lobby's origin, not its own domain.
const PID_KEY = "escape-cats-pid";
const NAME_KEY = "escape-cats-name";

function playerId(): string {
  let stored = localStorage.getItem(PID_KEY);
  if (!stored) {
    stored = crypto.randomUUID();
    localStorage.setItem(PID_KEY, stored);
  }
  return stored;
}

const pid = playerId();
const app = document.getElementById("app") as HTMLDivElement;

/** The answer's one mark, drawn three times and nowhere else: the composer's
 * Answer button, the Submit it becomes, and a submitted line. A key because the answer is
 * a CODE WORD — `currentColor` so each of the three paints it itself. */
const KEY_SVG = `<svg class="key" viewBox="0 0 24 24" fill="none" stroke="currentColor"
 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
><circle cx="9" cy="9" r="4.6"/><path d="M12.4 12.4L20 20"/><path d="M15.6 15.6l-2 2"/><path d="M18 18l-2 2"/></svg>`;

/** The way back out of the mode. Same viewBox and stroke as the key so the
 * two swap inside the button without anything shifting. */
const X_SVG = `<svg class="key" viewBox="0 0 24 24" fill="none" stroke="currentColor"
 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>`;

let room: string | null = null;
let socket: PartySocket | null = null;
/** The lobby socket, held only until this phone is sorted — while it is open
 * it is the one that carries a rename (see `renameTo`). */
let lobbySocket: PartySocket | null = null;
let messages: ChatMessage[] = [];
/** The team's answers. A list of their own, not lines with a flag: they
 * survive a proctor's Clear chat, and `paint` merges the two by `at`. */
let answers: AnswerSubmission[] = [];
let players: PlayerInfo[] = [];
let connected = false;
/** Whether we have EVER been connected, so the first wait says "Connecting"
 * and a later one says "Reconnecting". */
let everConnected = false;
/** The shell is built ONCE and repainted, or a rebuild would throw away a
 * half-typed line every time someone speaks. */
let shell = false;
/** Lines typed before the socket opened, flushed when it opens — partysocket
 * connects asynchronously, and venue wifi drops mid-conversation. Bounded by
 * CHAT_BURST, all the server accepts in one flush. Submissions queue HERE
 * too, tagged: an answer lost to a wifi blink is the one this feature exists
 * to prevent. */
let outbox: { kind: "say" | "submit"; text: string }[] = [];
/** The client's copy of the server's answer bucket (`ANSWER_BURST` /
 * `ANSWER_REFILL_MS`), so a spent budget DISABLES the button instead of
 * swallowing a deliberate press. The server still decides — this only keeps
 * the refusal from being invisible. Same shape as `ChatServer.spend`. */
let askTokens = ANSWER_BURST;
let askAt = Date.now();
/** Pending re-enable, so repeated submits don't stack timers. */
let askTimer = 0;

/** Refill, then report whether one is affordable. */
function askReady(): boolean {
  const now = Date.now();
  askTokens = Math.min(
    ANSWER_BURST,
    askTokens + (now - askAt) / ANSWER_REFILL_MS,
  );
  askAt = now;
  return askTokens >= 1;
}

/** Grey the button out while the bucket is empty, and wake it when it isn't.
 * The composer is built once, so this only ever touches the button. */
function paintAsk() {
  const ask = document.getElementById("ask") as HTMLButtonElement | null;
  if (!ask) return;
  // Never disable the way OUT: only arming is rationed.
  const ready = askReady();
  ask.disabled = !armed && !ready;
  if (ready || askTimer) return;
  askTimer = window.setTimeout(() => {
    askTimer = 0;
    paintAsk();
  }, Math.ceil((1 - askTokens) * ANSWER_REFILL_MS));
}

/** Whether the composer is armed to submit. Module state, as the rename
 * draft is: a teammate speaking repaints the log under you and must not take
 * the mode you are in with it.
 *
 * The mode is DELIBERATELY not sticky past a send. Submitting disarms, so it
 * only ever lives as long as one answer takes to compose — chat is the room's
 * resting state and so it is the composer's. A mode that survived its own
 * send would submit the next thing typed, which is the classic mode error and
 * at a party is a certainty, not a risk. */
let armed = false;
/** Rename state lives up here, as in the lobby: a broadcast repaints the page
 * under you, and a draft held only in the DOM would go with it. */
let renaming = false;
let draft = "";

/** Cleaned on the way out, not just on the way in: the cap moved from 24 to
 * 12, so a phone can be carrying a name the server would no longer store. */
function myName(): string {
  return cleanName(localStorage.getItem(NAME_KEY));
}

function teamName(id: string): string {
  // Only one of the four reaches here: `chatRoomFor` answers nothing else.
  return TEAMS.find((t) => t.id === id)?.name ?? id;
}

// ---- Connections ----

/** Watch the lobby for this phone's team, then open that channel. Connecting
 * is also what REGISTERS the phone in the roster, so this socket is how an
 * unsorted phone appears on the proctor's board at all. */
function watchTeam() {
  const lobby = new PartySocket({
    host: PARTYKIT_HOST,
    room: "main",
    party: "lobby",
    query: { pid, name: myName() },
  });
  lobbySocket = lobby;
  lobby.addEventListener("message", (ev) => {
    let msg: LobbyServerMsg;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (msg.type !== "lobby") return;
    const next = chatRoomFor(
      msg.snapshot.players.find((p) => p.pid === pid)?.team,
    );
    if (next === null) return; // still unsorted, still waiting
    // Sorted: take the channel and stop watching. `close()` detaches this
    // listener, so a later re-sort arrives on the next load, not here.
    room = next;
    lobby.close();
    lobbySocket = null;
    connect();
    render();
  });
}

function connect() {
  if (!room) return;
  socket = new PartySocket({
    host: PARTYKIT_HOST,
    room,
    party: "chat",
    query: { pid, name: myName() },
  });
  socket.addEventListener("open", () => {
    connected = true;
    everConnected = true;
    const queued = outbox;
    outbox = [];
    for (const q of queued) {
      if (q.kind === "say") say(q.text);
      else submit(q.text);
    }
    render();
  });
  socket.addEventListener("close", () => {
    connected = false;
    render();
  });
  socket.addEventListener("message", (ev) => {
    let msg: ChatServerMsg;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    switch (msg.type) {
      case "chat":
        // A reconnect replays history: REPLACE, never append. A proctor's
        // clear arrives as this too — and carries the answers it did not
        // wipe, so they stay on screen.
        messages = msg.messages;
        // Tolerated missing, not assumed present: Vercel and the Worker
        // deploy independently, so a phone can hold a bundle that knows
        // about answers while the live Worker does not yet. Without this
        // the whole log throws on the first snapshot rather than simply
        // going without them until the Worker catches up.
        answers = msg.answers ?? [];
        players = msg.players;
        break;
      case "said":
        // Dedupe on id: our own lines come back through the fan-out.
        if (messages.some((m) => m.id === msg.message.id)) return;
        messages.push(msg.message);
        break;
      case "submitted":
        // Ids are per-list; never compared against a message's.
        if (answers.some((a) => a.id === msg.answer.id)) return;
        answers.push(msg.answer);
        break;
      case "presence":
        players = msg.players;
        break;
    }
    render();
  });
}

/** Rename on whichever socket this phone holds: the lobby's at the gate, the
 * room's in a channel, which forwards it to the lobby. One `RenameMsg` either
 * way. Stored first, so it is also what the next connection announces. */
function renameTo(name: string) {
  const clean = cleanName(name);
  if (!clean || clean === myName()) return;
  localStorage.setItem(NAME_KEY, clean);
  const msg: RenameMsg = { type: "rename", name: clean };
  const live = socket ?? lobbySocket;
  if (live && live.readyState === live.OPEN) live.send(JSON.stringify(msg));
  // A dropped socket is not a lost rename: it was stored above, and
  // partysocket reconnects announcing it in its query, which every roster
  // takes over the name it was holding (`Roster.register`).
}

/** Send a line now, or hold it in the outbox until the socket opens. */
function say(text: string) {
  if (send({ type: "say", text })) return;
  if (outbox.length < CHAT_BURST) outbox.push({ kind: "say", text });
}

/** The same for an answer. No optimistic echo here either: the server
 * stamps the id and the time, and the row it fans back is the receipt. */
function submit(text: string) {
  if (send({ type: "submit", text })) return;
  if (outbox.length < CHAT_BURST) outbox.push({ kind: "submit", text });
}

/** True if it went down the wire. */
function send(msg: ChatClientMsg): boolean {
  if (!socket || socket.readyState !== socket.OPEN) return false;
  socket.send(JSON.stringify(msg));
  return true;
}

// ---- Screens ----

/** Where a player joins the event, /chat/ being the URL handed out. Same
 * origin and same key as `/`, so someone who came that way skips it. */
function nameScreen() {
  app.innerHTML = `
    <div class="card">
      <h1>🐾 Team chat</h1>
      <p class="sub">What should we call you?</p>
      <input id="name" placeholder="Your name" autocomplete="off" />
      <button id="go" class="primary">Join</button>
    </div>
  `;
  const input = document.getElementById("name") as HTMLInputElement;
  input.focus();
  input.oninput = () => clampName(input);
  const submit = () => {
    const name = cleanName(input.value);
    if (!name) return;
    localStorage.setItem(NAME_KEY, name);
    boot();
  };
  (document.getElementById("go") as HTMLButtonElement).onclick = submit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") submit();
  };
}

/** Repaint the chip's own row and nothing else: a message arriving mid-edit
 * must not rebuild the input under the caret. */
function paintName() {
  const row = document.getElementById("namerow");
  if (!row) return;
  row.classList.toggle("editing", renaming);
  row.innerHTML = nameChipHtml(myName(), draft, renaming);
  wireNameChip();
}

function wireNameChip() {
  const chip = document.getElementById(CHIP.open);
  if (chip) {
    chip.onclick = () => {
      draft = myName();
      renaming = true;
      paintName();
    };
    return;
  }
  const input = document.getElementById(CHIP.input) as HTMLInputElement | null;
  const save = document.getElementById(CHIP.save);
  const cancel = document.getElementById(CHIP.cancel);
  if (!input || !save || !cancel) return;
  // The draft lives in module state, so a repaint redraws what is typed.
  input.oninput = () => {
    clampName(input);
    draft = input.value;
  };
  const done = (commit: boolean) => {
    if (commit) renameTo(draft);
    renaming = false;
    paintName();
  };
  save.onclick = () => done(true);
  cancel.onclick = () => done(false);
  input.onkeydown = (e) => {
    if (e.key === "Enter") done(true);
    if (e.key === "Escape") done(false);
  };
  // Focus once, on the repaint that opened the editor — a later one would
  // steal the caret mid-word.
  if (document.activeElement !== input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

/** The gate. No greeting — the chip already says who you are, and fixing that
 * is the only thing to do here — and no link out. */
function waitingScreen() {
  app.innerHTML = `
    <div class="card">
      <h1>🐾 Team chat</h1>
      <div class="waiting">
        <span class="spinner"></span>
        ${WAITING_LINE}
      </div>
      <div class="chiprow" id="namerow"></div>
    </div>
  `;
  paintName();
}

function chatScreen() {
  if (!shell) {
    app.innerHTML = `
      <div class="chat">
        <header class="chat-head">
          <div class="head-row">
            <div class="head-who">
              <h1 id="team"></h1>
              <p class="muted" id="who"></p>
            </div>
            <div class="namerow" id="namerow"></div>
          </div>
        </header>
        <ol class="log" id="log"></ol>
        <form class="composer" id="composer">
          <button class="ask" id="ask" type="button"></button>
          <input
            id="text"
            maxlength="${CHAT_MAX_TEXT}"
            autocomplete="off"
            enterkeyhint="send"
          />
          <button class="send" id="send" type="submit"></button>
        </form>
      </div>
    `;
    shell = true;
    paintName();
    const input = document.getElementById("text") as HTMLInputElement;
    // ONE exit, whichever mode it is in: the right-hand button and the Enter
    // key always do the thing the composer currently says it does.
    (document.getElementById("composer") as HTMLFormElement).onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      if (armed) {
        submit(text);
        askTokens -= 1;
        armed = false; // submitting always lands back in chat
      } else {
        say(text);
      }
      input.value = "";
      // No optimistic echo: the server decides ordering, truncation and
      // acceptance.
      paintComposer();
      input.focus();
    };
    // Arm, or stand down. Disarming KEEPS what is typed — changing your mind
    // should cost nothing, and Send is right there to say it to the team
    // instead.
    (document.getElementById("ask") as HTMLButtonElement).onclick = () => {
      // Arming with an empty field is fine and probably the common order:
      // read the wall, press Answer, then type.
      if (!armed && !askReady()) return;
      armed = !armed;
      paintComposer();
      input.focus();
    };
    paintComposer();
  }
  paint();
}

/** Dress the composer for the mode it is in. Only labels, ink and the
 * placeholder change — every control keeps its place and its size, and the
 * input is never rebuilt, so what is typed and where the caret sits both
 * survive arming and standing down. */
function paintComposer() {
  const form = document.getElementById("composer") as HTMLFormElement | null;
  if (!form) return;
  const ask = document.getElementById("ask") as HTMLButtonElement;
  const send = document.getElementById("send") as HTMLButtonElement;
  const input = document.getElementById("text") as HTMLInputElement;

  form.classList.toggle("armed", armed);
  ask.innerHTML = armed
    ? `${X_SVG}<span>Cancel</span>`
    : `${KEY_SVG}<span>Answer</span>`;
  ask.setAttribute(
    "aria-label",
    armed ? "Cancel, and go back to chat" : "Submit an answer to the proctor",
  );
  send.innerHTML = armed ? `${KEY_SVG}<span>Submit</span>` : "<span>Send</span>";
  input.placeholder = armed ? "Type your answer" : "Message team";
  paintAsk();
}

function paint() {
  const log = document.getElementById("log") as HTMLOListElement;
  // Stay pinned to the bottom only if we were already there — someone scrolled
  // up reading history should not be yanked away by a new message.
  const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 40;

  if (messages.length === 0 && answers.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No messages yet - say hi.";
    log.replaceChildren(empty);
  } else {
    // Rebuilt, not appended: the log holds no state, and the composer is
    // outside it. Two lists, one log: merged on the server's clock, which is
    // the only one both were stamped by.
    const rows = [
      ...messages.map((m) => ({ at: m.at, el: () => line(m) })),
      ...answers.map((a) => ({ at: a.at, el: () => answerLine(a) })),
    ].sort((p, q) => p.at - q.at);
    log.replaceChildren(...rows.map((r) => r.el()));
  }

  (document.getElementById("team") as HTMLElement).textContent = teamName(
    room as string,
  );
  const here = players.filter((p) => p.connected);
  (document.getElementById("who") as HTMLElement).textContent = connected
    ? `${here.length} here: ${here.map((p) => p.name).join(", ")}`
    : everConnected
      ? "Reconnecting..."
      : "Connecting...";

  if (pinned) log.scrollTop = log.scrollHeight;
}

function line(m: ChatMessage): HTMLLIElement {
  const li = document.createElement("li");
  // The proctor first: its socket carries a pid of its own (PROCTOR_PID), and
  // that — never the name — is what dresses a line as the proctor's. A phone
  // may call itself Proctor and still gets an ordinary bubble.
  const fromProctor = m.pid === PROCTOR_PID;
  li.className = fromProctor
    ? "line proctor"
    : m.pid === pid
      ? "line mine"
      : "line";

  const who = document.createElement("span");
  who.className = "who";
  who.textContent = m.name;

  const body = document.createElement("span");
  body.className = "body";
  // textContent, never innerHTML: the one arbitrary player-authored string in
  // the repo.
  body.textContent = m.text;

  const at = document.createElement("time");
  at.className = "at";
  at.dateTime = new Date(m.at).toISOString();
  at.textContent = new Date(m.at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  li.append(who, body, at);
  return li;
}

/** A submission in the log. Same bubble geometry as a said line — it is the
 * same conversation — wearing the answer's own colour, and carrying the two
 * receipts instead of a verdict. */
function answerLine(a: AnswerSubmission): HTMLLIElement {
  const li = document.createElement("li");
  const mine = a.pid === pid;
  li.className = mine ? "line mine answer" : "line answer";

  const tag = document.createElement("span");
  tag.className = "tag";
  // The key, then who: on your own phone the name would be noise.
  tag.innerHTML = KEY_SVG;
  const label = document.createElement("span");
  label.textContent = mine ? "Answer submitted" : `${a.name} submitted`;
  tag.append(label);

  const body = document.createElement("span");
  body.className = "body";
  body.textContent = a.text;

  // No status line: nothing in this app will ever answer, so the receipt is
  // that it left the phone and nothing more. "Waiting for the proctor" would
  // promise a press that is not coming.
  const at = document.createElement("time");
  at.className = "at";
  at.dateTime = new Date(a.at).toISOString();
  at.textContent = new Date(a.at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  li.append(tag, body, at);
  return li;
}

function render() {
  if (!myName()) {
    shell = false;
    nameScreen();
    return;
  }
  if (!room) {
    shell = false;
    waitingScreen();
    return;
  }
  chatScreen();
}

function boot() {
  if (!myName()) {
    render();
    return;
  }
  watchTeam();
  render();
}

boot();
