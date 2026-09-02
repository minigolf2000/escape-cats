import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import {
  PACK_MAX,
  TEAMS,
  TEAM_IDS,
  decodeLevel,
  isAdhocRoom,
  type AdhocRoom,
  type LevelPack,
  type LobbyClientMsg,
  type LobbyPlayer,
  type LobbyServerMsg,
} from "@escape-cats/shared";
import { Roster } from "./connections";

/** An ad-hoc room unopened this long drops off the proctor's list. The ROOM
 * itself is untouched. */
const ADHOC_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard cap, newest kept — a registry fed by anyone with a URL bar needs a
 * ceiling independent of the TTL. */
const ADHOC_MAX = 60;
/** Skip the storage rewrite for an announce this fresh: four phones opening
 * one link is four announces in a second. */
const ADHOC_SEEN_MS = 60_000;

/**
 * The team lobby: one room ("main") for the whole event. Written through on
 * EVERY change — losing this costs every team its identity mid-event, and
 * assignments change a handful of times. Players are remembered by pid after
 * they disconnect, so a locked phone comes back to the same team.
 */
export class LobbyServer extends Server<Env> {
  // Hibernate: every landing page holds a socket to this one object. Identity
  // is persisted; connected-ness is derived from the live sockets.
  static options = { hibernate: true };

  private roster = new Roster(() => this.getConnections());
  /** pid -> team id. Persisted. */
  private teams = new Map<string, string>();
  /** pid -> display name, kept for players who are currently offline. */
  private names = new Map<string, string>();
  /** The event's level pack, as links — the ONLY copy anywhere. No built-in
   * list: an unseeded event has no levels. */
  private pack: LevelPack = [];
  /** Bumped on every write, so a game room can tell "same pack" from "new
   * pack" without comparing geometry. */
  private packV = 0;
  /** Ad-hoc room registry: room id -> when a phone last joined. Persisted,
   * pruned, proctor-only. Nothing can list Durable Objects, so the ROOM
   * announces itself on its pack fetch (`onRequest`). */
  private adhoc = new Map<string, number>();

  async onStart() {
    const teams =
      await this.ctx.storage.get<Record<string, string>>("teams");
    if (teams) this.teams = new Map(Object.entries(teams));
    const names =
      await this.ctx.storage.get<Record<string, string>>("names");
    if (names) this.names = new Map(Object.entries(names));
    const pack = await this.ctx.storage.get<LevelPack>("pack");
    if (Array.isArray(pack)) this.pack = pack;
    this.packV = (await this.ctx.storage.get<number>("packV")) ?? 0;
    const adhoc = await this.ctx.storage.get<Record<string, number>>("adhoc");
    if (adhoc) this.adhoc = new Map(Object.entries(adhoc));
  }

  /** The internal door the GOOMBA rooms read the pack through, object-to-
   * object: a room cannot take a phone's word for the geometry it scores.
   * Unauthenticated because `routePartykitRequest` never routes here. */
  async onRequest(request: Request): Promise<Response> {
    // `?room=` is a goomba room announcing itself — the registry's only
    // source. Rides this fetch so an announce cannot drift from "a phone is
    // in there".
    const room = new URL(request.url).searchParams.get("room");
    if (room) await this.sawRoom(room);
    if (request.method === "POST") {
      // A pack edit forwarded by a game room (goomba.ts): same validation as
      // the socket path.
      const msg = (await request.json().catch(() => null)) as LobbyClientMsg | null;
      if (msg) await this.packIntent(msg);
    }
    return Response.json({ v: this.packV, pack: this.pack });
  }

  /** Record that a phone joined `room`. Team rooms and t0 are ignored — the
   * board already draws them. */
  private async sawRoom(room: string) {
    if (!isAdhocRoom(room)) return;
    const now = Date.now();
    const seen = this.adhoc.get(room);
    if (seen !== undefined && now - seen < ADHOC_SEEN_MS) return;
    this.adhoc.set(room, now);
    await this.writeAdhoc();
    this.broadcastState();
  }

