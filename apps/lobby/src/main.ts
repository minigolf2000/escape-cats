import PartySocket from "partysocket";
import type {
  LobbyPlayer,
  LobbyServerMsg,
  Team,
} from "@escape-cats/shared";
import "./styles.css";

const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";
const HEX_URL = import.meta.env.VITE_HEX_URL ?? "http://localhost:5173";
const GOOMBA_URL = import.meta.env.VITE_GOOMBA_URL ?? "http://localhost:5178";

const PID_KEY = "escape-cats-pid";
const NAME_KEY = "escape-cats-name";

/** Same key the games use, so a player sorted here is the same player there —
 * which only holds while the lobby and the games share an origin. */
function playerId(): string {
  let pid = localStorage.getItem(PID_KEY);
  if (!pid) {
    pid = crypto.randomUUID();
    localStorage.setItem(PID_KEY, pid);
  }
  return pid;
}

const pid = playerId();
const app = document.getElementById("app") as HTMLDivElement;

let socket: PartySocket | null = null;
let players: LobbyPlayer[] = [];
let teams: Team[] = [];
let connected = false;

function myName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

function me(): LobbyPlayer | undefined {
  return players.find((p) => p.pid === pid);
}

function connect() {
  socket = new PartySocket({
    host: PARTYKIT_HOST,
    room: "main",
    party: "lobby",
    query: { pid, name: myName() || "Cat" },
  });
  socket.addEventListener("open", () => {
    connected = true;
    render();
  });
  socket.addEventListener("close", () => {
    connected = false;
    render();
  });
  socket.addEventListener("message", (ev) => {
    let msg: LobbyServerMsg;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (msg.type === "lobby") {
      players = msg.snapshot.players;
      teams = msg.snapshot.teams;
      render();
    }
  });
}

function nameScreen() {
  app.innerHTML = `
    <div class="card">
      <h1>🐾 Escape Cats</h1>
      <p class="sub">What should we call you?</p>
      <input id="name" maxlength="24" placeholder="Your name" autocomplete="off" />
      <button id="go" class="primary">Join</button>
    </div>
  `;
  const input = document.getElementById("name") as HTMLInputElement;
  const go = document.getElementById("go") as HTMLButtonElement;
  input.focus();
  const submit = () => {
    const name = input.value.trim();
    if (!name) return;
    localStorage.setItem(NAME_KEY, name);
    if (socket) socket.send(JSON.stringify({ type: "rename", name }));
    else connect();
    render();
  };
  go.onclick = submit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") submit();
  };
}

function teamName(id: string): string {
  return teams.find((t) => t.id === id)?.name ?? id;
}

function waitingScreen() {
  const roster = players.filter((p) => p.connected);
  app.innerHTML = `
    <div class="card">
      <h1>🐾 Escape Cats</h1>
      <p class="sub">Hi ${escapeHtml(myName())} - you're in.</p>
      <div class="waiting">
        <span class="spinner"></span>
        Waiting for the proctor to put you on a team...
      </div>
      <p class="muted">${roster.length} ${roster.length === 1 ? "person" : "people"} here</p>
      <button id="rename" class="link">Not ${escapeHtml(myName())}?</button>
    </div>
  `;
  (document.getElementById("rename") as HTMLButtonElement).onclick = () => {
    localStorage.removeItem(NAME_KEY);
    render();
  };
}

function teamScreen(team: string) {
  const mates = players.filter((p) => p.team === team);
  app.innerHTML = `
    <div class="card">
      <p class="sub">You're on</p>
      <h1 class="team">${escapeHtml(teamName(team))}</h1>
      <p class="muted">with ${mates
        .filter((p) => p.pid !== pid)
        .map((p) => escapeHtml(p.name))
        .join(", ") || "- just you so far"}</p>
      <a class="primary" href="${HEX_URL}/">Play Hex Clicker</a>
      <a class="primary" href="${GOOMBA_URL}/">Play Goomba Rider</a>
      <!-- Neither link carries the team. Both surfaces ask the lobby for this
           phone's pid, so a proctor re-sort takes effect on reload instead of
           being pinned by a stale URL, and there is no link anyone can edit to
           walk into another team's room. The game may be reached through a
           vanity domain, but those REDIRECT onto this origin (see the README's
           origin constraint), so the pid the proctor sorted is the pid the game
           sees. -->
      <a class="secondary" href="/chat/">Team chat</a>
      <button id="rename" class="link">Not ${escapeHtml(myName())}?</button>
    </div>
  `;
  (document.getElementById("rename") as HTMLButtonElement).onclick = () => {
    localStorage.removeItem(NAME_KEY);
    render();
  };
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function render() {
  if (!myName()) {
    nameScreen();
    return;
  }
  if (!socket) {
    connect();
  }
  if (!connected && players.length === 0) {
    app.innerHTML = `
      <div class="card">
        <h1>🐾 Escape Cats</h1>
        <div class="waiting"><span class="spinner"></span> Connecting...</div>
      </div>
    `;
    return;
  }
  const mine = me();
  if (mine?.team) teamScreen(mine.team);
  else waitingScreen();
}

render();
