import PartySocket from "partysocket";
import {
  earsFor,
  earsHeight,
  teamEarsSvg,
  type LobbyPlayer,
  type LobbyServerMsg,
  type Team,
} from "@escape-cats/shared";
import "./styles.css";

const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:1999";

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

/** Ear width on the "you're on" card, in px — the one moment this phone is
 * ABOUT the team, so the ears are the biggest they get anywhere. */
const CARD_EAR_W = 96;
/** Matches the card's border-width in styles.css: the ear's base overlaps the
 * border by exactly this, so the two outlines meet. */
const CARD_BORDER = 2;

function teamScreen(team: string) {
  const mates = players.filter((p) => p.team === team);
  // A team always has ears (see TEAM_EARS); the testing room does not, and then
  // the card is simply the card it always was.
  const ears = earsFor(team);
  const skin = ears
    ? `class="card eared" style="--tc:${ears.ink};--ear-h:${earsHeight(CARD_EAR_W)}px"`
    : `class="card"`;
  app.innerHTML = `
    <div ${skin}>
      ${teamEarsSvg(team, {
        width: CARD_EAR_W,
        strokeWidth: CARD_BORDER,
        // --panel, as a literal: the ear is filled with the card it grows out of.
        panel: "#14161d",
      })}
      <p class="sub">You're on</p>
      <h1 class="team">${escapeHtml(teamName(team))}</h1>
      <p class="muted">with ${mates
        .filter((p) => p.pid !== pid)
        .map((p) => escapeHtml(p.name))
        .join(", ") || "- just you so far"}</p>
      ${
        // The one line that turns a colour into an instruction. Without it the
        // card is a nice shade of pink and the headbands are a pile on a table.
        ears
          ? `<p class="wear">Grab the ${ears.hue.toLowerCase()} ears \u{1F43E}</p>`
          : ``
      }
      <!-- No game links. The games are reached by their own URLs (the vanity
           domains, which REDIRECT onto this origin — see the README's origin
           constraint), so the lobby's job ends at "here is your team". A link
           here never carried the team anyway: every surface asks the lobby for
           this phone's pid, which is what makes a proctor re-sort take effect
           on reload. Putting the buttons back is a one-line change; they used
           VITE_HEX_URL / VITE_GOOMBA_URL. -->
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
