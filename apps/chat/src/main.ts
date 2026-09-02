// Per-team chat at /chat/ on the lobby's origin. The LOBBY says which team
// this phone is on, and that is the room — no team picker, no `?room=` override.

import PartySocket from "partysocket";
import {
  CHAT_BURST,
  CHAT_MAX_TEXT,
  OPEN_TEAM,
  TEAMS,
  roomFor,
  type ChatClientMsg,
  type ChatMessage,
  type ChatServerMsg,
  type LobbyServerMsg,
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

function myName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

function teamName(id: string): string {
  // Only a real team id or t0 reaches here (the lobby validates assignments).
  if (id === OPEN_TEAM.id) return OPEN_TEAM.name;
  return TEAMS.find((t) => t.id === id)?.name ?? id;
}

// ---- Connections ----

/** Watch the lobby for this phone's room (`roomFor`, the rule both games
 * use), then open that channel. Connecting also REGISTERS the phone in the
 * lobby roster. On a real team the lobby socket closes; in the testing room
 * it stays open, so a tester sorted later reloads into their team's channel. */
function watchTeam() {
  const lobby = new PartySocket({
    host: PARTYKIT_HOST,
    room: "main",
    party: "lobby",
    query: { pid, name: myName() },
  });
  lobby.addEventListener("message", (ev) => {
    let msg: LobbyServerMsg;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (msg.type !== "lobby") return;
    const me = msg.snapshot.players.find((p) => p.pid === pid);
    const next = roomFor(me?.team ?? null);
    if (next === null) return;
    if (room === null) {
      room = next;
      if (me?.team) lobby.close();
      connect();
      render();
      return;
    }
    if (next !== room) location.reload();
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

/** Only reached by someone who opened /chat/ directly — anyone arriving from
 * the lobby already named themselves there. */
function nameScreen() {
  app.innerHTML = `
    <div class="card">
      <h1>🐾 Team chat</h1>
      <p class="sub">What should we call you?</p>
      <input id="name" maxlength="24" placeholder="Your name" autocomplete="off" />
      <button id="go" class="primary">Join</button>
    </div>
  `;
  const input = document.getElementById("name") as HTMLInputElement;
  input.focus();
  const submit = () => {
    const name = input.value.trim();
    if (!name) return;
    localStorage.setItem(NAME_KEY, name);
    boot();
  };
  (document.getElementById("go") as HTMLButtonElement).onclick = submit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") submit();
  };
}

function waitingScreen() {
  app.innerHTML = `
    <div class="card">
      <h1>🐾 Team chat</h1>
      <p class="sub">Hi ${escapeHtml(myName())} - you're in.</p>
      <div class="waiting">
        <span class="spinner"></span>
        Waiting for the proctor to put you on a team...
      </div>
      <a class="link" href="/">Back to the lobby</a>
    </div>
  `;
}

function chatScreen() {
  if (!shell) {
    app.innerHTML = `
      <div class="chat">
        <header class="chat-head">
          <h1 id="team"></h1>
          <p class="muted" id="who"></p>
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

/** For the two card screens, which are template strings rather than nodes.
 * Message bodies do NOT come through here — see `line`. */
function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
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
