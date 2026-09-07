import PartySocket from "partysocket";
import {
  CHIP,
  TEAM_SIZE,
  WAITING_LINE,
  cleanName,
  clampName,
  earsFor,
  nameChipHtml,
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
/** Rename state lives up here because a lobby broadcast rebuilds the whole
 * page, and a draft held only in the DOM disappears when a stranger gets
 * sorted. */
let renaming = false;
let draft = "";

/** Cleaned on the way out, not just on the way in: the cap moved from 24 to
 * 12, so a phone can be carrying a name the server would no longer store. */
function myName(): string {
  return cleanName(localStorage.getItem(NAME_KEY));
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
      <input id="name" placeholder="Your name" autocomplete="off" />
      <button id="go" class="primary">Join</button>
    </div>
  `;
  const input = document.getElementById("name") as HTMLInputElement;
  const go = document.getElementById("go") as HTMLButtonElement;
  input.focus();
  input.oninput = () => clampName(input);
  const submit = () => {
    if (!commitName(input.value)) return;
    render();
  };
  go.onclick = submit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") submit();
  };
}

// ---- The room: the four teams as the proctor has them ----

/** Ear width on a board box, px — four of these sit two-up on a phone. */
const BOARD_EAR_W = 48;
/** Matches .tbox's border-width in styles.css, so the ear's base and the box's
 * border meet without a step. */
const BOARD_BORDER = 2;

/** The four teams, drawn for a PLAYER: the proctor's board without the drag,
 * buttons, readouts or chat. Read-only: `assign` is proctor-only, so nothing
 * here is tappable or sets a cursor. Every phone's snapshot already carries
 * the whole roster. */
function roomHtml(myTeam: string | null): string {
  // Before the first snapshot there is no room to draw.
  if (teams.length === 0) return "";

  const byTeam = new Map<string, LobbyPlayer[]>(teams.map((t) => [t.id, []]));
  for (const p of players) byTeam.get(p.team ?? "")?.push(p);

  const boxes = teams
    .map((t) => {
      const members = byTeam.get(t.id) ?? [];
      // `teams` is TEAMS off the snapshot; all four have a pair.
      const ears = earsFor(t.id)!;
      const mine = t.id === myTeam;
      const seats = members
        .map(
          (p) =>
            `<li${p.pid === pid ? ` class="me"` : ``}><span class="pname">${escapeHtml(
              p.name,
            )}</span>${p.pid === pid ? `<span class="youpill">you</span>` : ``}</li>`,
        )
        .join("");
      // Four seats always drawn, so a box does not change height while the
      // proctor is dragging somebody into it.
      const empty = Array.from(
        { length: Math.max(0, TEAM_SIZE - members.length) },
        () => `<li class="slot">empty seat</li>`,
      ).join("");
      return `
        <div class="tbox${mine ? " mine" : ""}" style="--tc:${ears.ink}">
          ${teamEarsSvg(t.id, {
            width: BOARD_EAR_W,
            strokeWidth: BOARD_BORDER,
            inset: 8,
            // Resting background only — .tbox.mine sets --ear-fill so your own
            // box carries its ears with it.
            panel: "#12141b",
          })}
          <div class="tbox-head">
            <strong>${escapeHtml(t.name)}</strong>
            <span class="muted">${members.length}/${TEAM_SIZE}</span>
          </div>
          <ul class="seats">${seats}${empty}</ul>
        </div>`;
    })
    .join("");

  // No heading over the board: the boxes say which teams there are and where
  // you are.
  return `<div class="board" style="--ear-h:${earsHeight(BOARD_EAR_W)}px">${boxes}</div>`;
}

// ---- The name, changeable from anywhere ----

/** Store a name and tell the lobby. Renaming is not starting over — you keep
 * your team and your place — so `rename` is a wire intent, not a rejoin.
 * Returns false for a name that is not one. */
function commitName(raw: string): boolean {
  const name = cleanName(raw);
  if (!name) return false;
  localStorage.setItem(NAME_KEY, name);
  if (socket) socket.send(JSON.stringify({ type: "rename", name }));
  else connect();
  return true;
}

function wireNameChip() {
  const chip = document.getElementById(CHIP.open);
  if (chip) {
    chip.onclick = () => {
      draft = myName();
      renaming = true;
      render();
    };
    return;
  }
  const input = document.getElementById(CHIP.input) as HTMLInputElement | null;
  const save = document.getElementById(CHIP.save);
  const cancel = document.getElementById(CHIP.cancel);
  if (!input || !save || !cancel) return;
  // The draft lives in module state — see `renaming` — so a broadcast redraws
  // the input with what is in it.
  input.oninput = () => {
    clampName(input);
    draft = input.value;
  };
  const done = (commit: boolean) => {
    if (commit && !commitName(draft)) return;
    renaming = false;
    render();
  };
  save.onclick = () => done(true);
  cancel.onclick = () => done(false);
  input.onkeydown = (e) => {
    if (e.key === "Enter") done(true);
    if (e.key === "Escape") done(false);
  };
  // Focus once, on the render that opened the editor — not on broadcast
  // re-renders, which would steal the caret mid-word.
  if (document.activeElement !== input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

/** The card, if this state has one, then the room, then the name chip. One
 * function so the two states cannot drift into two different page shapes. */
function page(cardHtml: string, myTeam: string | null) {
  app.innerHTML =
    cardHtml +
    roomHtml(myTeam) +
    `<div class="chiprow${renaming ? " editing" : ""}">${nameChipHtml(
      myName(),
      draft,
      renaming,
    )}</div>`;
  wireNameChip();
}

/** The one thing an unsorted phone needs told: one line over the board. */
function waitingLine(): string {
  return `<p class="await">${WAITING_LINE}</p>`;
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
    // Same idiom as the waiting line: a status is a sentence, not a panel.
    app.innerHTML = `<p class="await">Connecting\u2026</p>`;
    return;
  }
  // ON A TEAM, THE BOARD IS THE WHOLE SCREEN: your box wears your colour,
  // lifted, with a `you` pill. Unsorted, the line above the board says what
  // you are waiting for — an unsorted phone appears in none of the boxes.
  const mine = me();
  page(mine?.team ? "" : waitingLine(), mine?.team ?? null);
}

render();
