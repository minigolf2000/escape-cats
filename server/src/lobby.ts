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

/** An ad-hoc room nobody has opened in this long drops off the proctor's list.
 * The ROOM itself is untouched — this is only how long the lobby keeps saying
 * "somebody is using this link". A week covers a playtest fortnight's worth of
 * weekends without the list growing forever. */
const ADHOC_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard cap on the list, newest kept. A registry fed by anyone with a URL bar
 * needs a ceiling that does not depend on the TTL doing its job. */
const ADHOC_MAX = 60;
/** Don't rewrite storage for an announce this fresh. A room announces on every
 * connect, and four phones opening one link is four announces in a second —
 * none of which tells the proctor anything the first one didn't. */
const ADHOC_SEEN_MS = 60_000;

/**
 * The team lobby. One room ("main" on this party) for the whole event.
 *
 * Unlike the game rooms, this state is written through on EVERY change. A game
 * room losing its memory costs a team its progress; the lobby losing its memory
 * costs every team its identity, mid-event, with no way to rebuild it except
 * asking forty people who they are. Assignments change a handful of times per
 * event, so writing through on every change is free.
 *
 * Players are remembered by pid even after they disconnect — a phone that
 * locks between sorting and playing must come back to the same team, not
 * reappear as a stranger.
 */
export class LobbyServer extends Server<Env> {
  // The landing page keeps a socket open on every phone that visits, and
  // there is one lobby for the whole event — without hibernation that single
  // object stays resident (billed duration) as long as anyone has the page
  // open anywhere. The identity that matters (names, teams) is already
  // persisted; connected-ness is derived from the live sockets on demand.
  static options = { hibernate: true };

  private roster = new Roster(() => this.getConnections());
  /** pid -> team id. Persisted. */
  private teams = new Map<string, string>();
  /** pid -> display name, kept for players who are currently offline. */
  private names = new Map<string, string>();
  /**
   * **The event's level pack** — the game's levels, as links, and the only
   * copy of them anywhere. There is no built-in list any more: an event that
   * has never been seeded has no levels, and the selector says so.
   */
  private pack: LevelPack = [];
  /** Bumped on every write, so a game room can tell "same pack" from "new
   * pack" without comparing geometry. */
  private packV = 0;
  /**
   * **The ad-hoc room registry**: room id -> when a phone last joined it.
   * Persisted, pruned, and shown to the proctor only.
   *
   * The lobby cannot discover these any other way — a Durable Object namespace
   * has no listing, and an ad-hoc room's players are strangers to the roster
   * the moment they stop holding a lobby socket. So the ROOM tells us, on the
   * pack fetch it already makes (see `onRequest`).
   */
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

  /**
   * The internal door the GOOMBA rooms read the pack through.
   *
   * A room server cannot take a phone's word for the geometry it is scoring
   * against, and it has no lobby socket of its own, so it fetches the pack
   * object-to-object. Read-only and unauthenticated because it is reachable
   * only from inside the Worker — `routePartykitRequest` never routes here.
   */
  async onRequest(request: Request): Promise<Response> {
    // `?room=` is a goomba room announcing itself as it reads the pack — the
    // registry's only source (see `adhoc`). It rides this fetch rather than a
    // door of its own because the room already makes it on every connect, so
    // the announce costs nothing and cannot drift out of step with "a phone is
    // actually in there".
    const room = new URL(request.url).searchParams.get("room");
    if (room) await this.sawRoom(room);
    if (request.method === "POST") {
      // A pack edit forwarded by a game room (see goomba.ts). Same validation
      // as the socket path — one implementation, two doors.
      const msg = (await request.json().catch(() => null)) as LobbyClientMsg | null;
      if (msg) await this.packIntent(msg);
    }
    return Response.json({ v: this.packV, pack: this.pack });
  }

