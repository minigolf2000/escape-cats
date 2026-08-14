import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import {
  GoombaSim,
  type GoombaPersistedV1,
  type GoombaClientMsg,
  type GoombaServerMsg,
} from "@escape-cats/shared";
import { Roster } from "./connections";

// The Goomba Rider room: transport only, like hex.ts — every game rule lives in
// the shared GoombaSim. Roomed by team id, exactly as the hex room and the chat
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

  async onStart() {
    const saved = await this.ctx.storage.get<GoombaPersistedV1>("goomba");
    if (saved?.v === 1) this.sim.restore(saved, Date.now());
  }

  onConnect(conn: Connection, ctx: ConnectionContext) {
    this.roster.register(conn, ctx);
    this.armRunTimer();
    this.broadcastState();
  }

  onClose(conn: Connection) {
    this.roster.disconnect(conn);
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
        if (!proctor && me) this.sim.place(me.pid, this.roster.slot(me.pid), msg, now);
        break;
      case "remove":
        if (!proctor) this.sim.remove(msg.index, now);
        break;
      case "clear":
        if (!proctor) this.sim.clear(now);
        break;
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
        if (!proctor) this.sim.next(now);
        break;
      case "reset":
        if (!proctor) return;
        this.sim.reset(now);
        this.roster.reset();
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

  private persist() {
    return this.ctx.storage.put("goomba", this.sim.persisted(Date.now()));
  }

  private broadcastState() {
    const state = this.sim.snapshot(Date.now(), this.roster.list());
    const msg: GoombaServerMsg = { type: "state", state };
    this.broadcast(JSON.stringify(msg));
  }
}