  /** Prune to the TTL and the cap on every write — there is no alarm here. */
  private async writeAdhoc() {
    const now = Date.now();
    const kept = [...this.adhoc]
      .filter(([, seen]) => now - seen < ADHOC_TTL_MS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, ADHOC_MAX);
    this.adhoc = new Map(kept);
    await this.ctx.storage.put("adhoc", Object.fromEntries(kept));
  }

  /** The registry as the proctor reads it — newest first. */
  private adhocList(): AdhocRoom[] {
    return [...this.adhoc]
      .sort((a, b) => b[1] - a[1])
      .map(([id, seenAt]) => ({ id, seenAt }));
  }

  onConnect(conn: Connection, ctx: ConnectionContext) {
    const meta = this.roster.register(conn, ctx);
    if (this.isPlayerDevice(meta.role, ctx)) {
      // Don't let a reconnect with the default name overwrite a name the
      // player already gave us.
      if (meta.name !== "Cat" || !this.names.has(meta.pid)) {
        this.names.set(meta.pid, meta.name);
      }
      void this.persist();
    }
    this.broadcastState();
  }

  /** Only a genuine player device is persisted: anything without a pid (a
   * curious tab, a health check) would leave a phantom "Cat" to sort, once
   * per visit. A real device sends a pid and claims no role. */
  private isPlayerDevice(
    role: string,
    ctx: ConnectionContext,
  ): boolean {
    if (role !== "player") return false;
    const params = new URL(ctx.request.url).searchParams;
    return params.get("pid") !== null && params.get("role") === null;
  }

  onClose(conn: Connection) {
    this.roster.disconnect(conn);
    this.broadcastState();
  }

  async onMessage(sender: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    let msg: LobbyClientMsg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const proctor = this.roster.isProctor(sender);
    const me = this.roster.get(sender);

    switch (msg.type) {
      case "rename": {
        if (!me || me.role !== "player") return;
        const name = String(msg.name).slice(0, 24).trim();
        if (!name) return;
        this.roster.rename(sender, name);
        this.names.set(me.pid, name);
        break;
      }
      case "assign": {
        if (!proctor) return;
        const team = msg.team === null ? null : String(msg.team);
        // Only TEAMS ids: an unknown one strands the player in a room no game
        // serves.
        if (team !== null && !TEAM_IDS.includes(team)) return;
        const pid = String(msg.pid);
        if (!this.names.has(pid)) return;
        if (team === null) this.teams.delete(pid);
        else this.teams.set(pid, team);
        break;
      }
      case "clearTeam": {
        if (!proctor) return;
        // Same gate as `assign`, so "which strings name a team" lives in one
        // place.
        const team = String(msg.team);
        if (!TEAM_IDS.includes(team)) return;
        for (const [pid, t] of [...this.teams]) {
          if (t === team) this.teams.delete(pid);
        }
        break;
      }
      case "forgetRoom": {
        if (!proctor) return;
        // The list, not the room: its Durable Object keeps its progress, and
        // the next phone through the link puts it back.
        this.adhoc.delete(String(msg.room));
        await this.writeAdhoc();
        this.broadcastState();
        return;
      }
      case "forget": {
        if (!proctor) return;
        // "Drop the row", not a ban: a connected phone re-registers on
        // reconnect.
        const pid = String(msg.pid);
        this.names.delete(pid);
        this.teams.delete(pid);
        break;
      }

      // ---- the level pack. Any phone, no proctor gate (README: the selector
      // is the editor).
      case "packSet":
      case "packMove":
      case "packDelete":
      case "packAll":
        return void (await this.packIntent(msg));
    }

    await this.persist();
    this.broadcastState();
  }