  /**
   * Record that a phone just joined `room`, if it is one we track.
   *
   * Team rooms and the testing room are ignored: they are a fixed list the
   * proctor's board already draws, and a registry entry for them would be a
   * second, staler answer to the same question.
   */
  private async sawRoom(room: string) {
    if (!isAdhocRoom(room)) return;
    const now = Date.now();
    const seen = this.adhoc.get(room);
    if (seen !== undefined && now - seen < ADHOC_SEEN_MS) return;
    this.adhoc.set(room, now);
    await this.writeAdhoc();
    this.broadcastState();
  }

  /** Prune to the TTL and the cap, then persist. Both bounds are applied on
   * every write rather than on a timer: there is no alarm here, and a lobby
   * that only ever grows is the failure mode worth spending four lines on. */
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

  /**
   * Only a genuine player device gets persisted into the roster. Anything else
   * connecting without a pid — a curious browser tab, a health check — would
   * otherwise leave a phantom "Cat" that the proctor has to sort, permanently
   * and once per visit. A real player device always sends its own pid and
   * never claims a role.
   */
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
        // An unknown team id would strand the player in a room no game
        // serves, so only ids from TEAMS are accepted.
        if (team !== null && !TEAM_IDS.includes(team)) return;
        const pid = String(msg.pid);
        if (!this.names.has(pid)) return;
        if (team === null) this.teams.delete(pid);
        else this.teams.set(pid, team);
        break;
      }
      case "clearTeam": {
        if (!proctor) return;
        // Same gate as `assign`: an unknown id would be a no-op here, but
        // refusing it keeps "which strings name a team" in one place.
        const team = String(msg.team);
        if (!TEAM_IDS.includes(team)) return;
        for (const [pid, t] of [...this.teams]) {
          if (t === team) this.teams.delete(pid);
        }
        break;
      }
      case "forgetRoom": {
        if (!proctor) return;
        // The list, not the room: the Durable Object behind it keeps every
        // level it has cleared, and the next phone through the link puts it
        // straight back on the board.
        this.adhoc.delete(String(msg.room));
        await this.writeAdhoc();
        this.broadcastState();
        return;
      }
      case "forget": {
        if (!proctor) return;
        // One player at a time. A still-connected phone re-registers itself on
        // its next reconnect, so this is "drop the row", not a ban.
        const pid = String(msg.pid);
        this.names.delete(pid);
        this.teams.delete(pid);
        break;
      }

      // ---- the level pack. Any phone, no proctor gate: the level selector IS
      // the editor now, and this runs for one weekend in one room.
      case "packSet":
      case "packMove":
      case "packDelete":
      case "packAll":
        return void (await this.packIntent(msg));
    }

    await this.persist();
    this.broadcastState();
  }

  /**
   * Apply one pack edit. Returns whether the pack actually changed.
   *
   * Every branch validates by DECODING rather than by shape. A link that does
   * not parse would otherwise reach four phones and be silently dropped by each
   * of them — a level that vanishes with nobody able to say why — so it is
   * refused here, at the one place that owns the pack.
   */
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

  /**
   * Persist a new pack, tell every phone, and tell every game ROOM.
   *
   * The rooms are the part that is easy to forget: a team mid-level holds its
   * own copy of the levels for scoring, and "apply immediately" means it has to
   * hear about the change without waiting for someone to reconnect. There is no
   * subscription — the team ids are a fixed constant, so this just pokes all
   * four. Cheap, bounded, and it wakes a hibernating room exactly as a player
   * connecting would.
   */
  private async writePack() {
    this.packV++;
    await this.ctx.storage.put("pack", this.pack);
    await this.ctx.storage.put("packV", this.packV);
    this.broadcastState();
    await Promise.all(
      TEAM_IDS.map((id) =>
        this.env.Goomba.get(this.env.Goomba.idFromName(id))
          .fetch("http://room/pack-changed", { method: "POST" })
          // A room that will not wake is not worth failing the edit over; it
          // re-reads the pack on its next connect anyway.
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

  /**
   * Two payloads, not one: the proctor's carries the ad-hoc room list and a
   * player's does not, so this cannot use `this.broadcast`.
   *
   * Both strings are built once and sent to whoever wants them — the cost of
   * the split is one extra `JSON.stringify` per broadcast, against a fan-out
   * that was already one send per phone.
   */
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
