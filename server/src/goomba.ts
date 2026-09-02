import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import {
  GoombaSim,
  applyPack,
  isAdhocRoom,
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

// Transport only, like hex.ts — every rule lives in the shared GoombaSim.
// Roomed by team id. NO tick loop: a run is scored synchronously when PLAY
// arrives (deterministic physics); the run's END is the one timed transition,
// covered by one timeout, with sim.resolve on every message/connect as the
// backstop across evictions. Nothing pending between intents, so it hibernates.
export class GoombaServer extends Server<Env> {
  static options = { hibernate: true };

  private roster = new Roster(() => this.getConnections());
  private sim = new GoombaSim(Date.now());
  private runTimer: ReturnType<typeof setTimeout> | null = null;
  /** pid -> the band that player is stretching. Presentation only: never
   * persisted, pruned by TTL. */
  private previews = new Map<string, GoombaBandPreview>();
  /** Version of the pack this room has applied, and the pack itself — kept so
   * the room can hand it to a phone without re-encoding the levels. -1 = never. */
  private packV = -1;
  private pack: LevelPack = [];

  async onStart() {
    // Pack FIRST: `restore` fits the room to the level list, so restoring
    // before the levels exist clamps the team to level 0 and drops every flag.
    await this.syncPack();
    const saved = await this.ctx.storage.get<GoombaPersistedV1>("goomba");
    if (saved?.v === 1) this.sim.restore(saved, Date.now());
  }

  /** Poked by the lobby's `writePack`. The fetch itself wakes a hibernating
   * room, so `onStart` picks the pack up on the way in. */
  async onRequest(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.endsWith("/pack-changed")) {
      await this.refreshPack();
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }

  /** Read the pack off the lobby and install it; returns whether it changed.
   * Object-to-object, never from a client: this room scores runs. `applyPack`
   * writes the `GOOMBA_LEVELS` array the sim reads. */
  private async syncPack(announce = false): Promise<boolean> {
    try {
      const res = await this.env.Lobby.get(this.env.Lobby.idFromName("main")).fetch(
        // `?room=` announces this room to the ad-hoc registry
        // (LobbyServer.sawRoom) — nothing can list Durable Objects. Only a
        // PLAYER's connect announces, or a watching proctor keeps it alive.
        announce
          ? `http://lobby/pack?room=${encodeURIComponent(this.name)}`
          : "http://lobby/pack",
      );
      const body = (await res.json()) as { v: number; pack: LevelPack };
      if (typeof body?.v !== "number" || !Array.isArray(body.pack)) return false;
      if (body.v === this.packV) return false;
      this.packV = body.v;
      this.pack = body.pack;
      applyPack(body.pack);
      return true;
    } catch {
      // Unreachable lobby: keep the levels as they are. No pack = no levels,
      // which the phones render as "paste one in", not an error.
      return false;
    }
  }

  onConnect(conn: Connection, ctx: ConnectionContext) {
    const meta = this.roster.register(conn, ctx);
    this.armRunTimer();
    // Pack first: a phone cannot draw a level without one.
    conn.send(JSON.stringify(this.packMsg()));
    this.broadcastState();
    // …then re-read it. `writePack` pokes only the four TEAM_IDS rooms (there
    // is no list of ad-hoc rooms), so an ad-hoc room learns of an edit HERE,
    // on the next connect. `syncPack` returns early on an unchanged version.
    void this.refreshPack(meta.role === "player");
  }

  /** Re-read the pack and, if it moved, reconcile, persist, broadcast. */
  private async refreshPack(announce = false) {
    if (!(await this.syncPack(announce))) return;
    this.sim.reconcile(Date.now());
    await this.persist();
    this.broadcastPack();
    this.broadcastState();
  }

  onClose(conn: Connection) {
    const m = this.roster.get(conn);
    if (m) this.previews.delete(m.pid); // no ghost left hanging by a dropped phone
    this.roster.disconnect(conn);
    // The roster is presentation, but every phone shows it: broadcast now.
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
          // Four bands for the ROOM, anyone may lay any (`canPlaceBand`);
          // the pid is only a note of who laid it.
          this.sim.place(me.pid, msg, now);
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
        // Pure presentation, so this case returns early: no sim mutation and
        // NO persist (drags stream at ~10Hz).
        if (proctor || !me) return;
        const { ax, ay, bx, by } = msg;
        if ([ax, ay, bx, by].every((v) => typeof v === "number" && Number.isFinite(v))) {
          this.previews.set(me.pid, {
            pid: me.pid, ax: ax!, ay: ay!, bx: bx!, by: by!, at: now,
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
        // Room-wide jump from the level selector, any player. The selector's
        // gate (all levels cleared; ?debug overrides) is presentation only, so
        // a tester can drive a real team's room; a jump never earns a
        // completed flag (sim.goto).
        if (!proctor) { this.sim.goto(msg.level, now); this.previews.clear(); }
        break;
      // Pack edits go to the LOBBY, which validates, writes, and pokes every
      // room back through `pack-changed` — one authority for the levels.
      case "packSet":
      case "packMove":
      case "packDelete":
      case "packAll":
        if (proctor) return;
        // An AD-HOC room plays the pack and cannot edit it: a link handed
        // outside the party is past the "party's own phones are the tool"
        // premise, and `⌫` on a card would delete a level for the whole event.
        if (isAdhocRoom(this.name)) return;
        void this.forwardPackIntent(msg);
        return;
      case "reset":
        if (!proctor) return;
        this.sim.reset(now);
        this.roster.reset();
        this.previews.clear();
        break;
    }
    // Write-through on every mutation: bands land at human rate, unlike hex
    // income.
    void this.persist();
    this.broadcastState();
  }

  /** One timeout so the win/fail transition lands in a silent room. Everything
   * else about run-end is lazy (sim.resolve), so an evicted room resolves on
   * its next wake. */
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

  /** Hand a pack edit to the lobby and re-read straight away, so the editing
   * phone sees it land without waiting for the fan-out. */
  private async forwardPackIntent(msg: GoombaClientMsg) {
    try {
      await this.env.Lobby.get(this.env.Lobby.idFromName("main")).fetch(
        "http://lobby/pack",
        { method: "POST", body: JSON.stringify(msg) },
      );
    } catch {
      return; // the lobby will still be there on the next try
    }
    await this.refreshPack();
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