  /** Apply one pack edit; returns whether the pack changed. Validate by
   * DECODING, not shape: a link that does not parse would otherwise be
   * silently dropped by four phones — refuse it here, where the pack is owned. */
  private async packIntent(msg: LobbyClientMsg): Promise<boolean> {
    const before = this.pack;
    switch (msg.type) {
      case "packSet": {
        const hash = String(msg.hash ?? "");
        if (!decodeLevel(hash)) return false;
        const i = msg.index;
        if (i === null || i === undefined) {
          if (this.pack.length >= PACK_MAX) return false;
          this.pack = [...this.pack, hash];
        } else {
          if (!Number.isInteger(i) || i < 0 || i >= this.pack.length) return false;
          this.pack = this.pack.map((h, k) => (k === i ? hash : h));
        }
        break;
      }
      case "packMove": {
        const { from, to } = msg;
        if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
        if (from < 0 || from >= this.pack.length) return false;
        if (to < 0 || to >= this.pack.length || to === from) return false;
        const next = [...this.pack];
        next.splice(to, 0, ...next.splice(from, 1));
        this.pack = next;
        break;
      }
      case "packDelete": {
        const i = msg.index;
        if (!Number.isInteger(i) || i < 0 || i >= this.pack.length) return false;
        this.pack = this.pack.filter((_, k) => k !== i);
        break;
      }
      case "packAll": {
        if (!Array.isArray(msg.pack)) return false;
        this.pack = msg.pack
          .slice(0, PACK_MAX)
          .filter((h) => typeof h === "string" && decodeLevel(h));
        break;
      }
      default:
        return false;
    }
    if (before === this.pack) return false;
    await this.writePack();
    return true;
  }

  /** Persist, tell every phone, and poke every game ROOM: a team mid-level
   * holds its own copy for scoring and must hear the change without a
   * reconnect. No subscription — TEAM_IDS is a constant, so poke all four; the
   * fetch wakes a hibernating room. */
  private async writePack() {
    this.packV++;
    await this.ctx.storage.put("pack", this.pack);
    await this.ctx.storage.put("packV", this.packV);
    this.broadcastState();
    await Promise.all(
      TEAM_IDS.map((id) =>
        this.env.Goomba.get(this.env.Goomba.idFromName(id))
          .fetch("http://room/pack-changed", { method: "POST" })
          // A room that will not wake re-reads the pack on its next connect.
          .catch(() => undefined),
      ),
    );
  }

  private connectedPids(): Set<string> {
    return new Set(
      this.roster
        .list()
        .filter((p) => p.connected)
        .map((p) => p.id),
    );
  }

  private snapshot(forProctor: boolean): LobbyServerMsg {
    const live = this.connectedPids();
    const players: LobbyPlayer[] = [...this.names.entries()].map(
      ([pid, name]) => ({
        pid,
        name,
        team: this.teams.get(pid) ?? null,
        connected: live.has(pid),
      }),
    );
    return {
      type: "lobby",
      snapshot: {
        players,
        teams: TEAMS,
        pack: this.pack,
        packV: this.packV,
        // The one field that differs by audience — see LobbySnapshot.adhoc.
        adhoc: forProctor ? this.adhocList() : [],
      },
    };
  }

  /** Two payloads: the proctor's carries the ad-hoc list, a player's does
   * not, so this cannot use `this.broadcast`. */
  private broadcastState() {
    const forPlayers = JSON.stringify(this.snapshot(false));
    let forProctors: string | null = null;
    for (const conn of this.getConnections()) {
      if (this.roster.isProctor(conn)) {
        forProctors ??= JSON.stringify(this.snapshot(true));
        conn.send(forProctors);
      } else {
        conn.send(forPlayers);
      }
    }
  }

  private async persist() {
    await this.ctx.storage.put(
      "teams",
      Object.fromEntries(this.teams.entries()),
    );
    await this.ctx.storage.put(
      "names",
      Object.fromEntries(this.names.entries()),
    );
  }
}
