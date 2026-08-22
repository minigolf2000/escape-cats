import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import {
  GoombaSim,
  activePlayerCount,
  applyPack,
  type LevelPack,
  type GoombaBandPreview,
  type GoombaPersistedV1,
  type GoombaClientMsg,
  type GoombaServerMsg,
} from "@escape-cats/shared";
import { Roster } from "./connections";

/** A ghost older than this is a dead drag (phone locked mid-stretch); prune
 * it rather than broadcast it forever. Client-side fade uses the same idea. */
const PREVIEW_TTL_MS = 3_000;

// The Goomba Glider room: transport only, like hex.ts — every game rule lives
// in the shared GoombaSim. Roomed by team id, exactly as the hex room and chat
// channel are, so the proctor sorting someone onto t2 is also what picks their
// Goomba room.
//
// Unlike hex there is NO tick loop: nothing in this game moves on its own.
// A run is scored synchronously the moment PLAY arrives (the physics is
// deterministic); the only time-driven transition is the run's END, ~15s out at
// most, which one short timeout covers. Lazy resolution (sim.resolve on every
// message/connect) backstops it across evictions, so the room stays cheap: no
// pending work between intents means it hibernates the moment everyone is idle.
export class GoombaServer extends Server<Env> {
  static options = { hibernate: true };

  private roster = new Roster(() => this.getConnections());
  private sim = new GoombaSim(Date.now());
  private runTimer: ReturnType<typeof setTimeout> | null = null;
  /** pid -> the band that player is stretching right now. Ephemeral
   * presentation state (hex's teammate-taps deal): never persisted, resets
   * with an eviction, pruned by TTL. */
  private previews = new Map<string, GoombaBandPreview>();
  /** Version of the pack this room has applied, and the pack itself — kept so
   * the room can hand it to a phone without re-encoding the levels. -1 = never. */
  private packV = -1;
  private pack: LevelPack = [];

  async onStart() {
    // The pack FIRST: `restore` fits the room to the level list it finds, so
    // reading storage before the levels exist would clamp the team back to
    // level 0 and drop every completed flag.
    await this.syncPack();
    const saved = await this.ctx.storage.get<GoombaPersistedV1>("goomba");
    if (saved?.v === 1) this.sim.restore(saved, Date.now());
  }

  /**
   * The lobby pokes this when someone edits the pack (see `writePack` there).
   *
   * Waking for it is the point: a team mid-session must see a pasted level
   * appear without reconnecting, and this room is the authority that scores
   * against it. A hibernating room is woken by the fetch itself, which runs
   * `onStart` and picks the pack up on the way in.
   */
  async onRequest(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.endsWith("/pack-changed")) {
      if (await this.syncPack()) {
        this.sim.reconcile(Date.now());
        await this.persist();
        this.broadcastPack();
        this.broadcastState();
      }
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }

  /**
   * Read the event's pack off the lobby and install it. Returns whether
   * anything changed.
   *
   * Object-to-object rather than trusting a client: this is the code that
   * decides whether a run won, so the geometry it scores against has to come
   * from the authority that owns it. `applyPack` writes into the same
   * `GOOMBA_LEVELS` array every rule in the shared sim already reads.
   */
  private async syncPack(): Promise<boolean> {
    try {
      const res = await this.env.Lobby.get(this.env.Lobby.idFromName("main")).fetch(
        "http://lobby/pack",
      );
      const body = (await res.json()) as { v: number; pack: LevelPack };
      if (typeof body?.v !== "number" || !Array.isArray(body.pack)) return false;
      if (body.v === this.packV) return false;
      this.packV = body.v;
      this.pack = body.pack;
      applyPack(body.pack);
      return true;
    } catch {
      // An unreachable lobby leaves the levels as they are. A room with no
      // pack yet simply has no levels, which the phones render as "nothing
      // here — paste one in", not as an error.
      return false;
    }
  }

  onConnect(conn: Connection, ctx: ConnectionContext) {
    this.roster.register(conn, ctx);
    this.armRunTimer();
    // The pack first: a phone cannot draw a level, or even know how many there
    // are, until it has one.
    conn.send(JSON.stringify(this.packMsg()));
    this.broadcastState();
  }

  onClose(conn: Connection) {
    const m = this.roster.get(conn);
    if (m) this.previews.delete(m.pid); // no ghost left hanging by a dropped phone
    this.roster.disconnect(conn);
    // Presence is now a game rule, not just a roster line: this broadcast is
    // what hands a dropped player's band share back to the room (and the one
    // in onConnect is what takes it away again).
    this.broadcastState();
  }

