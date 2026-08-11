import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import {
  TEAMS,
  TEAM_IDS,
  type LobbyClientMsg,
  type LobbyPlayer,
  type LobbyServerMsg,
} from "@escape-cats/shared";
import { Roster } from "./connections";

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
  private roster = new Roster();
  /** pid -> team id. Persisted. */
  private teams = new Map<string, string>();
  /** pid -> display name, kept for players who are currently offline. */
  private names = new Map<string, string>();

  async onStart() {
    const teams =
      await this.ctx.storage.get<Record<string, string>>("teams");
    if (teams) this.teams = new Map(Object.entries(teams));
    const names =
      await this.ctx.storage.get<Record<string, string>>("names");
    if (names) this.names = new Map(Object.entries(names));
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
      case "clearTeams": {
        if (!proctor) return;
        this.teams.clear();
        break;
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
    }

    await this.persist();
    this.broadcastState();
  }

  private connectedPids(): Set<string> {
    return new Set(
      this.roster
        .list()
        .filter((p) => p.connected)
        .map((p) => p.id),
    );
  }

  private snapshot(): LobbyServerMsg {
    const live = this.connectedPids();
    const players: LobbyPlayer[] = [...this.names.entries()].map(
      ([pid, name]) => ({
        pid,
        name,
        team: this.teams.get(pid) ?? null,
        connected: live.has(pid),
      }),
    );
    return { type: "lobby", snapshot: { players, teams: TEAMS } };
  }

  private broadcastState() {
    this.broadcast(JSON.stringify(this.snapshot()));
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
