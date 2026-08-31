// Per-team chat, served at /chat/ on the lobby's origin.
//
// This surface asks the LOBBY which team this phone is on and uses that as its
// room, exactly as the game client does — so there is no team picker here, no
// `?room=` override, and no way to end up in someone else's channel.

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

// The same keys the lobby and the game use. localStorage is per-ORIGIN, so this
// only lines up while chat is served alongside them (see the README's origin
// constraint) — which is exactly why /chat is a path on the lobby's origin
// rather than a surface behind its own domain.
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
/** Whether the chat shell is already in the DOM. The shell is built ONCE and
 * then repainted, because rebuilding it would throw away whatever the player
 * has half-typed every time someone else joins or speaks. */
let shell = false;
/** Lines typed before the socket was open, flushed when it opens.
 *
 * partysocket connects asynchronously, so the composer is on screen and usable
 * a moment before there is anything to send down — and a phone on venue wifi
 * drops mid-conversation. Dropping what someone already typed and watched
 * disappear is the worst of the options; the hex client queues taps that beat
 * its socket for the same reason. Bounded by CHAT_BURST because that is all the
 * server would accept in one flush anyway. */
let outbox: string[] = [];

function myName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

function teamName(id: string): string {
  // Falls back to the raw id, though the only ids that reach here are a real
  // team's (the lobby validates every assignment against TEAMS) or the testing
  // room's, which is not one of them by design.
  if (id === OPEN_TEAM.id) return OPEN_TEAM.name;
  return TEAMS.find((t) => t.id === id)?.name ?? id;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/**
 * Watch the lobby for this phone's room, then open that channel.
 *
 * Which room comes from `roomFor`, the same rule both games use: a sorted
 * phone gets its team's channel, an unsorted one gets the shared testing
 * room's (or none, and the waiting screen, when that room is closed).
 *
 * Connecting also REGISTERS the phone in the lobby roster (the same pid+name
 * contract the landing page and the game use), so a player who opens chat
 * before being sorted shows up on the proctor's list. In a real team the
 * socket closes; in the testing room it stays open, so a tester the proctor
 * later sorts is reloaded into their team's channel rather than left talking
 * to the testers.
 */
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
        // A reconnect replays the room's history, so REPLACE rather than
        // append — otherwise a phone that drops twice shows everything twice.
        messages = msg.messages;
        players = msg.players;
        break;
      case "said":
        // Dedupe on id: our own lines come back through the same fan-out, and
        // a reconnect can race one we already have in history.
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

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

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
      // No optimistic echo. The server decides ordering, truncation and
      // whether the line was accepted at all, so the only honest moment to
      // show it is when it comes back.
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
    // Rebuilt rather than appended: the log holds no state of its own, and 200
    // capped lines is nothing to re-create. The composer is outside it, so
    // nothing the player is typing is in scope here.
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
  // textContent, never innerHTML. This is the one string on any surface in the
  // repo that is arbitrary player-authored text, so it never goes near an HTML
  // parser — not even escaped.
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