  onMessage(sender: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    let msg: GoombaClientMsg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const now = Date.now();
    const me = this.roster.get(sender);
    const proctor = me?.role === "proctor";
    switch (msg.type) {
      case "join":
        this.roster.rename(sender, String(msg.name).slice(0, 24));
        break;
      case "place":
        if (!proctor && me) {
          // The band quota divides MAX_BANDS by who is HERE, so the headcount
          // is read at placement time, off the live roster — not stored. A
          // teammate joining or dropping between two placements legitimately
          // changes what the next one is allowed to be.
          this.sim.place(me.pid, this.roster.slot(me.pid), msg, now, this.players());
          this.previews.delete(me.pid); // the ghost became a real band
        }
        break;
      case "remove":
        if (!proctor) this.sim.remove(msg.index, now);
        break;
      case "clear":
        if (!proctor) this.sim.clear(now);
        break;
      case "preview": {
        // A band being stretched right now — pure presentation, so this case
        // returns early: no sim mutation, and crucially NO persist (drags
        // stream at ~10Hz; writing storage per frame would be hex's
        // per-tick-write mistake all over again).
        if (proctor || !me) return;
        const { ax, ay, bx, by } = msg;
        if ([ax, ay, bx, by].every((v) => typeof v === "number" && Number.isFinite(v))) {
          this.previews.set(me.pid, {
            pid: me.pid, slot: this.roster.slot(me.pid),
            ax: ax!, ay: ay!, bx: bx!, by: by!, at: now,
          });
        } else {
          this.previews.delete(me.pid); // drag ended without a placement
        }
        this.broadcastState();
        return;
      }
      case "play":
        if (!proctor) {
          this.sim.play(now);
          this.armRunTimer();
        }
        break;
      case "stop":
        if (!proctor) this.sim.stop(now);
        break;
      case "next":
        if (!proctor) { this.sim.next(now); this.previews.clear(); }
        break;
      case "goto":
        // The level selector's room-wide jump — any player, like next/play. The
        // selector is EARNED (every level cleared; ?debug overrides that gate
        // on one phone), but the gate is presentation: honouring the intent
        // from anyone in the room is what lets a tester drive a real team's
        // room, and a jump can never earn a completed flag (see sim.goto).
        if (!proctor) { this.sim.goto(msg.level, now); this.previews.clear(); }
        break;
      // Editing the pack from inside the game. The room does not own it — it
      // hands the intent to the lobby, which validates, writes, and pokes every
      // room (including this one) back through `pack-changed`. Going the long
      // way round is what keeps one authority for the levels instead of four
      // rooms racing to write their own.
      case "packSet":
      case "packMove":
      case "packDelete":
      case "packAll":
        if (proctor) return;
        void this.forwardPackIntent(msg);
        return;
      case "reset":
        if (!proctor) return;
        this.sim.reset(now);
        this.roster.reset();
        this.previews.clear();
        break;
    }
    // Write-through on every mutation: bands land at human rate (a handful per
    // level), not per-tick like hex income, so the lobby's simpler policy fits.
    void this.persist();
    this.broadcastState();
  }

  /** One timeout so the win/fail transition lands even in a silent room —
   * phones want the "LEVEL CLEAR" state without having to send anything.
   * Everything else about run-end is lazy (sim.resolve), so a room evicted
   * mid-animation still resolves correctly on its next wake. */
  private armRunTimer() {
    const ms = this.sim.runEndsIn(Date.now());
    if (ms === null) return;
    if (this.runTimer) clearTimeout(this.runTimer);
    this.runTimer = setTimeout(() => {
      this.runTimer = null;
      if (this.sim.resolve(Date.now())) {
        void this.persist();
        this.broadcastState();
      }
    }, ms + 50);
  }

  /** Live headcount for the band quota. Proctors are spectators and the roster
   * never lists them; a phone that dropped is listed but not connected, and
   * does not hold a share it cannot spend. */
  private players() {
    return activePlayerCount(this.roster.list());
  }

  /** Hand a pack edit to the lobby and take its answer straight back, so the
   * phone that made the edit sees it land without waiting for the broadcast
   * fan-out to come back around. */
  private async forwardPackIntent(msg: GoombaClientMsg) {
    try {
      await this.env.Lobby.get(this.env.Lobby.idFromName("main")).fetch(
        "http://lobby/pack",
        { method: "POST", body: JSON.stringify(msg) },
      );
    } catch {
      return; // the lobby will still be there on the next try
    }
    if (await this.syncPack()) {
      this.sim.reconcile(Date.now());
      await this.persist();
      this.broadcastPack();
      this.broadcastState();
    }
  }

  private packMsg(): GoombaServerMsg {
    return { type: "pack", v: this.packV, pack: this.pack };
  }

  private broadcastPack() {
    this.broadcast(JSON.stringify(this.packMsg()));
  }

  private persist() {
    return this.ctx.storage.put("goomba", this.sim.persisted(Date.now()));
  }

  private broadcastState() {
    const now = Date.now();
    for (const [pid, p] of this.previews)
      if (now - p.at > PREVIEW_TTL_MS) this.previews.delete(pid);
    const state = this.sim.snapshot(now, this.roster.list(), [...this.previews.values()]);
    const msg: GoombaServerMsg = { type: "state", state };
    this.broadcast(JSON.stringify(msg));
  }
}
