import PartySocket from "partysocket";
import {
  TEAM_SIZE,
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
/** Whether the name chip is currently an input rather than a chip, and what is
 * half-typed in it. Both live up here because a lobby broadcast rebuilds this
 * whole page — and the proctor is dragging names between boxes the entire time
 * somebody is renaming themselves, so a draft held only in the DOM is a draft
 * that disappears when a stranger gets sorted. */
let renaming = false;
let draft = "";

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

// ---------------------------------------------------------------------------
// The room — the four teams as the proctor currently has them
// ---------------------------------------------------------------------------

/** Ear width on a board box, in px. Small: four of these sit two-up on a phone
 * under whichever card owns the screen, and they are here to be recognised
 * against the headbands on the table, not admired. */
const BOARD_EAR_W = 48;
/** Matches .tbox's border-width in styles.css, so the ear's base and the box's
 * border meet without a step. */
const BOARD_BORDER = 2;

/**
 * The four teams, drawn for a PLAYER: the proctor's board with the drag, the
 * buttons, the game readouts and the chat taken out of it.
 *
 * Read-only on purpose — sorting is the proctor's job and `assign` is
 * proctor-only on the wire, so nothing in here is tappable and nothing in here
 * sets a cursor. It exists because the lobby already knows all of this: every
 * phone's snapshot carries the whole roster (see LobbySnapshot.players), so
 * showing the room costs one render and no protocol at all.
 */
function roomHtml(myTeam: string | null): string {
  // Before the first snapshot there are no teams to draw and no room to
  // describe. The caller's card is the whole page until one arrives.
  if (teams.length === 0) return "";

  const byTeam = new Map<string, LobbyPlayer[]>(teams.map((t) => [t.id, []]));
  for (const p of players) byTeam.get(p.team ?? "")?.push(p);

  const boxes = teams
    .map((t) => {
      const members = byTeam.get(t.id) ?? [];
      // Non-null for the same reason as the card above: `teams` is TEAMS off
      // the snapshot, and all four have a pair.
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
      // Four seats, always drawn, so a half-full team reads as unfinished
      // rather than just short — and so a box does not change height while the
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

  // No heading and no counts over it. The four boxes say which teams there are,
  // how full each one is and where you are, and a label saying "the room" over
  // a picture of the room is the kind of chrome this screen is now without.
  return `<div class="board" style="--ear-h:${earsHeight(BOARD_EAR_W)}px">${boxes}</div>`;
}

// ---------------------------------------------------------------------------
// The name, changeable from anywhere
// ---------------------------------------------------------------------------

/**
 * The name chip, and the input it becomes.
 *
 * This is the ONLY thing on the page that used to be a "Not Kelly?" link, and
 * the link did something quite different: it deleted the stored name, which
 * threw the phone back to the blank first-run screen. Renaming is not
 * starting over — you keep your team, you keep your place, you are just called
 * something else — so it happens in place, on whichever screen you are on, and
 * `rename` is a wire intent the lobby has always accepted from any player.
 */
function nameChipHtml(): string {
  if (renaming) {
    return `
      <div class="rename">
        <input id="newname" maxlength="24" value="${escapeHtml(draft)}"
               placeholder="Your name" autocomplete="off" />
        <button id="savename" class="chip-go">Save</button>
        <button id="cancelname" class="link">Cancel</button>
      </div>`;
  }
  return `
    <button id="namechip" class="namechip">
      🐾 <span class="chip-name">${escapeHtml(myName())}</span>
      <span class="pen">edit</span>
    </button>`;
}

function wireNameChip() {
  const chip = document.getElementById("namechip") as HTMLButtonElement | null;
  if (chip) {
    chip.onclick = () => {
      draft = myName();
      renaming = true;
      render();
    };
    return;
  }
  const input = document.getElementById("newname") as HTMLInputElement | null;
  const save = document.getElementById("savename") as HTMLButtonElement | null;
  const cancel = document.getElementById("cancelname") as HTMLButtonElement | null;
  if (!input || !save || !cancel) return;
  // The draft lives in module state, not in the DOM — see `renaming`. Every
  // keystroke writes it back so the next lobby broadcast redraws the input
  // with what is actually in it.
  input.oninput = () => {
    draft = input.value;
  };
  const submit = () => {
    const name = draft.trim();
    if (!name) return;
    localStorage.setItem(NAME_KEY, name);
    socket?.send(JSON.stringify({ type: "rename", name }));
    renaming = false;
    render();
  };
  save.onclick = submit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") {
      renaming = false;
      render();
    }
  };
  cancel.onclick = () => {
    renaming = false;
    render();
  };
  // Focus once, on the render that opened the editor — not on the re-renders a
  // broadcast causes underneath it, which would steal the caret back to the end
  // mid-word.
  if (document.activeElement !== input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

/** The card, if this state has one, then the room, then the name chip. One
 * function so the two states cannot drift into two different page shapes. */
function page(cardHtml: string, myTeam: string | null) {
  app.innerHTML =
    cardHtml + roomHtml(myTeam) + `<div class="chiprow">${nameChipHtml()}</div>`;
  wireNameChip();
}

/**
 * The one thing an unsorted phone needs told, and now the only chrome on this
 * page: one line over the board.
 *
 * It used to be a whole card — a title, a greeting, a spinner. Every part of it
 * was already on screen somewhere better. The TITLE said the name of the app to
 * somebody who just typed their name into it. The GREETING ("Hi dog - you're
 * in") named you, which the chip under the board does, editably. And the SPINNER
 * promised the page was live, which the board itself does far better and more
 * honestly: names appear in boxes as the proctor sorts people, and a spinner
 * keeps spinning after the socket has dropped (it has no idea).
 */
function waitingLine(): string {
  return `<p class="await">Waiting for the proctor to put you on a team\u2026</p>`;
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
  // ON A TEAM, THE BOARD IS THE WHOLE SCREEN. There is no "you're on Team 3"
  // card any more: your box is the one wearing your colour, lifted, with your
  // name in it under a `you` pill — which is the same fact, drawn once, in the
  // place that also answers where everybody else went. Unsorted, the card above
  // the board says what you are waiting for, because nothing on the board can:
  // an unsorted phone appears in none of the four boxes.
  const mine = me();
  page(mine?.team ? "" : waitingLine(), mine?.team ?? null);
}

render();
