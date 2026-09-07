// Per-team chat at /chat/, and the door into the event: a phone names itself
// HERE, which registers it in the lobby roster, and then waits. No team
// picker, no `?room=`, and no fallback room — being sorted is the prereq
// (`chatRoomFor`).

import PartySocket from "partysocket";
import {
  CHAT_BURST,
  CHAT_MAX_TEXT,
  CHIP,
  TEAMS,
  WAITING_LINE,
  chatRoomFor,
  cleanName,
  clampName,
  nameChipHtml,
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

let room: string | null = null;
let socket: PartySocket | null = null;
/** The lobby socket, held only until this phone is sorted — while it is open
 * it is the one that carries a rename (see `renameTo`). */
let lobbySocket: PartySocket | null = null;
let messages: ChatMessage[] = [];
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
 * CHAT_BURST, all the server accepts in one flush. */
let outbox: string[] = [];
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
    for (const text of queued) say(text);
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
        // A reconnect replays history: REPLACE, never append.
        messages = msg.messages;
        players = msg.players;
        break;
      case "said":
        // Dedupe on id: our own lines come back through the fan-out.
        if (messages.some((m) => m.id === msg.message.id)) return;
        messages.push(msg.message);
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
  if (socket && socket.readyState === socket.OPEN) {
    const msg: ChatClientMsg = { type: "say", text };
    socket.send(JSON.stringify(msg));
    return;
  }
  if (outbox.length < CHAT_BURST) outbox.push(text);
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
          <input
            id="text"
            maxlength="${CHAT_MAX_TEXT}"
            placeholder="Message your team"
            autocomplete="off"
            enterkeyhint="send"
          />
          <button class="send" type="submit">Send</button>
        </form>
      </div>
    `;
    shell = true;
    paintName();
    const input = document.getElementById("text") as HTMLInputElement;
    (document.getElementById("composer") as HTMLFormElement).onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      say(text);
      input.value = "";
      // No optimistic echo: the server decides ordering, truncation and
      // acceptance.
      input.focus();
    };
  }
  paint();
}

function paint() {
  const log = document.getElementById("log") as HTMLOListElement;
  // Stay pinned to the bottom only if we were already there — someone scrolled
  // up reading history should not be yanked away by a new message.
  const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 40;

  if (messages.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No messages yet - say hi.";
    log.replaceChildren(empty);
  } else {
    // Rebuilt, not appended: the log holds no state, and the composer is
    // outside it.
    log.replaceChildren(...messages.map(line));
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
  li.className = m.pid === pid ? "line mine" : "line";

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
